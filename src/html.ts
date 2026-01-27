import { AsyncLocalStorage } from "node:async_hooks";
import { VNode, Fragment, type JSXNode, AsyncBuffer, SafeString } from "./jsx";
export { AsyncBuffer, SafeString, VNode, Fragment, type JSXNode };

// Context API
interface Context<T> {
  defaultValue: T;
  Provider: (props: { value: T; children: any }) => any;
  id: symbol;
}

const contextStore = new AsyncLocalStorage<Map<symbol, any>>();

/**
 * Creates a Context object to pass data through the component tree without having to pass props down manually at every level.
 *
 * Internally uses `AsyncLocalStorage` to ensure context isolation across concurrent requests in SSR.
 *
 * @example
 * ```tsx
 * const ThemeContext = createContext("light");
 *
 * function App() {
 *   return (
 *     <ThemeContext.Provider value="dark">
 *       <ThemedButton />
 *     </ThemeContext.Provider>
 *   );
 * }
 *
 * function ThemedButton() {
 *   const theme = useContext(ThemeContext);
 *   return <button class={theme}>I am styled!</button>;
 * }
 * ```
 */
export function createContext<T>(defaultValue: T): Context<T> {
  const id = Symbol("Context");
  return {
    defaultValue,
    id,
    Provider: function (props: { value: T; children: any }) {
      return props.children;
    },
  };
}

/**
 * Retrieves the current value of a Context object.
 *
 * @param context - The Context object to retrieve the value from.
 * @returns The current value of the Context object.
 *
 * @example
 * ```tsx
 * const ThemeContext = createContext("light");
 * const theme = useContext(ThemeContext);
 * ```
 */
export function useContext<T>(context: Context<T>): T {
  const store = contextStore.getStore();
  if (store && store.has(context.id)) {
    return store.get(context.id);
  }
  return context.defaultValue;
}

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
      new Headers(newInit.headers).forEach((v, k) => currentHeaders.set(k, v));
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
      newBodySource = new SafeString(prefix + this._bodySource.toString());
    } else if (
      this._bodySource instanceof Promise ||
      this._bodySource instanceof AsyncBuffer
    ) {
      newBodySource = (this._bodySource as Promise<SafeString>).then(
        (content) => new SafeString(prefix + content.toString()),
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
export function html(
  bodyOrStrings: JSXNode | TemplateStringsArray,
  ...args: any[]
): HTMLResponse {
  let body: SafeString | AsyncBuffer | Promise<SafeString>;

  // Check if used as Tagged Template
  if (Array.isArray(bodyOrStrings) && (bodyOrStrings as any).raw) {
    const strings = bodyOrStrings as unknown as TemplateStringsArray;
    const values = args;

    // We treat template parts as raw strings and values as potential VNodes
    const inputForRender = strings.reduce((acc: any[], str, i) => {
      if (str) acc.push(new SafeString(str));
      if (i < values.length) {
        acc.push(values[i]);
      }
      return acc;
    }, []);

    // Render and then process metadata
    const rendered = render(inputForRender);
    if (rendered instanceof Promise) {
      body = rendered.then(
        (r) => new SafeString(processMetadata(r.toString())),
      );
    } else {
      body = new SafeString(processMetadata(rendered.toString()));
    }
  } else {
    // direct usage: html(<App />)
    const rendered = render(bodyOrStrings as JSXNode);
    if (rendered instanceof Promise) {
      body = rendered.then(
        (r) => new SafeString(processMetadata(r.toString())),
      );
    } else {
      body = new SafeString(processMetadata(rendered.toString()));
    }
  }

  const init = args[0] as ResponseInit;
  if (init && !(bodyOrStrings as any).raw) return new HTMLResponse(body, init);

  return new HTMLResponse(body);
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
    return new SafeString("");
  }
  if (node instanceof SafeString) return node;
  if (typeof node === "number" || typeof node === "bigint")
    return new SafeString(String(node));
  if (node instanceof Promise || node instanceof AsyncBuffer) {
    return node.then(render);
  }

  if (Array.isArray(node)) {
    const results = node.map(render);
    if (results.some((r) => r instanceof Promise)) {
      return Promise.all(results).then(
        (parts) => new SafeString(parts.map((p) => p.toString()).join("")),
      );
    }
    return new SafeString(
      (results as SafeString[]).map((r) => r.toString()).join(""),
    );
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
      // HACK: We attach the context object to the Provider function in createContext
      const providerCtx = (node.tag as any)._context as
        | Context<any>
        | undefined;

      if (providerCtx) {
        const value = node.props.value;
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
        return new SafeString("");
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
      const { children, ...rest } = node.props;

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
        return new SafeString(`<${tag}${attrs} />`);
      }

      // children can be array or single
      const childrenList = Array.isArray(children) ? children : [children];

      // Use Array map to render children so we can detect promises
      const renderedChildrenResult = render(childrenList);

      if (renderedChildrenResult instanceof Promise) {
        return renderedChildrenResult.then(
          (c) => new SafeString(`<${tag}${attrs}>${c.toString()}</${tag}>`),
        );
      }
      return new SafeString(
        `<${tag}${attrs}>${renderedChildrenResult.toString()}</${tag}>`,
      );
    }
  }

  // Fallback
  return new SafeString(escapeHtml(String(node)));
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
        if (name && name[1]) key = `name:${name[1]}`;
        else if (property && property[1]) key = `property:${property[1]}`;
        else if (charset && charset[1]) key = `charset`;
        else if (httpEquiv && httpEquiv[1]) key = `http-equiv:${httpEquiv[1]}`;

        metaTags.push({ tag: "meta", content: match, key });
        return "";
      }
      if (match.toLowerCase().startsWith("<link")) {
        const rel = match.match(/rel=["']([^"']+)["']/i);
        const key =
          rel && rel[1] && rel[1].toLowerCase() === "canonical"
            ? "canonical"
            : undefined;
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
    headContent.push(metaMap.get("charset")!);
    metaMap.delete("charset");
  }
  if (titleTag) headContent.push(titleTag);
  if (metaMap.has("name:viewport")) {
    headContent.push(metaMap.get("name:viewport")!);
    metaMap.delete("name:viewport");
  }
  metaMap.forEach((v) => headContent.push(v));
  metaTags.filter((m) => !m.key).forEach((m) => headContent.push(m.content));

  const linkMap = new Map<string, string>();
  linkTags.forEach((l) => {
    if (l.key) linkMap.set(l.key, l.content);
    else headContent.push(l.content);
  });
  linkMap.forEach((v) => headContent.push(v));

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

// Ensure context is linked
// We need to modify createContext to assign _context to Provider
const originalCreateContext = createContext;
(createContext as any) = function <T>(defaultValue: T): Context<T> {
  const ctx = originalCreateContext(defaultValue);
  (ctx.Provider as any)._context = ctx;
  return ctx;
};
