import { AsyncBuffer, Fragment, type JSXNode, SafeString, VNode } from "./jsx";
import {
  createContext,
  getContextStore,
  runWithContextValue,
  useContext,
} from "./store";

export { AsyncBuffer, SafeString, VNode, Fragment, type JSXNode };

/**
 * Internal Context to collect head elements during render.
 * Replaces the fragile regex-based scraping.
 */
type HeadElement = {
  type: "title" | "meta" | "link";
  key?: string; // For deduplication (e.g. 'name:viewport')
  content: string; // The full HTML string of the tag
};
const HeadContext = createContext<HeadElement[]>("abret-head");

/**
 * Helper to create HTML Response automatically
 */
export class HTMLResponse extends Response {
  private _bodySource: any;

  constructor(body: any, init?: ResponseInit) {
    let normalizedBody = body;

    if (body instanceof Promise) {
      normalizedBody = new AsyncBuffer(body);
    }

    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/html; charset=utf-8");
    }

    super(normalizedBody as unknown as BodyInit, { ...init, headers });
    this._bodySource = body;
  }

  init(newInit: ResponseInit): HTMLResponse {
    const currentHeaders = new Headers(this.headers);
    if (newInit.headers) {
      new Headers(newInit.headers).forEach((v, k) => {
        currentHeaders.set(k, v);
      });
    }

    return new HTMLResponse(this._bodySource, {
      status: newInit.status ?? this.status,
      statusText: newInit.statusText ?? this.statusText,
      headers: currentHeaders,
    });
  }

  doctype(dt: string | boolean = true): HTMLResponse {
    let prefix = "";
    if (dt === true) prefix = "<!DOCTYPE html>";
    else if (typeof dt === "string") prefix = dt;
    else return this;

    let newBodySource: any;

    if (this._bodySource instanceof SafeString) {
      newBodySource = raw(prefix + this._bodySource.toString());
    } else if (
      this._bodySource instanceof Promise ||
      this._bodySource instanceof AsyncBuffer
    ) {
      newBodySource = (this._bodySource as Promise<SafeString>).then(
        (content) => raw(prefix + content.toString()),
      );
    } else {
      newBodySource = this._bodySource;
    }

    return new HTMLResponse(newBodySource, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
}

// -------------------------------------------------------------------------
// HTM-like Parser Constants
// -------------------------------------------------------------------------
const MODE_TEXT = 0;
const MODE_TAGNAME = 1;
const MODE_WHITESPACE = 2;
const MODE_PROPNAME = 3;
const MODE_PROPVAL = 4;
const MODE_PROPVAL_QUOTE = 5;
const MODE_CLOSE_TAG = 6;

/**
 * Creates an implementation of `HTMLResponse`.
 */
export function html(
  bodyOrStrings: JSXNode | TemplateStringsArray,
  ...args: any[]
): HTMLResponse {
  // Initialize a collection array for this render pass
  const headCollection: HeadElement[] = [];

  const runRender = () => {
    if (Array.isArray(bodyOrStrings) && (bodyOrStrings as any).raw) {
      const vnode = parse(
        bodyOrStrings as unknown as TemplateStringsArray,
        args,
      );
      return render(vnode);
    }
    return render(bodyOrStrings as JSXNode);
  };

  // 🛡️ SECURITY & LOGIC FIX:
  // We wrap the render process in a Context to capture head tags
  // instead of scraping the output string with Regex later.
  const rendered = runWithContextValue(HeadContext, headCollection, runRender);

  if (rendered instanceof Promise) {
    return new HTMLResponse(
      rendered.then((s) => raw(injectMetadata(s.toString(), headCollection))),
    );
  }
  return new HTMLResponse(
    raw(injectMetadata(rendered.toString(), headCollection)),
  );
}

// Compact HTM parser
function parse(statics: TemplateStringsArray, fields: any[]): any {
  let mode = MODE_TEXT;
  let buffer = "";
  let quote = "";
  let char: string | undefined = "";
  let propName: any;

  const root: any = { children: [] };
  let active = root;
  const stack: any[] = [active];

  for (let i = 0; i < statics.length; i++) {
    if (i) {
      if (mode === MODE_TEXT) {
        commit();
        active.children.push(fields[i - 1]);
      } else if (mode === MODE_TAGNAME) {
        commit();
        const tag = fields[i - 1];
        active = openTag(stack, active, tag);
        mode = MODE_WHITESPACE;
      } else if (mode === MODE_WHITESPACE) {
        const val = fields[i - 1];
        if (buffer === "...") {
          Object.assign(active.props, val);
          buffer = "";
        }
      } else if (mode === MODE_PROPNAME) {
        propName = fields[i - 1];
        mode = MODE_PROPVAL;
      } else if (mode === MODE_PROPVAL) {
        active.props[propName] = fields[i - 1];
        mode = MODE_WHITESPACE;
      } else if (mode === MODE_PROPVAL_QUOTE) {
        buffer += fields[i - 1];
      }
    }

    const chunk = statics[i];
    if (!chunk) continue;
    for (let j = 0; j < chunk.length; j++) {
      char = chunk[j];
      if (char === undefined) continue;

      if (mode === MODE_TEXT) {
        if (char === "<") {
          commit();
          mode = MODE_TAGNAME;
        } else {
          buffer += char;
        }
      } else if (mode === MODE_TAGNAME) {
        if (char === "/" && !buffer) {
          mode = MODE_CLOSE_TAG;
        } else if (char === ">" || char === "/" || /\s/.test(char)) {
          if (buffer) {
            active = openTag(stack, active, buffer);
          }
          if (char === ">") mode = MODE_TEXT;
          else if (char === "/") {
            if (stack.length > 1) {
              closeTag(stack);
              active = stack[stack.length - 1];
            }
          } else mode = MODE_WHITESPACE;
          buffer = "";
        } else {
          buffer += char;
        }
      } else if (mode === MODE_CLOSE_TAG) {
        if (char === ">") {
          closeTag(stack);
          active = stack[stack.length - 1];
          mode = MODE_TEXT;
          buffer = "";
        }
      } else if (mode === MODE_WHITESPACE) {
        if (char === "/") {
          closeTag(stack);
          active = stack[stack.length - 1];
        } else if (char === ">") {
          mode = MODE_TEXT;
        } else if (!/\s/.test(char)) {
          mode = MODE_PROPNAME;
          buffer = char;
        }
      } else if (mode === MODE_PROPNAME) {
        if (char === "=") {
          propName = buffer;
          buffer = "";
          mode = MODE_PROPVAL;
        } else if (char === ">") {
          active.props[buffer] = true;
          mode = MODE_TEXT;
          buffer = "";
        } else if (/\s/.test(char)) {
          active.props[buffer] = true;
          mode = MODE_WHITESPACE;
          buffer = "";
        } else {
          buffer += char;
        }
      } else if (mode === MODE_PROPVAL) {
        if (char === '"' || char === "'") {
          quote = char;
          mode = MODE_PROPVAL_QUOTE;
        } else if (char === ">") {
          active.props[propName] = buffer;
          mode = MODE_TEXT;
          buffer = "";
        } else if (/\s/.test(char)) {
          active.props[propName] = buffer;
          mode = MODE_WHITESPACE;
          buffer = "";
        } else {
          buffer += char;
        }
      } else if (mode === MODE_PROPVAL_QUOTE) {
        if (char === quote) {
          active.props[propName] = buffer;
          mode = MODE_WHITESPACE;
          buffer = "";
        } else {
          buffer += char;
        }
      }
    }
  }

  if (mode === MODE_TEXT) commit();

  function commit() {
    if (buffer) {
      if (mode === MODE_TEXT) {
        active.children.push(raw(buffer));
      }
      buffer = "";
    }
  }

  function openTag(stack: any[], current: any, tag: any) {
    const newNode = { tag, props: {}, children: [] };
    current.children.push(newNode);
    stack.push(newNode);
    return newNode;
  }
  function closeTag(stack: any[]) {
    if (stack.length > 1) stack.pop();
  }

  if (root.children.length === 1) return toVNode(root.children[0]);
  return root.children.map(toVNode);
}

function toVNode(node: any): any {
  if (node === null || node === undefined) return node;
  if (node instanceof SafeString || typeof node !== "object") return node;
  if (node instanceof Promise || node instanceof AsyncBuffer) return node;
  if (node instanceof VNode) return node;

  if (Array.isArray(node)) return node.map(toVNode);

  if (!node.children || !Array.isArray(node.children)) {
    return node;
  }

  const children = node.children.map(toVNode);
  const props = { ...node.props, children };
  return new VNode(node.tag, props, children);
}

// -------------------------------------------------------------------------
// Renderer
// -------------------------------------------------------------------------
export function render(node: any): SafeString | Promise<SafeString> {
  if (node instanceof HTMLResponse) {
    return render((node as any)._bodySource);
  }
  if (node === null || node === undefined || typeof node === "boolean") {
    return raw("");
  }
  if (node instanceof SafeString) return node;
  if (typeof node === "number" || typeof node === "bigint")
    return raw(String(node));
  if (node instanceof Promise || node instanceof AsyncBuffer) {
    return node.then(render);
  }

  if (Array.isArray(node)) {
    const results = node.map(render);
    if (results.some((r) => r instanceof Promise)) {
      return Promise.all(results).then((parts) =>
        raw(parts.map((p) => p.toString()).join("")),
      );
    }
    return raw((results as SafeString[]).map((r) => r.toString()).join(""));
  }

  if (node instanceof VNode) {
    // Handle Component
    if (typeof node.tag === "function") {
      const providerCtx = (node.tag as any)._context as
        | { id: symbol; defaultValue: unknown }
        | undefined;
      if (providerCtx) {
        const value = node.props.value;
        const contextStore = getContextStore();
        const currentStore = contextStore.getStore() || new Map();
        const newStore = new Map(currentStore);
        newStore.set(providerCtx.id, value);
        return contextStore.run(newStore, () => {
          return render(node.props.children);
        });
      }

      let result: any;
      try {
        result = node.tag(node.props);
      } catch (e) {
        console.error("Error rendering component", e);
        return raw("");
      }
      return render(result);
    }

    // Handle Fragment
    if (node.tag === Fragment) {
      return render(node.children);
    }

    // Handle Intrinsic (String tag)
    if (typeof node.tag === "string") {
      const tag = node.tag;
      const { children, dangerouslySetInnerHTML, ...rest } = node.props;

      // 🛡️ HEAD HOISTING INTERCEPTION
      if (tag === "title" || tag === "meta" || tag === "link") {
        const headStore = useContext(HeadContext);
        if (headStore) {
          // Render Attributes
          const attrs = Object.entries(rest)
            .map(([key, value]) => {
              if (value === null || value === undefined || value === false)
                return "";
              if (key === "className") key = "class";
              if (key === "style") value = renderStyle(value);
              if (value === true) return ` ${key}`;
              return ` ${key}="${escapeHtml(String(value))}"`;
            })
            .join("");

          // Handle Title (needs content resolution)
          if (tag === "title") {
            const childrenList = Array.isArray(children)
              ? children
              : [children];
            const renderedContent = render(childrenList);

            const pushTitle = (content: string) => {
              headStore.push({
                type: "title",
                content: `<title${attrs}>${escapeHtml(content)}</title>`,
              });
            };

            if (renderedContent instanceof Promise) {
              return renderedContent.then((c) => {
                pushTitle(c.toString());
                return raw(""); // Render nothing in body
              });
            }
            pushTitle(renderedContent.toString());
            return raw("");
          }

          // Handle Meta/Link
          let key: string | undefined;
          if (tag === "meta") {
            if (rest.name) key = `name:${rest.name}`;
            else if (rest.property) key = `property:${rest.property}`;
            else if (rest.charset) key = "charset";
            else if (rest["http-equiv"])
              key = `http-equiv:${rest["http-equiv"]}`;
          } else if (
            tag === "link" &&
            rest.rel?.toLowerCase() === "canonical"
          ) {
            key = "canonical";
          }

          headStore.push({
            type: tag as any,
            key,
            content: `<${tag}${attrs} />`,
          });

          return raw(""); // Render nothing in body
        }
      }

      const attrs = Object.entries(rest)
        .map(([key, value]) => {
          if (value === null || value === undefined || value === false)
            return "";
          if (key === "className") key = "class";
          if (key === "style") value = renderStyle(value);

          // 🛡️ SECURITY FIX: Prevent javascript: XSS
          if (
            (key === "href" || key === "src") &&
            typeof value === "string" &&
            value.trim().toLowerCase().startsWith("javascript:")
          ) {
            value = "";
          }

          if (value === true) return ` ${key}`;
          return ` ${key}="${escapeHtml(String(value))}"`;
        })
        .join("");

      if (VOID_TAGS.has(tag)) {
        return raw(`<${tag}${attrs} />`);
      }

      if (dangerouslySetInnerHTML?.__html) {
        return raw(
          `<${tag}${attrs}>${dangerouslySetInnerHTML.__html}</${tag}>`,
        );
      }

      const childrenList = Array.isArray(children) ? children : [children];
      const renderedChildrenResult = render(childrenList);

      if (renderedChildrenResult instanceof Promise) {
        return renderedChildrenResult.then((c) =>
          raw(`<${tag}${attrs}>${c.toString()}</${tag}>`),
        );
      }
      return raw(
        `<${tag}${attrs}>${renderedChildrenResult.toString()}</${tag}>`,
      );
    }
  }

  return raw(escapeHtml(String(node)));
}

// -------------------------------------------------------------------------
// Utilities
// -------------------------------------------------------------------------

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ESCAPE_REGEX = /[&<>"']/g;
const ESCAPE_LOOKUP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(str: string): string {
  if (typeof str !== "string") return str;
  return str.replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match] as string);
}

function kebabCase(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function renderStyle(style: Record<string, string | number>): string {
  if (typeof style === "string") return style;
  return Object.entries(style)
    .map(([k, v]) => `${kebabCase(k)}:${v}`)
    .join(";");
}

/**
 * Replaces the old regex-based extraction with a safer injection-only approach.
 * Consumes the collected HeadElements.
 */
function injectMetadata(html: string, tags: HeadElement[]): string {
  if (tags.length === 0) return html;

  const headContent: string[] = [];
  const metaMap = new Map<string, string>();
  let titleString: string | null = null;

  // Process gathered tags
  // Priority: Last write wins for unique keys
  for (const t of tags) {
    if (t.type === "title") {
      titleString = t.content;
    } else if (t.key) {
      metaMap.set(t.key, t.content);
    } else {
      headContent.push(t.content);
    }
  }

  // Construct Final Head Block
  const finalHead: string[] = [];

  // 1. Charset
  if (metaMap.has("charset")) {
    // biome-ignore lint/style/noNonNullAssertion: <>
    finalHead.push(metaMap.get("charset")!);
    metaMap.delete("charset");
  }

  // 2. Title
  if (titleString) {
    finalHead.push(titleString);
  }

  // 3. Viewport
  if (metaMap.has("name:viewport")) {
    // biome-ignore lint/style/noNonNullAssertion: <>
    finalHead.push(metaMap.get("name:viewport")!);
    metaMap.delete("name:viewport");
  }

  // 4. Everything else
  // biome-ignore lint/suspicious/useIterableCallbackReturn: <>
  metaMap.forEach((v) => finalHead.push(v));
  finalHead.push(...headContent);

  const headString = finalHead.join("");

  // Simple Injection (No complex regex)
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${headString}`);
  }
  if (html.toLowerCase().includes("<html")) {
    // Basic regex just to find the opening html tag, strictly matching <html... >
    return html.replace(/(<html[^>]*>)/i, `$1<head>${headString}</head>`);
  }

  // Fallback: Prepend
  return `<head>${headString}</head>${html}`;
}

export function raw(str: string): SafeString {
  return new SafeString(str);
}
