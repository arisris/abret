import { describe, expect, test } from "bun:test";
import {
  VNode,
  Fragment,
  SafeString,
  html,
  HTMLResponse,
  type JSXNode,
  render as renderHTML,
} from "../src/html";
import { jsx } from "../src/jsx";

// ... (render helper stays the same) ...
const render = async (node: any) => {
  const rendered = await renderHTML(node);
  return rendered.toString();
};

describe("JSX Runtime (lib/jsx-runtime)", () => {
  // ... (existing sync tests) ...
  test("renders basic HTML elements", async () => {
    expect(await render(jsx("div", { children: "Hello" }))).toBe(
      "<div>Hello</div>",
    );
    expect(await render(jsx("span", { id: "test", children: "text" }))).toBe(
      '<span id="test">text</span>',
    );
  });

  test("renders void tags correctly (self-closing)", async () => {
    expect(await render(jsx("br", {}))).toBe("<br />");
    expect(await render(jsx("hr", { class: "divider" }))).toBe(
      '<hr class="divider" />',
    );
    expect(await render(jsx("img", { src: "img.jpg" }))).toBe(
      '<img src="img.jpg" />',
    );
  });

  test("handles className prop as class", async () => {
    expect(
      await render(jsx("div", { className: "container", children: [] })),
    ).toBe('<div class="container"></div>');
  });

  test("handles style objects", async () => {
    const style = { color: "red", marginTop: 10, "--custom-var": "val" };
    expect(await render(jsx("div", { style, children: "Styled" }))).toBe(
      '<div style="color:red;margin-top:10;--custom-var:val">Styled</div>',
    );
  });

  test("handles boolean attributes", async () => {
    expect(await render(jsx("input", { disabled: true, required: true }))).toBe(
      "<input disabled required />",
    );
    expect(
      await render(jsx("input", { disabled: false, readonly: null })),
    ).toBe("<input />");
  });

  test("escapes special characters in children and attributes", async () => {
    const unsafe = '<script>alert("xss")</script>';
    expect(await render(jsx("div", { children: unsafe }))).toBe(
      "<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>",
    );
    expect(await render(jsx("div", { "data-val": '"quote"' }))).toBe(
      '<div data-val="&quot;quote&quot;"></div>',
    );
  });

  test("renders attributes with kebab-case is NOT automatically applied to keys except style", async () => {
    expect(await render(jsx("div", { tabIndex: 0 }))).toBe(
      '<div tabIndex="0"></div>',
    );
    expect(await render(jsx("div", { "data-foo": "bar" }))).toBe(
      '<div data-foo="bar"></div>',
    );
  });

  test("renders fragments", async () => {
    expect(
      await render(
        jsx(Fragment, {
          children: [jsx("div", { children: 1 }), jsx("div", { children: 2 })],
        }),
      ),
    ).toBe("<div>1</div><div>2</div>");
  });

  test("handles functional components", async () => {
    const MyComponent = ({ name, children }: any) => {
      return jsx("div", { children: [`Hello ${name}`, children] });
    };
    expect(
      await render(jsx(MyComponent, { name: "World", children: "!" })),
    ).toBe("<div>Hello World!</div>");
  });

  test("handles async components", async () => {
    const AsyncComponent = async ({ text }: any): Promise<VNode> => {
      await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate work
      return jsx("span", { children: text });
    };

    expect(await render(jsx(AsyncComponent, { text: "Async" }))).toBe(
      "<span>Async</span>",
    );
  });

  test("handles nested async components", async () => {
    // Nested async needs the parent to wait for children
    const Child = async (): Promise<SafeString> => {
      await new Promise((r) => setTimeout(r, 5));
      return new SafeString("Child");
    };
    const Parent = async (): Promise<VNode> => {
      return jsx("div", { children: jsx(Child, {}) });
    };

    expect(await render(jsx(Parent, {} as any))).toBe("<div>Child</div>");
  });

  test("handles mixed sync/async children arrays", async () => {
    const AsyncChild = async () => "Async";
    expect(
      await render(jsx("div", { children: ["Sync", jsx(AsyncChild, {})] })),
    ).toBe("<div>SyncAsync</div>");
  });

  test("ignores null/undefined/boolean children", async () => {
    expect(
      await render(
        jsx("div", { children: [null, undefined, false, true, "Visible"] }),
      ),
    ).toBe("<div>Visible</div>");
  });
});

describe("html Helper & Metadata System", () => {
  test("returns HTMLResponse", () => {
    const res = html`<div></div>`;
    expect(res).toBeInstanceOf(HTMLResponse);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  test("processes template literals", async () => {
    const res = html`<div>${"Clean"}</div>`;
    expect(await res.text()).toContain("<div>Clean</div>");
  });

  test("auto-injects head into html", async () => {
    const input = `<html><body><h1>Hi</h1><title>Auto</title></body></html>`;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toContain("<head>");
    expect(text).toContain("<title>Auto</title>");
    expect(text).not.toContain("<body><title>"); // Should be moved/removed from body logically?
    // Wait, my regex implementation actually just COPY extracts and injects into head,
    // it doesn't REMOVE them from original location unless I update it to do so?
    // Looking at the code: `extractedHtml` is `html.replace(...)` where it returns `""` for matches.
    // Yes, it removes them from the original string!
    expect(text).not.toContain("<h1>Hi</h1><title>");
  });

  test("overrides title (last wins)", async () => {
    const input = `
      <html>
        <head><title>Old</title></head>
        <body>
          <title>New</title>
          <h1>Content</h1>
        </body>
      </html>
    `;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toContain("<title>New</title>");
    expect(text).not.toContain("<title>Old</title>");
  });

  test("overrides meta tags by name", async () => {
    const input = `
      <html>
        <head>
          <meta name="description" content="Old Desc" />
        </head>
        <body>
          <meta name="description" content="New Desc" />
        </body>
      </html>
    `;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toContain('<meta name="description" content="New Desc" />');
    expect(text).not.toContain("Old Desc");
  });

  test("prioritizes charset and moves to top", async () => {
    const input = `
      <html>
        <body>
          <meta charset="utf-8" />
        </body>
      </html>
    `;
    const res = html(new SafeString(input));
    const text = await res.text();
    // It should be inside head
    expect(text).toMatch(/<head>\s*<meta charset="utf-8" \/>/);
  });

  test("handles duplicate property meta tags (OG tags)", async () => {
    const input = `
      <html>
        <head>
          <meta property="og:title" content="Old OG" />
        </head>
        <body>
          <meta property="og:title" content="New OG" />
        </body>
      </html>
    `;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toContain('<meta property="og:title" content="New OG" />');
    expect(text).not.toContain("Old OG");
  });

  test("preserves non-conflicting links and scripts", async () => {
    // Note: scripts are not touched by the regex currently, only link/meta/title
    const input = `
      <html>
        <head>
          <link rel="stylesheet" href="style.css" />
        </head>
        <body>
          <link rel="stylesheet" href="style2.css" />
        </body>
      </html>
    `;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toContain('href="style.css"');
    expect(text).toContain('href="style2.css"');
  });

  test("overrides canonical link", async () => {
    const input = `
      <html>
        <head> <link rel="canonical" href="old.com" /> </head>
        <body> <link rel="canonical" href="new.com" /> </body>
      </html>
    `;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toContain('href="new.com"');
    expect(text).not.toContain('href="old.com"');
  });

  test("injects head properly when missing", async () => {
    const input = `<div>No HTML tag</div><title>Generated</title>`;
    const res = html(new SafeString(input));
    const text = await res.text();
    expect(text).toBe(
      `<head><title>Generated</title></head><div>No HTML tag</div>`,
    );
  });

  test("handles async content in html template literal", async () => {
    const asyncContent = Promise.resolve("Async Content");
    const res = html`<div>${asyncContent}</div>
      <title>Async Title</title>`;
    const text = await res.text();
    expect(text).toContain("Async Content");
    expect(text).toContain("<title>Async Title</title>");
    expect(text).toContain("<head>");
  });

  test("adds default doctype", async () => {
    const res = html`<div>Content</div>`.doctype();
    const text = await res.text();
    expect(text).toStartWith("<!DOCTYPE html>");
    expect(text).toContain("<div>Content</div>");
  });

  test("adds explicit doctype true", async () => {
    const res = html`<div>Content</div>`.doctype(true);
    const text = await res.text();
    expect(text).toStartWith("<!DOCTYPE html>");
  });

  test("not adds doctype if false", async () => {
    const res = html`<div>Content</div>`.doctype(false);
    const text = await res.text();
    expect(text).not.toContain("<!DOCTYPE html>");
  });

  test("adds custom doctype", async () => {
    const custom = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">';
    const res = html`<div>Content</div>`.doctype(custom);
    const text = await res.text();
    expect(text).toStartWith(custom);
  });

  test("adds doctype to async content", async () => {
    const asyncContent = Promise.resolve("Inner");
    const res = html`<div>${asyncContent}</div>`.doctype();
    const text = await res.text();
    expect(text).toStartWith("<!DOCTYPE html>");
    expect(text).toContain("Inner");
  });

  test("processes template literals with various types", async () => {
    const num = 42;
    const bool = true;
    const str = "Clean";
    const res = html`<div>${str} - ${num} - ${bool}</div>`;
    expect(await res.text()).toContain("<div>Clean - 42 - </div>");
  });

  test("escapes unsafe strings in template literals", async () => {
    const unsafe = `<script>alert('xss')</script>`;
    const res = html`<div>${unsafe}</div>`;
    const text = await res.text();
    expect(text).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(text).not.toContain("<script>");
  });

  test("does NOT escape SafeString in template literals", async () => {
    const safe = new SafeString("<span>Safe</span>");
    const res = html`<div>${safe}</div>`;
    const text = await res.text();
    expect(text).toContain("<span>Safe</span>");
  });

  test("handles arrays in template literals (joins them)", async () => {
    const items = ["A", "B", "C"];
    const res = html`<ul>
      ${items.map((i) => html`<li>${i}</li>`)}
    </ul>`;
    const text = await res.text();
    // Should be joined without commas
    expect(text).toContain("<li>A</li><li>B</li><li>C</li>");
  });

  test("handles arrays of promises in template literals", async () => {
    const items = ["A", "B", "C"];
    // map returns generic arrays, but html template handles them
    const res = html`<ul>
      ${items.map(async (i) => {
        await new Promise((r) => setTimeout(r, 1));
        return html`<li>${i}</li>`;
      })}
    </ul>`;

    const text = await res.text();
    expect(text).toContain("<li>A</li><li>B</li><li>C</li>");
  });
});
