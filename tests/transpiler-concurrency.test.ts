import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { transpiler } from "../src/middleware/transpiler";

const TEST_SRC_DIR = resolve("./tests/transpiler-concurrency-src");
const STATIC_BASE = "/_modules";

describe("transpiler middleware (concurrency and race conditions)", () => {
  beforeAll(async () => {
    await mkdir(TEST_SRC_DIR, { recursive: true });
    await writeFile(
      join(TEST_SRC_DIR, "slow.ts"),
      "export const slow = () => console.log('I am slow');"
    );
  });

  afterAll(async () => {
    await unlink(join(TEST_SRC_DIR, "slow.ts")).catch(() => {});
    await rmdir(TEST_SRC_DIR).catch(() => {});
  });

  test("concurrency locking: multiple concurrent requests only trigger ONE build", async () => {
    let buildCount = 0;
    
    // Custom plugin to spy on the build process
    const spyPlugin = {
      name: "spy-plugin",
      setup(build: any) {
        build.onStart(() => {
          buildCount++;
        });
      }
    };

    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      plugins: [spyPlugin]
    });

    const req = () => new Request(`http://localhost${STATIC_BASE}/slow.js`);
    const next = () => new Response("Not Found", { status: 404 });

    // Fire 10 requests simultaneously
    const results = await Promise.all(
      Array.from({ length: 10 }).map(() => middleware(req() as any, {} as any, next))
    );

    // Verify all requests succeeded
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("slow");
    }

    // CRITICAL: buildCount should be exactly 1 despite 10 requests
    expect(buildCount).toBe(1);
  });

  test("fast-path ETag: skipping build for subsequent requests via headers", async () => {
    let buildCount = 0;
    const spyPlugin = {
      name: "spy-plugin",
      setup(build: any) {
        build.onStart(() => {
          buildCount++;
        });
      }
    };

    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      plugins: [spyPlugin]
    });

    const url = `http://localhost${STATIC_BASE}/slow.js`;
    
    // 1. Initial request to get the ETag
    const res1 = await middleware(new Request(url) as any, {} as any, () => new Response());
    const etag = res1.headers.get("ETag");
    expect(buildCount).toBe(1);

    // 2. Subsequent request with ETag
    const res2 = await middleware(
      // biome-ignore lint/style/noNonNullAssertion: <etag is guaranteed to be set>
      new Request(url, { headers: { "If-None-Match": etag! } }) as any,
      {} as any,
      () => new Response()
    );

    expect(res2.status).toBe(304);
    // CRITICAL: buildCount should STAY at 1 because we hit the fast-path
    expect(buildCount).toBe(1);
  });
});
