import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { transpiler } from "../src/middleware/transpiler";

const TEST_SRC_DIR = resolve("./tests/transpiler-advanced-src");
const STATIC_BASE = "/_modules";

describe("transpiler middleware (advanced features)", () => {
  beforeAll(async () => {
    await mkdir(TEST_SRC_DIR, { recursive: true });

    // File for define test
    await writeFile(
      join(TEST_SRC_DIR, "env.ts"),
      "export const env = process.env.NODE_ENV; export const version = __VERSION__;",
    );

    // File for globals test
    await writeFile(
      join(TEST_SRC_DIR, "map.ts"),
      "import Leaflet from 'leaflet'; export const init = () => Leaflet.map('id');",
    );
  });

  afterAll(async () => {
    await unlink(join(TEST_SRC_DIR, "env.ts")).catch(() => {});
    await unlink(join(TEST_SRC_DIR, "map.ts")).catch(() => {});
    await rmdir(TEST_SRC_DIR).catch(() => {});
  });

  test("handles 'define' for environment variables and constants", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      define: {
        __VERSION__: '"1.2.3"',
      },
    });

    const req = new Request(`http://localhost${STATIC_BASE}/env.js`);
    const res = await middleware(req as any, {} as any, () => new Response());
    const content = await res.text();

    expect(content).toContain('"test"'); // default NODE_ENV in bun test
    expect(content).toContain('"1.2.3"');
  });

  test("handles 'globals' for CDN-based modules", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      globals: {
        leaflet: "L",
      },
    });

    const req = new Request(`http://localhost${STATIC_BASE}/map.js`);
    const res = await middleware(req as any, {} as any, () => new Response());
    const content = await res.text();

    // Should refer to globalThis.L instead of importing 'leaflet'
    expect(content).toContain("globalThis.L");
    expect(content).not.toContain('from "leaflet"');
    expect(content).not.toContain(`${STATIC_BASE}/vendor/leaflet`);
  });

  test("implements ETag-based cache bursting (304 Not Modified)", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    const req = new Request(`http://localhost${STATIC_BASE}/env.js`);

    // First request
    const res1 = await middleware(req as any, {} as any, () => new Response());
    expect(res1.status).toBe(200);
    const etag = res1.headers.get("ETag");
    expect(etag).toBeDefined();

    // Second request with If-None-Match
    const req2 = new Request(`http://localhost${STATIC_BASE}/env.js`, {
      // biome-ignore lint/style/noNonNullAssertion: <>
      headers: { "If-None-Match": etag! },
    });
    const res2 = await middleware(req2 as any, {} as any, () => new Response());

    expect(res2.status).toBe(304);
  });

  test("supports user-defined plugins", async () => {
    let pluginCalled = false;
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      plugins: [
        {
          name: "test-plugin",
          setup(build: any) {
            build.onStart(() => {
              pluginCalled = true;
            });
          },
        },
      ],
    });

    const req = new Request(`http://localhost${STATIC_BASE}/env.js`);
    await middleware(req as any, {} as any, () => new Response());

    expect(pluginCalled).toBe(true);
  });
});
