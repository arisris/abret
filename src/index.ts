// bun route utility with middleware support
export * from "./html";

// ============================================================================
// Request Context System (WeakMap-based)
// ============================================================================

/**
 * Internal storage for request context using WeakMap.
 * WeakMap ensures automatic garbage collection when request is done.
 */
const requestContextStore = new WeakMap<Request, Map<symbol, unknown>>();

/**
 * Symbol key for type-safe context access
 */
export type ContextKey<T> = symbol & { __type: T };

/**
 * Creates a typed context key for storing/retrieving values
 *
 * @example
 * ```ts
 * // Define context keys (usually in a separate file)
 * export const UserContext = createContextKey<{ id: string; name: string }>("user");
 * export const SessionContext = createContextKey<string>("session");
 * ```
 */
export const createContextKey = <T>(name: string): ContextKey<T> => {
  return Symbol(name) as ContextKey<T>;
};

/**
 * Sets a value in the request context
 *
 * @example
 * ```ts
 * const authMiddleware = createMiddleware((req, server, next) => {
 *   const user = await validateToken(req.headers.get("Authorization"));
 *   setContext(req, UserContext, user);
 *   return next();
 * });
 * ```
 */
export const setContext = <T>(
  req: Request | Bun.BunRequest,
  key: ContextKey<T>,
  value: T,
): void => {
  let contextMap = requestContextStore.get(req);
  if (!contextMap) {
    contextMap = new Map();
    requestContextStore.set(req, contextMap);
  }
  contextMap.set(key, value);
};

/**
 * Gets a value from the request context
 *
 * @example
 * ```ts
 * const handler = (req) => {
 *   const user = getContext(req, UserContext);
 *   if (!user) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 *   return Response.json({ message: `Hello ${user.name}` });
 * };
 * ```
 */
export const getContext = <T>(
  req: Request | Bun.BunRequest,
  key: ContextKey<T>,
): T | undefined => {
  const contextMap = requestContextStore.get(req);
  return contextMap?.get(key) as T | undefined;
};

/**
 * Gets a value from context, throws if not found
 *
 * @example
 * ```ts
 * const user = requireContext(req, UserContext); // throws if not set
 * ```
 */
export const requireContext = <T>(
  req: Request | Bun.BunRequest,
  key: ContextKey<T>,
): T => {
  const value = getContext(req, key);
  if (value === undefined) {
    throw new Error(`Context key "${key.description}" is required but not set`);
  }
  return value;
};

/**
 * Checks if a context key exists
 */
export const hasContext = <T>(
  req: Request | Bun.BunRequest,
  key: ContextKey<T>,
): boolean => {
  const contextMap = requestContextStore.get(req);
  return contextMap?.has(key) ?? false;
};

// ============================================================================
// Middleware Types
// ============================================================================

/**
 * Next function type for middleware chain
 */
export type NextFunction = () => Response | Promise<Response>;

/**
 * Middleware function type
 * @param req - The incoming request
 * @param server - The Bun server instance
 * @param next - Function to call the next middleware/handler
 * @returns Response or Promise<Response>
 */
export type Middleware<P extends string = string, S = undefined> = (
  req: Bun.BunRequest<P>,
  server: Bun.Server<S>,
  next: NextFunction,
) => Response | Promise<Response>;

/**
 * Route handler type - can be a Response, handler function, or method handlers
 */
export type RouteValue<P extends string = string, S = undefined> =
  | Bun.Serve.BaseRouteValue
  | Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response>
  | Partial<
      Record<
        Bun.Serve.HTTPMethod,
        Response | Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response>
      >
    >;

/**
 * Wraps a handler function with middleware chain
 */
const wrapWithMiddleware = <P extends string, S = undefined>(
  handler: Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response>,
  middlewares: Middleware<P, S>[],
): Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response> => {
  if (middlewares.length === 0) {
    return handler;
  }

  return (req: Bun.BunRequest<P>, server: Bun.Server<S>) => {
    let index = 0;

    const next: NextFunction = () => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++]!;
        return middleware(req, server, next);
      }
      return handler(req, server);
    };

    return next();
  };
};

/**
 * Wraps a RouteValue with middleware support
 */
const wrapRouteValue = <P extends string, S = undefined>(
  value: RouteValue<P, S>,
  middlewares: Middleware<P, S>[],
): RouteValue<P, S> => {
  if (middlewares.length === 0) {
    return value;
  }

  // If value is a Response or Bun.file, wrap in a function first
  if (value instanceof Response) {
    return wrapWithMiddleware(() => value, middlewares);
  }

  // If value is a function (handler)
  if (typeof value === "function") {
    return wrapWithMiddleware(
      value as Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response>,
      middlewares,
    );
  }

  // If value is an object with HTTP methods
  if (typeof value === "object" && value !== null) {
    const wrappedMethods: Partial<
      Record<
        Bun.Serve.HTTPMethod,
        Response | Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response>
      >
    > = {};

    for (const [method, methodHandler] of Object.entries(value)) {
      if (methodHandler instanceof Response) {
        wrappedMethods[method as Bun.Serve.HTTPMethod] = wrapWithMiddleware(
          () => methodHandler,
          middlewares,
        );
      } else if (typeof methodHandler === "function") {
        wrappedMethods[method as Bun.Serve.HTTPMethod] = wrapWithMiddleware(
          methodHandler as Bun.Serve.Handler<
            Bun.BunRequest<P>,
            Bun.Server<S>,
            Response
          >,
          middlewares,
        );
      }
    }

    return wrappedMethods;
  }

  return value;
};

/**
 * Creates a route with optional middleware support
 *
 * @example
 * ```ts
 * // Basic route without middleware
 * const home = createRoute("/", () => new Response("Hello World"));
 *
 * // Route with middleware
 * const api = createRoute(
 *   "/api/users",
 *   {
 *     GET: () => Response.json({ users: [] }),
 *     POST: async (req) => Response.json({ created: true }),
 *   },
 *   authMiddleware,
 *   loggingMiddleware
 * );
 * ```
 */
export const createRoute = <P extends string, S = undefined>(
  path: P,
  value: RouteValue<P, S>,
  ...middlewares: Middleware<P, S>[]
) => {
  const wrappedValue = wrapRouteValue(value, middlewares);
  return { [path]: wrappedValue } as { [K in P]: typeof wrappedValue };
};

/**
 * Helper to create a middleware function with proper typing
 *
 * @example
 * ```ts
 * const authMiddleware = createMiddleware(async (req, server, next) => {
 *   const token = req.headers.get("Authorization");
 *   if (!token) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 *   return next();
 * });
 *
 * const loggingMiddleware = createMiddleware((req, server, next) => {
 *   console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
 *   return next();
 * });
 * ```
 */
export const createMiddleware = <P extends string = string, S = undefined>(
  fn: Middleware<P, S>,
): Middleware<P, S> => fn;

/**
 * Compose multiple middlewares into a single middleware
 *
 * @example
 * ```ts
 * const combinedMiddleware = composeMiddlewares(
 *   loggingMiddleware,
 *   authMiddleware,
 *   rateLimitMiddleware
 * );
 * ```
 */
export const composeMiddlewares = <P extends string = string, S = undefined>(
  ...middlewares: Middleware<P, S>[]
): Middleware<P, S> => {
  return (req, server, finalNext) => {
    let index = 0;

    const next: NextFunction = () => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++]!;
        return middleware(req, server, next);
      }
      return finalNext();
    };

    return next();
  };
};

// ============================================================================
// Route Merging Utilities
// ============================================================================

/**
 * Type for a single route object returned by createRoute
 * Uses Record<string, any> to allow typed route objects to be merged
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RouteObject = Record<string, any>;

/**
 * Merges multiple route objects into a single routes object.
 * Preserves type information from each route for proper typing.
 *
 * @example
 * ```ts
 * const index = createRoute("/", () => new Response("Home"));
 * const api = createRoute("/api", { GET: () => Response.json({ ok: true }) });
 * const users = createRoute("/users/:id", (req) => Response.json({ id: req.params.id }));
 *
 * // Instead of:
 * // routes: { ...index, ...api, ...users }
 *
 * // Use:
 * Bun.serve({
 *   routes: mergeRoutes(index, api, users),
 * });
 * ```
 */
export const mergeRoutes = <T extends RouteObject[]>(
  ...routes: T
): UnionToIntersection<T[number]> => {
  return Object.assign({}, ...routes) as UnionToIntersection<T[number]>;
};

/**
 * Helper type to convert union to intersection
 * @internal
 */
type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Creates a route group factory with a common prefix and optional shared middlewares.
 * Returns a function that creates routes with the prefix automatically applied.
 * This preserves full type inference for `req.params`.
 *
 * @example
 * ```ts
 * // Create a route factory with prefix and middlewares
 * const api = createRouteGroup("/api", [authMiddleware]);
 *
 * // Use the factory to create routes - type inference works!
 * const routes = mergeRoutes(
 *   api("/users", { GET: () => Response.json([]) }),
 *   api("/users/:id", (req) => {
 *     req.params.id; // ✅ TypeScript knows this is string
 *     return Response.json({ id: req.params.id });
 *   }),
 *   api("/posts/:postId/comments/:commentId", (req) => {
 *     req.params.postId;    // ✅ string
 *     req.params.commentId; // ✅ string
 *     return Response.json(req.params);
 *   }),
 * );
 *
 * Bun.serve({ routes });
 * ```
 */
export const createRouteGroup = <Prefix extends string, S = undefined>(
  prefix: Prefix,
  middlewares: Middleware<string, S>[] = [],
) => {
  /**
   * Creates a route with the group's prefix and middlewares applied
   */
  return <P extends string>(path: P, value: RouteValue<`${Prefix}${P}`, S>) => {
    type FullPath = `${Prefix}${P}`;
    const fullPath = `${prefix}${path}` as FullPath;
    return createRoute(
      fullPath,
      value as RouteValue<FullPath, S>,
      ...(middlewares as unknown as Middleware<FullPath, S>[]),
    );
  };
};
