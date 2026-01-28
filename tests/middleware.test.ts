import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createAbret } from "../src";
import { serveStatic } from "../src/middleware/static"; // Importing from source submodule per user request
import { join } from "path";
import { writeFile, unlink, mkdir, rmdir } from "fs/promises";

const { createRoute, mergeRoutes } = createAbret();

const TEST_DIR = "./tests/fixtures";
const TEST_FILE = "test.txt";
const TEST_CONTENT = "Hello, World!";
const TEST_HTML = "index.html";
const TEST_HTML_CONTENT = "<h1>Hello</h1>";

describe("serveStatic middleware", () => {
  // Setup: Create temporary files for testing
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, TEST_FILE), TEST_CONTENT);
    await writeFile(join(TEST_DIR, TEST_HTML), TEST_HTML_CONTENT);
  });

  // Teardown: Clean up temporary files
  afterAll(async () => {
    await unlink(join(TEST_DIR, TEST_FILE)).catch(() => {});
    await unlink(join(TEST_DIR, TEST_HTML)).catch(() => {});
    await rmdir(TEST_DIR).catch(() => {});
  });

  test("serves static file when it exists", async () => {
    const route = createRoute(
      "/static/*",
      () => new Response("Not Found", { status: 404 }),
      serveStatic({
        root: TEST_DIR,
        rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
      }),
    );

    const handler = route["/static/*"] as (
      req: Bun.BunRequest,
      server: Bun.Server<undefined>,
    ) => Promise<Response>;

    const mockReq = {
      url: `http://localhost/static/${TEST_FILE}`,
      method: "GET",
    } as Bun.BunRequest;

    // We mock server but we don't need it for serveStatic basic usage
    const mockServer = {} as Bun.Server<undefined>;
    const next = () => new Response("Not Found", { status: 404 });

    // The middleware is wrapped within the route handler.
    // However, createRoute wraps the middleware around the handler.
    // If we pass ONLY middleware to createRoute without a handler, it's not valid usage of createRoute usually.
    // Wait, createRoute signature is (path, handler, ...middlewares).
    // But serveStatic IS a middleware.
    // Usually usage is: app.use('/static/*', serveStatic()) in Hono.
    // In Abret: createRoute("/static/*", serveStatic({root})) ???

    // Let's check how serveStatic acts. It IS a middleware.
    // Abret `createRoute` expects a handler as 2nd argument.
    // If I want to use serveStatic as the main handler, I should probably do:
    // createRoute("/static/*", serveStatic({ root: TEST_DIR })) -- Wait, serveStatic returns a Middleware.
    // Middleware signature: (req, server, next) => Response

    // If I use it as a handler:
    // createRoute("/static/*", (req, server) => serveStatic({root})(req, server, () => new Response('404')));
    // Or if `serveStatic` returns a handler-compatible function.
    // Middleware matches handler signature mostly, except `next`.

    // Hono's serveStatic returns a MiddlewareHandler.
    // In Abret, Middleware signature is: (req, server, next) => Response.
    // Handler signature is: (req, server) => Response.

    // So if we use it as the main handler, we need to adapt it or just pass a dummy handler and use it as middleware.
    // e.g. createRoute("/static/*", () => new Response("404"), serveStatic(...))

    // But typically static file serving might finish the response.
    // So:
    // const staticMiddleware = serveStatic({ root: TEST_DIR });
    // const routes = createRoute("/static/*", (req, server) => staticMiddleware(req, server, () => new Response("Not Found")));

    // Let's see if we can make it cleaner or if that's the intended usage.
    // Hono usage: app.get('/static/*', serveStatic({root}))
    // Hono's app.get takes handlers/middleware.

    // Abret createRoute: `createRoute(path, handler, ...middlewares)`
    // So we need a dummy handler that only runs if static file is NOT found (and middleware calls next).

    const staticMiddleware = serveStatic({
      root: TEST_DIR,
      rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
    });

    // Simulating usage in createRoute
    // If serving static, we usually want the static middleware to run.
    // If it finds file -> returns response.
    // If not -> calls next -> which goes to handler.

    let handlerCalled = false;
    const dummyHandler = () => {
      handlerCalled = true;
      return new Response("Fallback");
    };

    const routeWithMiddleware = createRoute(
      "/static/*",
      dummyHandler,
      staticMiddleware,
    );

    const pathHandler = routeWithMiddleware["/static/*"] as Function;

    // Test HIT
    const resHit = await pathHandler(
      {
        url: `http://localhost/static/${TEST_FILE}`,
        method: "GET",
      },
      {},
    );

    expect(resHit.status).toBe(200);
    expect(await resHit.text()).toBe(TEST_CONTENT);
    expect(handlerCalled).toBe(false);
  });

  test("calls next (handler) when file does not exist", async () => {
    const staticMiddleware = serveStatic({
      root: TEST_DIR,
      rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
    });

    let handlerCalled = false;
    const dummyHandler = () => {
      handlerCalled = true;
      return new Response("Fallback");
    };

    const route = createRoute("/static/*", dummyHandler, staticMiddleware);

    const pathHandler = route["/static/*"] as Function;

    // Test MISS
    const resMiss = await pathHandler(
      {
        url: `http://localhost/static/missing.txt`,
        method: "GET",
      },
      {},
    );

    expect(handlerCalled).toBe(true);
    expect(await resMiss.text()).toBe("Fallback");
  });

  test("supports custom path option", async () => {
    // Serve a specific file for any request (e.g. for SPA)
    const staticMiddleware = serveStatic({
      path: join(TEST_DIR, TEST_FILE),
    });

    const route = createRoute(
      "/app/*",
      () => new Response("Fallback"),
      staticMiddleware,
    );

    const handler = route["/app/*"] as Function;

    const res = await handler(
      {
        url: "http://localhost/app/anything/here",
        method: "GET",
      },
      {},
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TEST_CONTENT);
  });

  test("supports rewriteRequestPath", async () => {
    const staticMiddleware = serveStatic({
      root: TEST_DIR,
      rewriteRequestPath: (path) => path.replace(/^\/api/, ""),
    });

    const route = createRoute(
      "/api/*",
      () => new Response("Fallback"),
      staticMiddleware,
    );

    const handler = route["/api/*"] as Function;

    // Request /api/test.txt -> rewrites to /test.txt -> looks in TEST_DIR/test.txt
    const res = await handler(
      {
        url: `http://localhost/api/${TEST_FILE}`,
        method: "GET",
      },
      {},
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TEST_CONTENT);
  });

  test("mimes option sets Content-Type", async () => {
    const staticMiddleware = serveStatic({
      root: TEST_DIR,
      mimes: {
        txt: "application/x-custom-text",
      },
      rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
    });

    const route = createRoute(
      "/static/*",
      () => new Response("Fallback"),
      staticMiddleware,
    );

    const handler = route["/static/*"] as Function;

    const res = await handler(
      {
        url: `http://localhost/static/${TEST_FILE}`,
        method: "GET",
      },
      {},
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-custom-text");
  });

  test("integration with Bun.serve", async () => {
    const staticMiddleware = serveStatic({
      root: TEST_DIR,
      rewriteRequestPath: (path) => path.replace(/^\/files/, ""),
    });

    // When using with Bun.serve, we often map the route directly.
    // But abret expects a handler.
    // Typically:
    // createRoute("/files/*", () => new Response("Not Found", {status: 404}), serveStatic({root: TEST_DIR}))

    const routes = createRoute(
      "/files/*",
      () => new Response("Not Found", { status: 404 }),
      staticMiddleware,
    );

    const server = Bun.serve({
      port: 0,
      routes: routes,
      fetch() {
        return new Response("404 global");
      },
    });

    try {
      // Fetch existing file
      const res = await fetch(`${server.url}files/${TEST_FILE}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(TEST_CONTENT);

      // Fetch missing file
      const resMissing = await fetch(`${server.url}files/missing.txt`);
      expect(resMissing.status).toBe(404);
      expect(await resMissing.text()).toBe("Not Found");
    } finally {
      server.stop();
    }
  });
});
