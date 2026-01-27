// Internal plain class for zero overhead
export class SafeString {
  constructor(public value: string) {}
  toString() {
    return this.value;
  }
}

// Hybrid class: Acts like a ReadableStream for Response, but also waiting as a Promise
export class AsyncBuffer extends ReadableStream<Uint8Array> {
  constructor(private promise: Promise<SafeString>) {
    super({
      async start(controller) {
        try {
          const result = await promise;
          controller.enqueue(new TextEncoder().encode(result.toString()));
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
  }

  // Promise compatibility
  then<TResult1 = SafeString, TResult2 = never>(
    onfulfilled?:
      | ((value: SafeString) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<SafeString | TResult> {
    return this.promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<SafeString> {
    return this.promise.finally(onfinally);
  }
}

// VNode Structure
export class VNode {
  constructor(
    public tag: string | Function | typeof Fragment,
    public props: Record<string, any>,
    public children: any,
  ) {}
}

export type JSXNode =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | JSXNode[]
  | Promise<JSXNode>
  | SafeString
  | AsyncBuffer
  | VNode;

// -------------------------------------------------------------------------
// JSX Runtime
// -------------------------------------------------------------------------

export const Fragment = Symbol("Fragment");

export function jsx(
  tag: string | Function | typeof Fragment,
  props: Record<string, any>,
): VNode {
  const { children, ...rest } = props || {};
  return new VNode(tag, { ...rest, children }, children);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export namespace JSX {
  export type Element = VNode | SafeString | AsyncBuffer | Promise<SafeString>;
  export type ElementType = string | ((props: any) => JSXNode);
  export interface IntrinsicElements {
    [elemName: string]: any;
  }
  export interface ElementChildrenAttribute {
    children: {};
  }
}
