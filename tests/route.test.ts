import { describe, expect, test } from "bun:test";
import {
  composeMiddlewares,
  createMiddleware,
  createRoute,
  mergeRoutes,
} from "../src";
import {
  createContext,
  hasContext,
  runWithContext,
  setContext,
  useContext,
} from "../src/store";

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
    const middleware = createMiddleware((_req, _server, next) => {
      return next();
    });
    expect(typeof middleware).toBe("function");
  });
});

describe("middleware integration", () => {
  test("middleware can intercept and return early", async () => {
    const authMiddleware = createMiddleware((_req, _server, _next) => {
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
    const loggingMiddleware = createMiddleware((_req, _server, next) => {
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

    const first = createMiddleware((_req, _server, next) => {
      order.push(1);
      return next();
    });

    const second = createMiddleware((_req, _server, next) => {
      order.push(2);
      return next();
    });

    const third = createMiddleware((_req, _server, next) => {
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
    const authMiddleware = createMiddleware((_req, _server, next) => {
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

    const getResponse = await handlers.GET?.(mockReq, mockServer);
    if (!getResponse) throw new Error("GET handler not found");
    expect(getResponse.status).toBe(200);

    const postResponse = await handlers.POST?.(mockReq, mockServer);
    if (!postResponse) throw new Error("POST handler not found");
    expect(postResponse.status).toBe(200);
  });

  test("middleware can short-circuit method handlers", async () => {
    const blockMiddleware = createMiddleware((_req, _server, _next) => {
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

    const response = await handlers.GET?.(mockReq, mockServer);
    if (!response) throw new Error("GET handler not found");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Blocked");
  });
});

describe("composeMiddlewares", () => {
  test("composes multiple middlewares into one", async () => {
    const order: string[] = [];

    const logMiddleware = createMiddleware((_req, _server, next) => {
      order.push("log");
      return next();
    });

    const authMiddleware = createMiddleware((_req, _server, next) => {
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
    const passMiddleware = createMiddleware((_req, _server, next) => {
      return next();
    });

    const blockMiddleware = createMiddleware((_req, _server, _next) => {
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
    const asyncMiddleware = createMiddleware(async (_req, _server, next) => {
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
    const timingMiddleware = createMiddleware(async (_req, _server, next) => {
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
    const authMiddleware = createMiddleware((_req, _server, next) => {
      // Middleware sets user in context (no req needed!)
      setContext(UserContext, {
        id: "auth-123",
        name: "Authenticated User",
      });
      return next();
    });

    const route = createRoute(
      "/protected",
      (_req) => {
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

    const requestIdMiddleware = createMiddleware((_req, _server, next) => {
      setContext(RequestIdContext, `req-${Date.now()}`);
      return next();
    });

    const authMiddleware = createMiddleware((_req, _server, next) => {
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
      (_req) => {
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

describe("Routing (Exact Matching)", () => {
  test("registers path exactly as defined", () => {
    const route = createRoute("/hello", () => new Response("Hello"));

    expect(route).toHaveProperty("/hello");
    expect(route).not.toHaveProperty("/hello/");
    expect(Object.keys(route).length).toBe(1);
  });

  test("registers path with trailing slash exactly as defined", () => {
    const route = createRoute("/hello/", () => new Response("Hello"));

    expect(route).toHaveProperty("/hello/");
    expect(route).not.toHaveProperty("/hello");
    expect(Object.keys(route).length).toBe(1);
  });

  test("works with real server - no automatic redirects", async () => {
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
      // Exact match works
      const res1 = await fetch(`${server.url}api/hello`);
      expect(await res1.text()).toBe("Hello API");

      // No automatic redirect anymore - should return 404 (from fetch fallback)
      const res2 = await fetch(`${server.url}api/hello/`);
      expect(res2.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});
