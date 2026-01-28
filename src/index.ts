// bun route utility with middleware support

// Internal import for use in wrapWithMiddleware
import { runWithContext as _runWithContext } from "./store";

// ============================================================================
// Abret Configuration Types
// ============================================================================

/**
 * Trailing slash handling mode:
 * - "both": Register both `/path` and `/path/` variants (default)
 * - "strip": Normalize to `/path` only (remove trailing slash)
 * - "none": No automatic handling, use exact paths as defined
 */
export type TrailingSlashMode = "both" | "strip" | "none";

/**
 * Abret configuration options
 */
export interface AbretConfig {
  /**
   * How to handle trailing slashes in route paths
   * @default "both"
   */
  trailingSlash?: TrailingSlashMode;
}

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
          const middleware = middlewares[index++]!;
          return middleware(req, server, next);
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
// Trailing Slash Normalization
// ============================================================================

/**
 * Generates path variants based on trailing slash configuration.
 *
 * @example
 * ```ts
 * // With trailingSlash: "both" (default)
 * normalizePathVariants("/hello", "both")  // ["/hello", "/hello/"]
 *
 * // With trailingSlash: "strip"
 * normalizePathVariants("/hello/", "strip") // ["/hello"]
 *
 * // With trailingSlash: "none"
 * normalizePathVariants("/hello", "none")  // ["/hello"] (exact as defined)
 * ```
 *
 * @internal
 */
const normalizePathVariants = (
  path: string,
  mode: TrailingSlashMode = "both",
): string[] => {
  // Root path always has only one variant
  if (path === "/" || path === "") {
    return ["/"];
  }

  // Normalize: remove trailing slash if present
  const withoutSlash = path.endsWith("/") ? path.slice(0, -1) : path;
  const withSlash = `${withoutSlash}/`;

  switch (mode) {
    case "both":
      // Return both variants
      return [withoutSlash, withSlash];

    case "strip":
      // Always strip trailing slash
      return [withoutSlash];

    case "none":
      // No normalization - exact path as defined
      return [path];

    default:
      return [withoutSlash, withSlash];
  }
};

/**
 * Utility type to remove trailing slash from path
 * @internal
 */
type RemoveTrailingSlash<P extends string> = P extends "/"
  ? P
  : P extends `${infer Base}/`
    ? Base
    : P;

/**
 * Utility type to add trailing slash to path
 * @internal
 */
type AddTrailingSlash<P extends string> = P extends "/"
  ? P
  : P extends `${string}/`
    ? P
    : `${P}/`;

/**
 * Utility type that represents both path variants (with and without trailing slash)
 * Root path "/" only has single variant
 * @internal
 */
type PathWithVariants<P extends string> = P extends "/"
  ? "/"
  : RemoveTrailingSlash<P> | AddTrailingSlash<RemoveTrailingSlash<P>>;

/**
 * Creates a createRoute function with specific trailing slash configuration
 * @internal
 */
const makeCreateRoute = (trailingSlash: TrailingSlashMode = "both") => {
  return <P extends string, S = undefined>(
    path: P,
    value: RouteValue<P, S>,
    ...middlewares: Middleware<P, S>[]
  ): { [K in PathWithVariants<P>]: RouteValue<P, S> } => {
    const wrappedValue = wrapRouteValue(value, middlewares);
    const variants = normalizePathVariants(path, trailingSlash);

    // Build route object with all variants
    const routes: Record<string, RouteValue<P, S>> = {};
    for (const variant of variants) {
      routes[variant] = wrappedValue;
    }

    return routes as { [K in PathWithVariants<P>]: RouteValue<P, S> };
  };
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
 * Creates a createRouteGroup function with specific trailing slash configuration
 * @internal
 */
const makeCreateRouteGroup = (trailingSlash: TrailingSlashMode = "both") => {
  const createRoute = makeCreateRoute(trailingSlash);

  return <Prefix extends string, S = undefined>(
    prefix: Prefix,
    middlewares: Middleware<string, S>[] = [],
  ) => {
    return <P extends string>(
      path: P,
      value: RouteValue<`${Prefix}${P}`, S>,
    ) => {
      type FullPath = `${Prefix}${P}`;
      const fullPath = `${prefix}${path}` as FullPath;
      return createRoute(
        fullPath,
        value as RouteValue<FullPath, S>,
        ...(middlewares as unknown as Middleware<FullPath, S>[]),
      );
    };
  };
};

// ============================================================================
// Abret Factory
// ============================================================================

/**
 * Return type of createAbret factory
 */
export interface AbretInstance {
  /**
   * Creates a route with optional middleware support
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
  createRoute: ReturnType<typeof makeCreateRoute>;

  /**
   * Creates a route group factory with a common prefix and optional shared middlewares
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
  createRouteGroup: ReturnType<typeof makeCreateRouteGroup>;

  /**
   * Merges multiple route objects into a single routes object
   *
   * @example
   * ```ts
   * const routes = mergeRoutes(homeRoute, apiRoutes, userRoutes);
   * Bun.serve({ routes });
   * ```
   */
  mergeRoutes: typeof mergeRoutes;

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
  createMiddleware: typeof createMiddleware;

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
  composeMiddlewares: typeof composeMiddlewares;
}

/**
 * Creates an Abret instance with custom configuration.
 * This is the main entry point for creating routes with specific trailing slash behavior.
 *
 * @example
 * ```ts
 * import { createAbret } from "abret";
 *
 * // Create instance with custom config
 * const {
 *   createRoute,
 *   createRouteGroup,
 *   mergeRoutes,
 *   createMiddleware,
 *   composeMiddlewares
 * } = createAbret({
 *   trailingSlash: "strip"  // Only /hello works, not /hello/
 * });
 *
 * // Create middleware
 * const auth = createMiddleware((req, server, next) => {
 *   if (!req.headers.get("Authorization")) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 *   return next();
 * });
 *
 * // Create routes
 * const routes = mergeRoutes(
 *   createRoute("/", () => new Response("Home")),
 *   createRoute("/api/users", { GET: () => Response.json([]) }, auth),
 * );
 *
 * Bun.serve({ routes });
 * ```
 */
export const createAbret = (config: AbretConfig = {}): AbretInstance => {
  const { trailingSlash = "both" } = config;

  return {
    createRoute: makeCreateRoute(trailingSlash),
    createRouteGroup: makeCreateRouteGroup(trailingSlash),
    mergeRoutes,
    createMiddleware,
    composeMiddlewares,
  };
};
