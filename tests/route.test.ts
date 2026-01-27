import { test, expect, describe } from "bun:test";
import {
  createRoute,
  createMiddleware,
  composeMiddlewares,
  createContextKey,
  setContext,
  getContext,
  requireContext,
  hasContext,
} from "../src";

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
  const UserContext = createContextKey<{ id: string; name: string }>("user");
  const SessionContext = createContextKey<string>("session");
  const CountContext = createContextKey<number>("count");

  test("createContextKey creates unique symbols", () => {
    const key1 = createContextKey<string>("test");
    const key2 = createContextKey<string>("test");
    expect(key1).not.toBe(key2); // Same name, different symbols
    expect(typeof key1).toBe("symbol");
  });

  test("setContext and getContext work correctly", () => {
    const req = new Request("http://localhost/test");

    setContext(req, UserContext, { id: "123", name: "John" });
    setContext(req, SessionContext, "abc-session-id");

    const user = getContext(req, UserContext);
    const session = getContext(req, SessionContext);

    expect(user).toEqual({ id: "123", name: "John" });
    expect(session).toBe("abc-session-id");
  });

  test("getContext returns undefined for missing keys", () => {
    const req = new Request("http://localhost/test");

    const user = getContext(req, UserContext);
    expect(user).toBeUndefined();
  });

  test("hasContext checks key existence", () => {
    const req = new Request("http://localhost/test");

    expect(hasContext(req, UserContext)).toBe(false);

    setContext(req, UserContext, { id: "1", name: "Test" });

    expect(hasContext(req, UserContext)).toBe(true);
    expect(hasContext(req, SessionContext)).toBe(false);
  });

  test("requireContext throws for missing keys", () => {
    const req = new Request("http://localhost/test");

    expect(() => requireContext(req, UserContext)).toThrow(
      'Context key "user" is required but not set',
    );
  });

  test("requireContext returns value when present", () => {
    const req = new Request("http://localhost/test");
    setContext(req, UserContext, { id: "456", name: "Jane" });

    const user = requireContext(req, UserContext);
    expect(user).toEqual({ id: "456", name: "Jane" });
  });

  test("context is isolated per request", () => {
    const req1 = new Request("http://localhost/test1");
    const req2 = new Request("http://localhost/test2");

    setContext(req1, UserContext, { id: "1", name: "User1" });
    setContext(req2, UserContext, { id: "2", name: "User2" });

    expect(getContext(req1, UserContext)).toEqual({ id: "1", name: "User1" });
    expect(getContext(req2, UserContext)).toEqual({ id: "2", name: "User2" });
  });

  test("context can be updated", () => {
    const req = new Request("http://localhost/test");

    setContext(req, CountContext, 1);
    expect(getContext(req, CountContext)).toBe(1);

    setContext(req, CountContext, 2);
    expect(getContext(req, CountContext)).toBe(2);
  });

  test("middleware can set context for handler", async () => {
    const authMiddleware = createMiddleware((req, server, next) => {
      // Simulate auth - set user in context
      setContext(req, UserContext, {
        id: "auth-123",
        name: "Authenticated User",
      });
      return next();
    });

    const route = createRoute(
      "/protected",
      (req) => {
        const user = getContext(req, UserContext);
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
    const RequestIdContext = createContextKey<string>("requestId");

    const requestIdMiddleware = createMiddleware((req, server, next) => {
      setContext(req, RequestIdContext, `req-${Date.now()}`);
      return next();
    });

    const authMiddleware = createMiddleware((req, server, next) => {
      const requestId = getContext(req, RequestIdContext);
      // Auth middleware can access requestId set by previous middleware
      setContext(req, UserContext, {
        id: "user-1",
        name: `User with request ${requestId}`,
      });
      return next();
    });

    const route = createRoute(
      "/test",
      (req) => {
        const requestId = getContext(req, RequestIdContext);
        const user = getContext(req, UserContext);
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
