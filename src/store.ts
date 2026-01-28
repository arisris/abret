// abret/store - Unified Context Storage System
// Uses AsyncLocalStorage for implicit context without passing request object

import { AsyncLocalStorage } from "node:async_hooks";

// ============================================================================
// Context Storage (AsyncLocalStorage-based)
// ============================================================================

/**
 * Internal storage using AsyncLocalStorage.
 * Provides implicit context across async boundaries without passing request.
 */
const contextStore = new AsyncLocalStorage<Map<symbol, unknown>>();

/**
 * Context type for type-safe context access
 */
export type Context<T> = symbol & { __type: T };

/**
 * JSX Context interface with Provider component and default value
 */
export interface ContextWithProvider<T> {
  /**
   * Unique ID for this context
   */
  id: Context<T>;
  /**
   * Default value when context is not set
   */
  defaultValue: T;
  /**
   * Provider component for JSX usage
   */
  Provider: (props: { value: T; children: unknown }) => any;
}

/**
 * Creates a typed context for storing/retrieving values.
 * Works with both request handlers and JSX components.
 *
 * @example
 * ```ts
 * import { createContext, useContext, setContext } from "abret/store";
 *
 * // Define context (without default - returns undefined if not set)
 * const UserContext = createContext<{ id: string; name: string }>("user");
 *
 * // Define context (with default value)
 * const ThemeContext = createContext("theme", "light");
 *
 * // In middleware - set context (no req parameter needed!)
 * const authMiddleware = createMiddleware(() => async (req, _server, next) => {
 *   const user = await validateToken(req.headers.get("Authorization"));
 *   setContext(UserContext, user);
 *   return next();
 * });
 *
 * // In handler - use context (no req parameter needed!)
 * const handler = () => {
 *   const user = useContext(UserContext);
 *   return Response.json({ user });
 * };
 *
 * // In JSX component
 * function UserProfile() {
 *   const user = useContext(UserContext);
 *   return <div>{user?.name}</div>;
 * }
 * ```
 */
export function createContext<T>(name: string): Context<T>;
export function createContext<T>(
  name: string,
  defaultValue: T,
): ContextWithProvider<T>;
export function createContext<T>(
  name: string,
  ...args: [defaultValue: T] | []
): Context<T> | ContextWithProvider<T> {
  const [defaultValue] = args;
  const id = Symbol(name) as Context<T>;

  // If default value provided, return context with Provider
  if (args.length > 0) {
    const Provider = (props: { value: T; children: unknown }) => {
      return props.children;
    };
    (Provider as any)._context = { id, defaultValue };

    return {
      id,
      defaultValue: defaultValue as T,
      Provider,
    };
  }

  return id;
}

/**
 * Gets the context ID from a Context or ContextWithProvider
 * @internal
 */
function getContextId<T>(context: Context<T> | ContextWithProvider<T>): symbol {
  if (typeof context === "symbol") {
    return context;
  }
  return context.id;
}

/**
 * Gets the default value from a ContextWithProvider, if available
 * @internal
 */
function getDefaultValue<T>(
  context: Context<T> | ContextWithProvider<T>,
): T | undefined {
  if (typeof context !== "symbol" && "defaultValue" in context) {
    return context.defaultValue;
  }
  return undefined;
}

/**
 * Sets a value in the current context scope.
 * Must be called within a context scope (e.g., inside route handler or runWithContext).
 *
 * @example
 * ```ts
 * setContext(UserContext, { id: "123", name: "John" });
 * ```
 */
export const setContext = <T>(
  context: Context<T> | ContextWithProvider<T>,
  value: T,
): void => {
  const store = contextStore.getStore();
  if (!store) {
    throw new Error(
      "setContext must be called within a context scope. " +
        "Ensure you are inside a route handler or use runWithContext.",
    );
  }
  store.set(getContextId(context), value);
};

/**
 * Options for useContext
 */
export interface UseContextOptions {
  /**
   * If true, throws an error when context is not set.
   * @default false
   */
  required?: boolean;
}

/**
 * Gets a value from the current context scope.
 * Returns undefined if not set, or the default value if context was created with one.
 *
 * @example
 * ```ts
 * // Optional context
 * const user = useContext(UserContext);
 *
 * // Required context (throws if not set)
 * const user = useContext(UserContext, { required: true });
 *
 * // Context with default value
 * const ThemeContext = createContext("theme", "light");
 * const theme = useContext(ThemeContext); // returns "light" if not set
 * ```
 */
export function useContext<T>(context: Context<T>): T | undefined;
export function useContext<T>(context: ContextWithProvider<T>): T;
export function useContext<T>(
  context: Context<T>,
  options: { required: true },
): T;
export function useContext<T>(
  context: Context<T> | ContextWithProvider<T>,
  options?: UseContextOptions,
): T | undefined {
  const store = contextStore.getStore();
  const id = getContextId(context);
  const value = store?.get(id) as T | undefined;

  if (value !== undefined) {
    return value;
  }

  // Check for default value
  const defaultVal = getDefaultValue(context);
  if (defaultVal !== undefined) {
    return defaultVal;
  }

  if (options?.required) {
    const name =
      typeof context === "symbol"
        ? context.description
        : context.id.description;
    throw new Error(`Context "${name}" is required but not set`);
  }

  return undefined;
}

/**
 * Checks if a context has been set in the current scope.
 */
export const hasContext = <T>(
  context: Context<T> | ContextWithProvider<T>,
): boolean => {
  const store = contextStore.getStore();
  return store?.has(getContextId(context)) ?? false;
};

/**
 * Clears a specific context in the current scope.
 */
export const clearContext = <T>(
  context: Context<T> | ContextWithProvider<T>,
): void => {
  const store = contextStore.getStore();
  if (store) {
    store.delete(getContextId(context));
  }
};

/**
 * Runs a function within a new context scope.
 * All setContext/useContext calls within the function will use this scope.
 *
 * This is used internally by the router to wrap each request,
 * but can also be used manually for testing or custom scenarios.
 *
 * @example
 * ```ts
 * const result = await runWithContext(async () => {
 *   setContext(UserContext, { id: "123", name: "John" });
 *   return handleRequest();
 * });
 * ```
 */
export function runWithContext<R>(fn: () => R): R {
  const currentStore = contextStore.getStore();
  const newStore = currentStore ? new Map(currentStore) : new Map();
  return contextStore.run(newStore, fn);
}

/**
 * Runs a function with a specific context value set.
 * Useful for Provider components in JSX.
 *
 * @example
 * ```ts
 * const result = runWithContextValue(ThemeContext, "dark", () => {
 *   return useContext(ThemeContext); // returns "dark"
 * });
 * ```
 */
export function runWithContextValue<T, R>(
  context: Context<T> | ContextWithProvider<T>,
  value: T,
  fn: () => R,
): R {
  const currentStore = contextStore.getStore() || new Map();
  const newStore = new Map(currentStore);
  newStore.set(getContextId(context), value);
  return contextStore.run(newStore, fn);
}

/**
 * Gets the raw AsyncLocalStorage instance.
 * Useful for advanced use cases or framework integration.
 *
 * @internal
 */
export const getContextStore = () => contextStore;
