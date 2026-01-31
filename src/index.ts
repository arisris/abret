// bun route utility with middleware support

// Internal import for use in wrapWithMiddleware
import { runWithContext as _runWithContext } from "./store";

export {
  createContext,
  runWithContext,
  runWithContextValue,
  useContext,
} from "./store";

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
 * Wraps a handler function with middleware chain and context scope
 */
const wrapWithMiddleware = <P extends string, S = undefined>(
  handler: Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response>,
  middlewares: Middleware<P, S>[],
): Bun.Serve.Handler<Bun.BunRequest<P>, Bun.Server<S>, Response> => {
  return (req: Bun.BunRequest<P>, server: Bun.Server<S>) => {
    // Wrap entire request handling in a context scope
    return _runWithContext(() => {
      if (middlewares.length === 0) {
        return handler(req, server);
      }

      let index = 0;

      const next: NextFunction = () => {
        if (index < middlewares.length) {
          const middleware = middlewares[index++];
          if (middleware) return middleware(req, server, next);
        }
        return handler(req, server);
      };

      return next();
    });
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

// ============================================================================
// Routing
// ============================================================================

/**
 * Creates a route with optional middleware support.
 * Registers the path exactly as defined.
 *
 * @example
 * ```ts
 * const home = createRoute("/", () => new Response("Hello World"));
 *
 * const api = createRoute(
 *   "/api/users",
 *   {
 *     GET: () => Response.json({ users: [] }),
 *     POST: async (req) => Response.json({ created: true }),
 *   },
 *   authMiddleware,
 * );
 * ```
 */
export const createRoute = <P extends string, S = undefined>(
  path: P,
  value: RouteValue<P, S>,
  ...middlewares: Middleware<P, S>[]
): Record<P, RouteValue<P, S>> => {
  const wrappedValue = wrapRouteValue(value, middlewares);
  return { [path]: wrappedValue } as Record<P, RouteValue<P, S>>;
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
        const middleware = middlewares[index++];
        if (middleware) return middleware(req, server, next);
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
 *
 * Bun.serve({
 *   routes: mergeRoutes(index, api),
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
  U extends unknown
    ? (k: U) => void
    : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Creates a route group factory with a common prefix and optional shared middlewares.
 *
 * @example
 * ```ts
 * const api = createRouteGroup("/api", [authMiddleware]);
 *
 * const routes = mergeRoutes(
 *   api("/users", { GET: () => Response.json([]) }),
 *   api("/users/:id", (req) => Response.json({ id: req.params.id })),
 * );
 * ```
 */
export const createRouteGroup = <Prefix extends string, S = undefined>(
  prefix: Prefix,
  middlewares: Middleware<string, S>[] = [],
) => {
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
