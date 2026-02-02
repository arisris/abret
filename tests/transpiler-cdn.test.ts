import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { transpiler } from "../src/middleware/transpiler";

const TEST_SRC_DIR = resolve("./tests/transpiler-cdn-src");
const STATIC_BASE = "/_modules";

describe("transpiler middleware (CDN Fallback)", () => {
  beforeAll(async () => {
    await mkdir(TEST_SRC_DIR, { recursive: true });
    
    await writeFile(
      join(TEST_SRC_DIR, "app.ts"),
      "import { something } from 'non-existent-package'; console.log(something);"
    );
  });

  afterAll(async () => {
    await unlink(join(TEST_SRC_DIR, "app.ts")).catch(() => {});
    await rmdir(TEST_SRC_DIR).catch(() => {});
  });

  test("cdnFallback: false (default) points to local vendor even if missing", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      cdnFallback: false
    });

    const req = new Request(`http://localhost${STATIC_BASE}/app.js`);
    const res = await middleware(req as any, {} as any, () => new Response("Not Found", { status: 404 }));
    const content = await res.text();

    // non-existent-package should also be local (default behavior)
    expect(content).toContain(`${STATIC_BASE}/vendor/non-existent-package`);
  });

  test("cdnFallback: true points to esm.sh for missing packages", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
      cdnFallback: true
    });

    const req = new Request(`http://localhost${STATIC_BASE}/app.js`);
    const res = await middleware(req as any, {} as any, () => new Response("Not Found", { status: 404 }));
    const content = await res.text();
    
    // non-existent-package IS NOT LOCAL (so should switch to esm.sh)
    expect(content).toContain("https://esm.sh/non-existent-package");

    // Also test direct vendor request with cdn fallback (should redirect)
    const req2 = new Request(`http://localhost${STATIC_BASE}/vendor/missing-pkg-123`);
    const res2 = await middleware(req2 as any, {} as any, () => new Response("Not Found", { status: 404 }));
    expect(res2.status).toBe(302);
    expect(res2.headers.get("Location")).toBe("https://esm.sh/missing-pkg-123");
  });
});
