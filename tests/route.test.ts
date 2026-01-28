import { test, expect, describe } from "bun:test";
import { createAbret } from "../src";
import {
  createContext,
  setContext,
  useContext,
  hasContext,
  runWithContext,
} from "../src/store";

// Default instance with "both" trailing slash mode
const {
  createRoute,
  createRouteGroup,
  mergeRoutes,
  createMiddleware,
  composeMiddlewares,
} = createAbret();

describe("createRoute", () => {
  test("creates basic route without middleware", () => {
    const route = createRoute("/test", () => new Response("OK"));
    expect(route).toHaveProperty("/test");
    expect(typeof route["/test"]).toBe("function");
  });

  test("creates route with method handlers", () => {
    const route = createRoute("/api", {
      GET: () => new Response("GET"),
      POST: () => new Response("POST"),
    });
    expect(route).toHaveProperty("/api");
    expect(typeof route["/api"]).toBe("object");
  });

  test("creates route with static Response", () => {
    const route = createRoute("/static", new Response("Static"));
    expect(route).toHaveProperty("/static");
  });
});

describe("createMiddleware", () => {
  test("creates middleware function", () => {
    const middleware = createMiddleware((req, server, next) => {
      return next();
    });
    expect(typeof middleware).toBe("function");
  });
});

describe("middleware integration", () => {
  test("middleware can intercept and return early", async () => {
    const authMiddleware = createMiddleware((req, server, next) => {
      return new Response("Unauthorized", { status: 401 });
    });

    const route = createRoute(
      "/protected",
      () => new Response("Secret"),
      authMiddleware,
    );

    const handler = route["/protected"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = { url: "http://localhost/protected" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  test("middleware can pass to next handler", async () => {
    const loggingMiddleware = createMiddleware((req, server, next) => {
      return next();
    });

    const route = createRoute(
      "/public",
      () => new Response("Public Content"),
      loggingMiddleware,
    );

    const handler = route["/public"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = { url: "http://localhost/public" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Public Content");
  });

  test("multiple middlewares execute in order", async () => {
    const order: number[] = [];

    const first = createMiddleware((req, server, next) => {
      order.push(1);
      return next();
    });

    const second = createMiddleware((req, server, next) => {
      order.push(2);
      return next();
    });

    const third = createMiddleware((req, server, next) => {
      order.push(3);
      return next();
    });

    const route = createRoute(
      "/ordered",
      () => {
        order.push(4);
        return new Response("Done");
      },
      first,
      second,
      third,
    );

    const handler = route["/ordered"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = { url: "http://localhost/ordered" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    await handler(mockReq, mockServer);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("middleware works with method handlers", async () => {
    const authMiddleware = createMiddleware((req, server, next) => {
      return next();
    });

    const route = createRoute(
      "/api/users",
      {
        GET: () => Response.json({ users: [] }),
        POST: () => Response.json({ created: true }),
      },
      authMiddleware,
    );

    const handlers = route["/api/users"] as Record<
      string,
      (req: Bun.BunRequest, server: Bun.Server<undefined>) => Response
    >;

    const mockReq = { url: "http://localhost/api/users" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const getResponse = await handlers.GET!(mockReq, mockServer);
    expect(getResponse.status).toBe(200);

    const postResponse = await handlers.POST!(mockReq, mockServer);
    expect(postResponse.status).toBe(200);
  });

  test("middleware can short-circuit method handlers", async () => {
    const blockMiddleware = createMiddleware((req, server, next) => {
      return new Response("Blocked", { status: 403 });
    });

    const route = createRoute(
      "/api/blocked",
      {
        GET: () => new Response("Should not reach"),
      },
      blockMiddleware,
    );

    const handlers = route["/api/blocked"] as Record<
      string,
      (req: Bun.BunRequest, server: Bun.Server<undefined>) => Response
    >;

    const mockReq = { url: "http://localhost/api/blocked" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handlers.GET!(mockReq, mockServer);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Blocked");
  });
});

describe("composeMiddlewares", () => {
  test("composes multiple middlewares into one", async () => {
    const order: string[] = [];

    const logMiddleware = createMiddleware((req, server, next) => {
      order.push("log");
      return next();
    });

    const authMiddleware = createMiddleware((req, server, next) => {
      order.push("auth");
      return next();
    });

    const combined = composeMiddlewares(logMiddleware, authMiddleware);

    const route = createRoute(
      "/composed",
      () => {
        order.push("handler");
        return new Response("OK");
      },
      combined,
    );

    const handler = route["/composed"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = { url: "http://localhost/composed" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    await handler(mockReq, mockServer);
    expect(order).toEqual(["log", "auth", "handler"]);
  });

  test("composed middleware can short-circuit", async () => {
    const passMiddleware = createMiddleware((req, server, next) => {
      return next();
    });

    const blockMiddleware = createMiddleware((req, server, next) => {
      return new Response("Blocked", { status: 403 });
    });

    const combined = composeMiddlewares(passMiddleware, blockMiddleware);

    const route = createRoute(
      "/blocked",
      () => new Response("Should not reach"),
      combined,
    );

    const handler = route["/blocked"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = { url: "http://localhost/blocked" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    expect(response.status).toBe(403);
  });
});

describe("async middleware", () => {
  test("async middleware works correctly", async () => {
    const asyncMiddleware = createMiddleware(async (req, server, next) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return next();
    });

    const route = createRoute(
      "/async",
      () => new Response("Async OK"),
      asyncMiddleware,
    );

    const handler = route["/async"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Promise<Response>;

    const mockReq = { url: "http://localhost/async" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Async OK");
  });

  test("async middleware can modify response", async () => {
    const timingMiddleware = createMiddleware(async (req, server, next) => {
      const start = Date.now();
      const response = await next();
      const duration = Date.now() - start;
      // Clone response with added header
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          "X-Response-Time": `${duration}ms`,
        },
      });
    });

    const route = createRoute(
      "/timed",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response("Timed");
      },
      timingMiddleware,
    );

    const handler = route["/timed"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Promise<Response>;

    const mockReq = { url: "http://localhost/timed" } as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    expect(response.headers.has("X-Response-Time")).toBe(true);
  });
});

// ============================================================================
// Request Context System Tests
// ============================================================================

describe("Request Context System", () => {
  // Define context keys for testing
  const UserContext = createContext<{ id: string; name: string }>("user");
  const SessionContext = createContext<string>("session");
  const CountContext = createContext<number>("count");

  test("createContext creates unique symbols", () => {
    const key1 = createContext<string>("test");
    const key2 = createContext<string>("test");
    expect(key1).not.toBe(key2); // Same name, different symbols
    expect(typeof key1).toBe("symbol");
  });

  test("setContext and useContext work correctly", () => {
    runWithContext(() => {
      setContext(UserContext, { id: "123", name: "John" });
      setContext(SessionContext, "abc-session-id");

      const user = useContext(UserContext);
      const session = useContext(SessionContext);

      expect(user).toEqual({ id: "123", name: "John" });
      expect(session).toBe("abc-session-id");
    });
  });

  test("useContext returns undefined for missing keys", () => {
    runWithContext(() => {
      const user = useContext(UserContext);
      expect(user).toBeUndefined();
    });
  });

  test("hasContext checks key existence", () => {
    runWithContext(() => {
      expect(hasContext(UserContext)).toBe(false);

      setContext(UserContext, { id: "1", name: "Test" });

      expect(hasContext(UserContext)).toBe(true);
      expect(hasContext(SessionContext)).toBe(false);
    });
  });

  test("useContext with required throws for missing keys", () => {
    runWithContext(() => {
      expect(() => useContext(UserContext, { required: true })).toThrow(
        'Context "user" is required but not set',
      );
    });
  });

  test("useContext with required returns value when present", () => {
    runWithContext(() => {
      setContext(UserContext, { id: "456", name: "Jane" });
      const user = useContext(UserContext, { required: true });
      expect(user).toEqual({ id: "456", name: "Jane" });
    });
  });

  test("context is isolated per runWithContext", async () => {
    const results: (string | undefined)[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithContext(() => {
          setContext(SessionContext, "session-1");
          setTimeout(() => {
            results.push(useContext(SessionContext));
            resolve();
          }, 10);
        });
      }),
      new Promise<void>((resolve) => {
        runWithContext(() => {
          setContext(SessionContext, "session-2");
          setTimeout(() => {
            results.push(useContext(SessionContext));
            resolve();
          }, 5);
        });
      }),
    ]);

    expect(results.sort()).toEqual(["session-1", "session-2"]);
  });

  test("context can be updated", () => {
    runWithContext(() => {
      setContext(CountContext, 1);
      expect(useContext(CountContext)).toBe(1);

      setContext(CountContext, 2);
      expect(useContext(CountContext)).toBe(2);
    });
  });

  test("middleware can set context for handler", async () => {
    const authMiddleware = createMiddleware((req, server, next) => {
      // Middleware sets user in context (no req needed!)
      setContext(UserContext, {
        id: "auth-123",
        name: "Authenticated User",
      });
      return next();
    });

    const route = createRoute(
      "/protected",
      (req) => {
        // Handler uses context (no req needed!)
        const user = useContext(UserContext);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json({ message: `Hello ${user.name}` });
      },
      authMiddleware,
    );

    const handler = route["/protected"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = new Request("http://localhost/protected") as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ message: "Hello Authenticated User" });
  });

  test("multiple middlewares can share context", async () => {
    const RequestIdContext = createContext<string>("requestId");

    const requestIdMiddleware = createMiddleware((req, server, next) => {
      setContext(RequestIdContext, `req-${Date.now()}`);
      return next();
    });

    const authMiddleware = createMiddleware((req, server, next) => {
      const requestId = useContext(RequestIdContext);
      // Auth middleware can access requestId set by previous middleware
      setContext(UserContext, {
        id: "user-1",
        name: `User with request ${requestId}`,
      });
      return next();
    });

    const route = createRoute(
      "/test",
      (req) => {
        const requestId = useContext(RequestIdContext);
        const user = useContext(UserContext);
        return Response.json({ requestId, user });
      },
      requestIdMiddleware,
      authMiddleware,
    );

    const handler = route["/test"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Response;

    const mockReq = new Request("http://localhost/test") as Bun.BunRequest;
    const mockServer = {} as Bun.Server<undefined>;

    const response = await handler(mockReq, mockServer);
    const json = await response.json();

    expect(json.requestId).toMatch(/^req-\d+$/);
    expect(json.user.id).toBe("user-1");
  });
});

// ============================================================================
// Trailing Slash Normalization Tests
// ============================================================================

describe("Trailing Slash Normalization", () => {
  describe("createRoute trailing slash handling", () => {
    test("creates both variants for basic route", () => {
      const route = createRoute("/hello", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(route).toHaveProperty("/hello/");
      expect(typeof route["/hello"]).toBe("function");
      expect(typeof route["/hello/"]).toBe("function");
    });

    test("creates both variants for route defined with trailing slash", () => {
      const route = createRoute("/hello/", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(route).toHaveProperty("/hello/");
    });

    test("root path only creates single variant", () => {
      const route = createRoute("/", () => new Response("Home"));

      expect(route).toHaveProperty("/");
      expect(Object.keys(route).length).toBe(1);
    });

    test("both variants return same response", async () => {
      const route = createRoute("/test", () => new Response("Test Content"));

      const mockReq = { url: "http://localhost/test" } as Bun.BunRequest;
      const mockServer = {} as Bun.Server<undefined>;

      const handler = route["/test"] as (
        req: Bun.BunRequest,
        server: Bun.Server<undefined>,
      ) => Response;
      const handlerWithSlash = route["/test/"] as (
        req: Bun.BunRequest,
        server: Bun.Server<undefined>,
      ) => Response;

      const response1 = await handler(mockReq, mockServer);
      const response2 = await handlerWithSlash(mockReq, mockServer);

      expect(await response1.text()).toBe("Test Content");
      expect(await response2.text()).toBe("Test Content");
    });

    test("creates both variants for route with method handlers", () => {
      const route = createRoute("/api", {
        GET: () => Response.json({ method: "GET" }),
        POST: () => Response.json({ method: "POST" }),
      });

      expect(route).toHaveProperty("/api");
      expect(route).toHaveProperty("/api/");
      expect(typeof route["/api"]).toBe("object");
      expect(typeof route["/api/"]).toBe("object");
    });

    test("creates both variants for dynamic routes", () => {
      const route = createRoute("/users/:id", (req) =>
        Response.json({ id: req.params.id }),
      );

      expect(route).toHaveProperty("/users/:id");
      expect(route).toHaveProperty("/users/:id/");
    });

    test("creates both variants for nested path", () => {
      const route = createRoute("/api/v1/users", () => new Response("Users"));

      expect(route).toHaveProperty("/api/v1/users");
      expect(route).toHaveProperty("/api/v1/users/");
    });

    test("middleware works with both trailing slash variants", async () => {
      const order: string[] = [];

      const logMiddleware = createMiddleware((req, server, next) => {
        order.push("middleware");
        return next();
      });

      const route = createRoute(
        "/protected",
        () => {
          order.push("handler");
          return new Response("Protected");
        },
        logMiddleware,
      );

      const mockReq = { url: "http://localhost/protected" } as Bun.BunRequest;
      const mockServer = {} as Bun.Server<undefined>;

      // Test without trailing slash
      const handler = route["/protected"] as (
        req: Bun.BunRequest,
        server: Bun.Server<undefined>,
      ) => Response;
      await handler(mockReq, mockServer);

      expect(order).toEqual(["middleware", "handler"]);

      // Reset and test with trailing slash
      order.length = 0;

      const handlerWithSlash = route["/protected/"] as (
        req: Bun.BunRequest,
        server: Bun.Server<undefined>,
      ) => Response;
      await handlerWithSlash(mockReq, mockServer);

      expect(order).toEqual(["middleware", "handler"]);
    });
  });

  describe("createRouteGroup trailing slash handling", () => {
    test("creates both variants for grouped route", () => {
      const api = createRouteGroup("/api");

      const route = api("/users", () => Response.json({ users: [] }));

      expect(route).toHaveProperty("/api/users");
      expect(route).toHaveProperty("/api/users/");
    });

    test("creates both variants for grouped route with trailing slash in path", () => {
      const api = createRouteGroup("/api");

      const route = api("/users/", () => Response.json({ users: [] }));

      expect(route).toHaveProperty("/api/users");
      expect(route).toHaveProperty("/api/users/");
    });

    test("creates both variants for grouped dynamic route", () => {
      const api = createRouteGroup("/api");

      const route = api("/users/:id", (req) =>
        Response.json({ id: req.params.id }),
      );

      expect(route).toHaveProperty("/api/users/:id");
      expect(route).toHaveProperty("/api/users/:id/");
    });

    test("middleware applies to both variants in route group", async () => {
      const order: string[] = [];

      const authMiddleware = createMiddleware((req, server, next) => {
        order.push("auth");
        return next();
      });

      const api = createRouteGroup("/api", [authMiddleware]);

      const route = api("/protected", () => {
        order.push("handler");
        return new Response("OK");
      });

      const mockReq = {
        url: "http://localhost/api/protected",
      } as Bun.BunRequest;
      const mockServer = {} as Bun.Server<undefined>;

      // Test without trailing slash
      const handler = route["/api/protected"] as (
        req: Bun.BunRequest,
        server: Bun.Server<undefined>,
      ) => Response;
      await handler(mockReq, mockServer);

      expect(order).toEqual(["auth", "handler"]);

      // Reset and test with trailing slash
      order.length = 0;

      const handlerWithSlash = route["/api/protected/"] as (
        req: Bun.BunRequest,
        server: Bun.Server<undefined>,
      ) => Response;
      await handlerWithSlash(mockReq, mockServer);

      expect(order).toEqual(["auth", "handler"]);
    });
  });

  describe("mergeRoutes with trailing slash variants", () => {
    test("merges routes with all trailing slash variants", () => {
      const routes = mergeRoutes(
        createRoute("/hello", () => new Response("Hello")),
        createRoute("/world", () => new Response("World")),
      );

      expect(routes).toHaveProperty("/hello");
      expect(routes).toHaveProperty("/hello/");
      expect(routes).toHaveProperty("/world");
      expect(routes).toHaveProperty("/world/");
    });

    test("merges grouped routes with all trailing slash variants", () => {
      const api = createRouteGroup("/api");

      const routes = mergeRoutes(
        api("/users", () => Response.json([])),
        api("/posts", () => Response.json([])),
      );

      expect(routes).toHaveProperty("/api/users");
      expect(routes).toHaveProperty("/api/users/");
      expect(routes).toHaveProperty("/api/posts");
      expect(routes).toHaveProperty("/api/posts/");
    });
  });

  describe("Trailing slash with real Bun.serve integration", () => {
    test("routes work with and without trailing slash in server", async () => {
      const routes = mergeRoutes(
        createRoute("/", () => new Response("Home")),
        createRoute("/api/hello", () => new Response("Hello API")),
        createRoute("/api/users/:id", (req) =>
          Response.json({ id: req.params.id }),
        ),
      );

      const server = Bun.serve({
        port: 0, // Random available port
        routes,
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      });

      try {
        // Test root (only one variant)
        const rootRes = await fetch(`${server.url}`);
        expect(await rootRes.text()).toBe("Home");

        // Test without trailing slash
        const res1 = await fetch(`${server.url}api/hello`);
        expect(await res1.text()).toBe("Hello API");

        // Test with trailing slash
        const res2 = await fetch(`${server.url}api/hello/`);
        expect(await res2.text()).toBe("Hello API");

        // Test dynamic route without trailing slash
        const res3 = await fetch(`${server.url}api/users/123`);
        expect(((await res3.json()) as { id: string }).id).toBe("123");

        // Test dynamic route with trailing slash
        const res4 = await fetch(`${server.url}api/users/456/`);
        expect(((await res4.json()) as { id: string }).id).toBe("456");
      } finally {
        server.stop();
      }
    });

    test("route group works with trailing slash in server", async () => {
      const api = createRouteGroup("/api/v1");

      const routes = mergeRoutes(
        createRoute("/", () => new Response("Home")),
        api("/status", () => Response.json({ status: "ok" })),
        api("/users", () => Response.json({ users: [] })),
      );

      const server = Bun.serve({
        port: 0,
        routes,
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      });

      try {
        // Test without trailing slash
        const res1 = await fetch(`${server.url}api/v1/status`);
        expect(((await res1.json()) as { status: string }).status).toBe("ok");

        // Test with trailing slash
        const res2 = await fetch(`${server.url}api/v1/status/`);
        expect(((await res2.json()) as { status: string }).status).toBe("ok");

        // Test another route without trailing slash
        const res3 = await fetch(`${server.url}api/v1/users`);
        expect(((await res3.json()) as { users: unknown[] }).users).toEqual([]);

        // Test another route with trailing slash
        const res4 = await fetch(`${server.url}api/v1/users/`);
        expect(((await res4.json()) as { users: unknown[] }).users).toEqual([]);
      } finally {
        server.stop();
      }
    });
  });
});

// ============================================================================
// createAbret Factory Tests
// ============================================================================

describe("createAbret", () => {
  describe('trailingSlash: "both" (default)', () => {
    test("creates both path variants", () => {
      const { createRoute } = createAbret({ trailingSlash: "both" });

      const route = createRoute("/hello", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(route).toHaveProperty("/hello/");
      expect(Object.keys(route).length).toBe(2);
    });

    test("default config uses 'both' mode", () => {
      const { createRoute } = createAbret(); // No config = default

      const route = createRoute("/hello", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(route).toHaveProperty("/hello/");
    });

    test("normalizes path with trailing slash to both variants", () => {
      const { createRoute } = createAbret({ trailingSlash: "both" });

      const route = createRoute("/hello/", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(route).toHaveProperty("/hello/");
    });
  });

  describe('trailingSlash: "strip"', () => {
    test("creates only path without trailing slash", () => {
      const { createRoute } = createAbret({ trailingSlash: "strip" });

      const route = createRoute("/hello", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(Object.keys(route).length).toBe(1);
    });

    test("strips trailing slash from defined path", () => {
      const { createRoute } = createAbret({ trailingSlash: "strip" });

      const route = createRoute("/hello/", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(Object.keys(route).length).toBe(1);
    });

    test("works with route groups", () => {
      const { createRoute, createRouteGroup } = createAbret({
        trailingSlash: "strip",
      });

      const api = createRouteGroup("/api");
      const route = api("/users/", () => Response.json([]));

      expect(route).toHaveProperty("/api/users");
      expect(Object.keys(route).length).toBe(1);

      // Ensure createRoute from same instance also uses strip mode
      const directRoute = createRoute("/test/", () => new Response("Test"));
      expect(directRoute).toHaveProperty("/test");
      expect(Object.keys(directRoute).length).toBe(1);
    });

    test("works with real server - only non-slash routes work", async () => {
      const { createRoute, mergeRoutes } = createAbret({
        trailingSlash: "strip",
      });

      const routes = mergeRoutes(
        createRoute("/", () => new Response("Home")),
        createRoute("/api/hello", () => new Response("Hello API")),
      );

      const server = Bun.serve({
        port: 0,
        routes,
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      });

      try {
        // Without trailing slash works
        const res1 = await fetch(`${server.url}api/hello`);
        expect(await res1.text()).toBe("Hello API");

        // With trailing slash should 404
        const res2 = await fetch(`${server.url}api/hello/`);
        expect(res2.status).toBe(404);
      } finally {
        server.stop();
      }
    });
  });

  describe('trailingSlash: "none" (manual)', () => {
    test("uses exact path as defined without slash", () => {
      const { createRoute } = createAbret({ trailingSlash: "none" });

      const route = createRoute("/hello", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello");
      expect(Object.keys(route).length).toBe(1);
    });

    test("uses exact path as defined with slash", () => {
      const { createRoute } = createAbret({ trailingSlash: "none" });

      const route = createRoute("/hello/", () => new Response("Hello"));

      expect(route).toHaveProperty("/hello/");
      expect(Object.keys(route).length).toBe(1);
    });

    test("allows different handlers for different paths", () => {
      const { createRoute, mergeRoutes } = createAbret({
        trailingSlash: "none",
      });

      const routes = mergeRoutes(
        createRoute("/hello", () => new Response("Without slash")),
        createRoute("/hello/", () => new Response("With slash")),
      );

      expect(routes).toHaveProperty("/hello");
      expect(routes).toHaveProperty("/hello/");
    });

    test("works with route groups - exact path preserved", () => {
      const { createRouteGroup } = createAbret({ trailingSlash: "none" });

      const api = createRouteGroup("/api");
      const route = api("/users/", () => Response.json([]));

      expect(route).toHaveProperty("/api/users/");
      expect(Object.keys(route).length).toBe(1);
    });

    test("works with real server - only exact paths work", async () => {
      const { createRoute, mergeRoutes } = createAbret({
        trailingSlash: "none",
      });

      const routes = mergeRoutes(
        createRoute("/", () => new Response("Home")),
        createRoute("/api/hello", () => new Response("No slash")),
        createRoute("/api/world/", () => new Response("With slash")),
      );

      const server = Bun.serve({
        port: 0,
        routes,
        fetch() {
          return new Response("Not Found", { status: 404 });
        },
      });

      try {
        // /api/hello works, /api/hello/ should 404
        const res1 = await fetch(`${server.url}api/hello`);
        expect(await res1.text()).toBe("No slash");

        const res2 = await fetch(`${server.url}api/hello/`);
        expect(res2.status).toBe(404);

        // /api/world/ works, /api/world should 404
        const res3 = await fetch(`${server.url}api/world/`);
        expect(await res3.text()).toBe("With slash");

        const res4 = await fetch(`${server.url}api/world`);
        expect(res4.status).toBe(404);
      } finally {
        server.stop();
      }
    });
  });

  describe("root path handling", () => {
    test("root path always has single variant regardless of config", () => {
      for (const mode of ["both", "strip", "none"] as const) {
        const { createRoute } = createAbret({ trailingSlash: mode });
        const route = createRoute("/", () => new Response("Home"));
        expect(Object.keys(route).length).toBe(1);
        expect(route).toHaveProperty("/");
      }
    });
  });

  describe("multiple instances with different configs", () => {
    test("each instance uses its own config", () => {
      const bothAbret = createAbret({ trailingSlash: "both" });
      const stripAbret = createAbret({ trailingSlash: "strip" });
      const noneAbret = createAbret({ trailingSlash: "none" });

      const bothRoute = bothAbret.createRoute(
        "/test",
        () => new Response("Both"),
      );
      const stripRoute = stripAbret.createRoute(
        "/test",
        () => new Response("Strip"),
      );
      const noneRoute = noneAbret.createRoute(
        "/test",
        () => new Response("None"),
      );

      expect(Object.keys(bothRoute).length).toBe(2);
      expect(Object.keys(stripRoute).length).toBe(1);
      expect(Object.keys(noneRoute).length).toBe(1);

      expect(bothRoute).toHaveProperty("/test");
      expect(bothRoute).toHaveProperty("/test/");
      expect(stripRoute).toHaveProperty("/test");
      expect(noneRoute).toHaveProperty("/test");
    });
  });
});
