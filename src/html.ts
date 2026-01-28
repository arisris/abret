import { AsyncBuffer, Fragment, type JSXNode, SafeString, VNode } from "./jsx";
import { getContextStore } from "./store";

export { AsyncBuffer, SafeString, VNode, Fragment, type JSXNode };

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

    // If body is VNode (e.g. user passed raw JSX to HTMLResponse), we can't easily normalize it to BodyInit
    // without rendering. But Response ctor will fail if we pass VNode.
    // However, existing usage passes `html(...)` result which IS HTMLResponse.
    // If user does `new HTMLResponse(<div/>)`, it will likely fail unless we render here.
    // For now, assume usage via `html()` which handles rendering.

    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/html; charset=utf-8");
    }

    super(normalizedBody as unknown as BodyInit, { ...init, headers });
    this._bodySource = body;
  }

  /**
   * Initializes the response with new options.
   *
   * @param newInit - The new options to apply to the response.
   * @returns A new HTMLResponse instance with the updated options.
   *
   * @example
   * ```ts
   * const response = new HTMLResponse(<div>Hello World</div>).init({ status: 200 });
   * ```
   */
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

  /**
   * Adds a DOCTYPE declaration to the response body.
   *
   * @param dt - The DOCTYPE declaration to add. Can be a string or a boolean.
   * @returns A new HTMLResponse instance with the DOCTYPE declaration added.
   *
   * @example
   * ```ts
   * const response = new HTMLResponse(<div>Hello World</div>).doctype(true);
   * ```
   */
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
      // Fallback for VNode or other
      newBodySource = this._bodySource;
    }

    return new HTMLResponse(newBodySource, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
}

/**
 * Creates an implementation of `HTMLResponse` (extends standard `Response`).
 *
 * It supports two calling patterns:
 *
 * 1. **Tagged Template Literal**:
 *    Useful for static HTML chunks or mixing variables.
 *    ```ts
 *    return html`<h1>Hello ${name}</h1>`;
 *    ```
 *
 * 2. **Direct JSX/VNode**:
 *    Useful for rendering whole components or trees.
 *    ```tsx
 *    return html(<App />);
 *    ```
 *
 * You can also pass `ResponseInit` as the second argument (or after template args) to control status/headers:
 * ```ts
 * return html`<div>404</div>`.init({ status: 404 });
 * // OR
 * return html(<ErrorPage />, { status: 500 });
 * ```
 */
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
  if (Array.isArray(bodyOrStrings) && (bodyOrStrings as any).raw) {
    const vnode = parse(bodyOrStrings as unknown as TemplateStringsArray, args);
    // Render the tree
    const rendered = render(vnode);
    if (rendered instanceof Promise) {
      return new HTMLResponse(
        rendered.then((s) => raw(processMetadata(s.toString()))),
      );
    }
    return new HTMLResponse(raw(processMetadata(rendered.toString())));
  }

  // Direct usage
  const rendered = render(bodyOrStrings as JSXNode);
  if (rendered instanceof Promise) {
    return new HTMLResponse(
      rendered.then((s) => raw(processMetadata(s.toString()))),
    );
  }
  return new HTMLResponse(raw(processMetadata(rendered.toString())));
}

// Compact HTM parser
function parse(statics: TemplateStringsArray, fields: any[]): any {
  let mode = MODE_TEXT;
  let buffer = "";
  let quote = "";
  let char: string | undefined = "";
  let propName: any;

  // We store the tree as nested arrays matching the `current` structure
  // Then map it to VNodes at the end.
  // [tag, props, children] but using { tag, props, children } is clearer here
  // Root virtual node
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
        // Dynamic Tag Name: <${Component}
        const tag = fields[i - 1];
        active = openTag(stack, active, tag);
        mode = MODE_WHITESPACE;
      } else if (mode === MODE_WHITESPACE) {
        // <div ...${props}> or <div ${bool}>
        const val = fields[i - 1];
        if (buffer === "...") {
          Object.assign(active.props, val); // spread
          buffer = "";
        } else {
          // Treat as boolean attribute with implicit name?
          // For simplicity, we ignore value-only fields in whitespace unless it is spread.
        }
      } else if (mode === MODE_PROPNAME) {
        // <div ${propName}=...>
        propName = fields[i - 1];
        mode = MODE_PROPVAL;
      } else if (mode === MODE_PROPVAL) {
        // <div id=${val}>
        active.props[propName] = fields[i - 1];
        mode = MODE_WHITESPACE;
      } else if (mode === MODE_PROPVAL_QUOTE) {
        // <div id="...${val}... "
        buffer += fields[i - 1]; // Stringify
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
          // </ close
          mode = MODE_CLOSE_TAG;
        } else if (char === ">" || char === "/" || /\s/.test(char)) {
          // End of tag name
          if (buffer) {
            // Static tag name
            active = openTag(stack, active, buffer);
          }
          if (char === ">") mode = MODE_TEXT;
          else if (char === "/") {
            // Self closing <div />
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
          // Self close
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
          // Boolean <div prop>
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
          // <div prop=val>
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

  // Helper
  function commit() {
    if (buffer) {
      if (mode === MODE_TEXT) {
        active.children.push(raw(buffer)); // Text node
      }
      buffer = "";
    }
  }

  function openTag(stack: any[], current: any, tag: any) {
    const newNode = { tag, props: {}, children: [] };
    current.children.push(newNode); // Add as child
    stack.push(newNode);
    return newNode;
  }
  function closeTag(stack: any[]) {
    // Basic pop, robust parsers might verify tag name matched
    if (stack.length > 1) stack.pop();
  }

  // Root children
  if (root.children.length === 1) return toVNode(root.children[0]);
  return root.children.map(toVNode);
}

function toVNode(node: any): any {
  if (node === null || node === undefined) return node;
  if (node instanceof SafeString || typeof node !== "object") return node;
  if (node instanceof Promise || node instanceof AsyncBuffer) return node;
  if (node instanceof VNode) return node;

  if (Array.isArray(node)) return node.map(toVNode);

  // If it's not an internal parser node (missing children array), return as is
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
/**
 * Renders a JSXNode to a SafeString or Promise<SafeString>.
 *
 * @param node - The JSXNode to render.
 * @returns A SafeString or Promise<SafeString> containing the rendered HTML.
 *
 * @example
 * ```tsx
 * const rendered = render(<div>Hello World</div>);
 * ```
 */
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
      // We identify Provider via a property on the function or check props
      // But since we control createContext, we can check for the symbol keys
      // The most robust way is checking the Provider property of the context
      // But here we have the Provider function itself.

      // We can check if existing contexts map to this provider?
      // No, we need to know WHICH context this Provider belongs to.
      // Check if this is a Provider component from createContext
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

      // Normal Component -> Execute
      let result: any;
      try {
        result = node.tag(node.props);
      } catch (e) {
        console.error("Error rendering component", e);
        return raw("");
      }
      // Use handleResult logic implicitly by recursion
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

      if (VOID_TAGS.has(tag)) {
        return raw(`<${tag}${attrs} />`);
      }

      // Handle dangerouslySetInnerHTML
      if (dangerouslySetInnerHTML?.__html) {
        return raw(
          `<${tag}${attrs}>${dangerouslySetInnerHTML.__html}</${tag}>`,
        );
      }

      // children can be array or single
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

  // Fallback
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

function processMetadata(html: string): string {
  const metaTags: { tag: string; content: string; key?: string }[] = [];
  const linkTags: { tag: string; content: string; key?: string }[] = [];
  let titleTag: string | null = null;

  const extractedHtml = html.replace(
    /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>|<meta(?:\s[^>]*)?\/?>|<link(?:\s[^>]*)?\/?>/gi,
    (match) => {
      if (match.toLowerCase().startsWith("<title")) {
        titleTag = match;
        return "";
      }
      if (match.toLowerCase().startsWith("<meta")) {
        const name = match.match(/name=["']([^"']+)["']/i);
        const property = match.match(/property=["']([^"']+)["']/i);
        const charset = match.match(/charset=["']([^"']+)["']/i);
        const httpEquiv = match.match(/http-equiv=["']([^"']+)["']/i);

        let key: string | undefined;
        if (name?.[1]) key = `name:${name[1]}`;
        else if (property?.[1]) key = `property:${property[1]}`;
        else if (charset?.[1]) key = "charset";
        else if (httpEquiv?.[1]) key = `http-equiv:${httpEquiv[1]}`;

        metaTags.push({ tag: "meta", content: match, key });
        return "";
      }
      if (match.toLowerCase().startsWith("<link")) {
        const rel = match.match(/rel=["']([^"']+)["']/i);
        const key =
          rel?.[1]?.toLowerCase() === "canonical" ? "canonical" : undefined;
        linkTags.push({ tag: "link", content: match, key });
        return "";
      }
      return match;
    },
  );

  const headContent: string[] = [];
  const metaMap = new Map<string, string>();

  // Last wins
  metaTags.forEach((m) => {
    if (m.key) metaMap.set(m.key, m.content);
  });

  // Priority Order
  if (metaMap.has("charset")) {
    const charsetTag = metaMap.get("charset");
    if (charsetTag) headContent.push(charsetTag);
    metaMap.delete("charset");
  }
  if (titleTag) headContent.push(titleTag);
  if (metaMap.has("name:viewport")) {
    const viewportTag = metaMap.get("name:viewport");
    if (viewportTag) headContent.push(viewportTag);
    metaMap.delete("name:viewport");
  }
  metaMap.forEach((v) => {
    headContent.push(v);
  });
  metaTags
    .filter((m) => !m.key)
    .forEach((m) => {
      headContent.push(m.content);
    });

  const linkMap = new Map<string, string>();
  linkTags.forEach((l) => {
    if (l.key) linkMap.set(l.key, l.content);
    else headContent.push(l.content);
  });
  linkMap.forEach((v) => {
    headContent.push(v);
  });

  const headString = headContent.join("");

  if (extractedHtml.includes("<head>")) {
    return extractedHtml.replace("<head>", `<head>${headString}`);
  }
  if (extractedHtml.match(/<html/i)) {
    return extractedHtml.replace(
      /(<html[^>]*>)/i,
      `$1<head>${headString}</head>`,
    );
  }

  if (headContent.length > 0) {
    return `<head>${headString}</head>${extractedHtml}`;
  }

  return extractedHtml;
}

/**
 * Creates a raw HTML string that will not be escaped when rendered.
 * Equivalent to using `new SafeString(str)`.
 *
 * @param str - The raw HTML string.
 * @returns A SafeString instance.
 *
 * @example
 * ```tsx
 * <div>{raw("<span>Raw HTML</span>")}</div>
 * ```
 */
export function raw(str: string): SafeString {
  return new SafeString(str);
}
