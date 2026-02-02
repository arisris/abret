import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { transpiler } from "../src/middleware/transpiler";

const TEST_SRC_DIR = resolve("./tests/transpiler-src");
const STATIC_BASE = "/_modules";

describe("transpiler middleware", () => {
  beforeAll(async () => {
    await mkdir(TEST_SRC_DIR, { recursive: true });

    // Create a dummy TS file
    await writeFile(
      join(TEST_SRC_DIR, "math.ts"),
      "export const add = (a: number, b: number): number => a + b;",
    );

    // Create a TSX file with imports
    await writeFile(
      join(TEST_SRC_DIR, "App.tsx"),
      `import { h } from "preact";
import { add } from "./math";
export const App = () => <div>{add(1, 2)}</div>;`,
    );
  });

  afterAll(async () => {
    await unlink(join(TEST_SRC_DIR, "math.ts")).catch(() => {});
    await unlink(join(TEST_SRC_DIR, "App.tsx")).catch(() => {});
    await rmdir(TEST_SRC_DIR).catch(() => {});

    // Clean up cache if created during tests
    // const cacheDir = resolve("./node_modules/.transpiler");
  });

  test("transpiles .ts file and serves as .js", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    const req = new Request(`http://localhost${STATIC_BASE}/math.js`);
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
    const content = await res.text();
    expect(content).toContain("add");
    expect(content).toContain("export");
    expect(content).not.toContain(": number"); // types should be stripped
  });

  test("rewrites imports in .tsx file", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    const req = new Request(`http://localhost${STATIC_BASE}/App.js`);
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);

    expect(res.status).toBe(200);
    const content = await res.text();

    // Check bare specifier rewriting (it might be preact or react depending on environment)
    expect(content).toContain(`${STATIC_BASE}/vendor/`);

    // Check relative import extension appending
    expect(content).toContain('from "./math.js"');
  });

  test("handles vendor bundling (integration-ish)", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    const req = new Request(
      `http://localhost${STATIC_BASE}/vendor/non-existent-pkg`,
    );
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);
    expect(res.status).toBe(404); // Should call next() on failure
  });

  test("prevents bundling untrusted dependencies", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    // 'zod' might be in node_modules (if installed), but it's not in our source code
    // and hasn't been bundled yet.
    const req = new Request(`http://localhost${STATIC_BASE}/vendor/package-that-does-not-exist-anywhere-123`);
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);
    expect(res.status).toBe(404); // Should be blocked because it's untrusted
  });

  test("bundles real vendor module (typescript)", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      prewarm: ["typescript"], // Trust typescript for this test
    });

    const req = new Request(`http://localhost${STATIC_BASE}/vendor/typescript`);
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
    const content = await res.text();
    expect(content).toContain("export");

    // Check if it's cached
    const cacheDir = resolve("./node_modules/.transpiler");
    expect(existsSync(join(cacheDir, "typescript.js"))).toBe(true);
  });

  test("bundles nested vendor dependencies properly (typescript -> ...)", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      prewarm: ["typescript"],
    });

    const req = new Request(
      `http://localhost${STATIC_BASE}/vendor/typescript`,
    );
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);
    expect(res.status).toBe(200);
  });

  test("serves from cache if vendor module bundle exists", async () => {
    const cacheDir = resolve("./node_modules/.transpiler");
    if (!existsSync(cacheDir)) {
      await mkdir(cacheDir, { recursive: true });
    }

    const dummyVendorFile = join(cacheDir, "dummy-pkg.js");
    const dummyContent = "export const dummy = true;";
    await writeFile(dummyVendorFile, dummyContent);

    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      prewarm: ["dummy-pkg"], // Trust dummy-pkg for this test
    });

    const req = new Request(`http://localhost${STATIC_BASE}/vendor/dummy-pkg`);
    const next = () => new Response("Not Found", { status: 404 });

    const res = await middleware(req as any, {} as any, next);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(dummyContent);
    expect(res.headers.get("Cache-Control")).toContain("immutable");

    // Clean up
    await unlink(dummyVendorFile);
  });
});
