import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { transpiler } from "../src/middleware/transpiler";

const TEST_SRC_DIR = resolve("./tests/transpiler-dx-src");
const STATIC_BASE = "/_modules";

describe("transpiler middleware (DX features)", () => {
  beforeAll(async () => {
    await mkdir(TEST_SRC_DIR, { recursive: true });
    
    await writeFile(
      join(TEST_SRC_DIR, "public-env.ts"),
      "export const apiUrl = process.env.PUBLIC_API_URL;"
    );

    await writeFile(
      join(TEST_SRC_DIR, "error.ts"),
      "const a: number = 'string'; // This should fail if we had strict type checking in Bun.build, but actually Bun.build doesn't type check. We need a real syntax error."
    );

    await writeFile(
      join(TEST_SRC_DIR, "syntax-error.ts"),
      "const a =" // Syntax error
    );
  });

  afterAll(async () => {
    await unlink(join(TEST_SRC_DIR, "public-env.ts")).catch(() => {});
    await unlink(join(TEST_SRC_DIR, "error.ts")).catch(() => {});
    await unlink(join(TEST_SRC_DIR, "syntax-error.ts")).catch(() => {});
    await rmdir(TEST_SRC_DIR).catch(() => {});
  });

  test("automatically exposes PUBLIC_ environment variables", async () => {
    process.env.PUBLIC_API_URL = "https://api.abret.dev";
    
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    const req = new Request(`http://localhost${STATIC_BASE}/public-env.js`);
    const res = await middleware(req as any, {} as any, () => new Response());
    const content = await res.text();

    expect(content).toContain("https://api.abret.dev");
  });

  test("returns browser-safe error reporting on syntax error", async () => {
    const middleware = transpiler({
      sourcePath: TEST_SRC_DIR,
      staticBasePath: STATIC_BASE,
    });

    const req = new Request(`http://localhost${STATIC_BASE}/syntax-error.js`);
    const res = await middleware(req as any, {} as any, () => new Response());
    const content = await res.text();

    expect(res.status).toBe(200); // Should be 200 to be executable by the browser
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
    expect(content).toContain("console.error");
    expect(content).toContain("document.createElement('div')");
    expect(content).toContain("failed");
  });
});
