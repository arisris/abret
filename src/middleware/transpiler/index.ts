import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createMiddleware } from "../..";

interface TranspilerOptions {
  /** Directory where source files (.ts, .tsx) are located */
  sourcePath: string;
  /** URL prefix to intercept (e.g., "/_modules") */
  staticBasePath: string;
  /** Optional sub-path for vendor modules. Defaults to 'vendor' */
  vendorPath?: string;
  /** Optional list of modules to bundle on startup */
  prewarm?: string[];
}

/**
 * Transpiler middleware that handles on-the-fly TS/TSX transpilation
 * and automatic npm module bundling (vendor modules).
 *
 * Usage:
 * ```ts
 * transpiler({ sourcePath: "./src", staticBasePath: "/_modules" })
 * ```
 */
export const transpiler = (options: TranspilerOptions) => {
  const {
    sourcePath,
    staticBasePath,
    vendorPath = "vendor",
    prewarm = [],
  } = options;
  const cacheDir = path.resolve(process.cwd(), "node_modules", ".transpiler");

  // Normalize base paths to ensure safe matching
  const basePrefix = staticBasePath.endsWith("/")
    ? staticBasePath
    : `${staticBasePath}/`;
  const vendorPrefix = `${basePrefix}${vendorPath.replace(/^\/|\/$/g, "")}/`;

  // Ensure cache directory exists
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  /**
   * Helper to bundle a vendor module and save to cache
   */
  async function bundleVendorModule(moduleName: string) {
    const cacheKey = moduleName.replace(/\//g, "__");
    const cachedFile = path.join(cacheDir, `${cacheKey}.js`);

    // Skip if already cached
    if (existsSync(cachedFile)) return;

    try {
      const entryPoint = Bun.resolveSync(moduleName, process.cwd());
      const result = await Bun.build({
        entrypoints: [entryPoint],
        target: "browser",
        format: "esm",
        minify: true,
        plugins: [
          {
            name: "abret-external-vendor",
            setup(build) {
              build.onResolve({ filter: /^[^./]/ }, (args) => {
                if (args.path === moduleName) return null;
                return { path: args.path, external: true };
              });
            },
          },
        ],
      });

      if (!result.success || result.outputs.length === 0) {
        console.error(
          `[Abret] Failed to bundle vendor module: ${moduleName}`,
          result.logs,
        );
        return;
      }

      const output = result.outputs[0];
      if (!output) return;

      const rawContent = await output.text();

      // Rewrite imports inside the vendor bundle
      const content = rawContent.replace(
        /((?:import|export)\s*[\s\S]*?from\s*['"]|import\s*\(['"])([^'"]+)(['"]\)?)/g,
        (match, prefix, path, suffix) => {
          if (/^(https?:|(?:\/\/))/.test(path)) return match;
          if (!path.startsWith(".") && !path.startsWith("/")) {
            return `${prefix}${basePrefix}${vendorPath.replace(
              /^\/|\/$/g,
              "",
            )}/${path}${suffix}`;
          }
          return match;
        },
      );

      await Bun.write(cachedFile, content);
      console.log(`[Abret] Pre-bundled: ${moduleName}`);
    } catch (err) {
      console.error(`[Abret] Error bundling ${moduleName}:`, err);
    }
  }

  // Pre-warm cache on startup
  if (prewarm.length > 0) {
    for (const moduleName of prewarm) {
      bundleVendorModule(moduleName); // Run in background
    }
  }

  return createMiddleware(async (req, _server, next) => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Strict path matching to avoid matching "/_modules-extra"
    if (!pathname.startsWith(basePrefix) && pathname !== staticBasePath) {
      return next();
    }

    // --- 1. HANDLE VENDOR MODULES (e.g., /_modules/vendor/preact) ---
    if (pathname.startsWith(vendorPrefix)) {
      const moduleName = pathname.slice(vendorPrefix.length);
      const cacheKey = moduleName.replace(/\//g, "__");
      const cachedFile = path.join(cacheDir, `${cacheKey}.js`);

      // Serve from cache if exists
      if (existsSync(cachedFile)) {
        return new Response(Bun.file(cachedFile), {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      // If not in cache, bundle on-demand
      await bundleVendorModule(moduleName);

      if (existsSync(cachedFile)) {
        return new Response(Bun.file(cachedFile), {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      return next();
    }

    // For local files, we need the path relative to staticBasePath
    const internalPath = pathname.slice(basePrefix.length);

    // --- 2. HANDLE LOCAL SOURCE FILES (e.g., /_modules/app.js -> src/app.ts) ---
    const baseFileName = internalPath.endsWith(".js")
      ? internalPath.slice(0, -3)
      : internalPath;

    const possibleExtensions = [".tsx", ".ts", ".jsx", ".js"];
    let sourceFile = "";

    for (const ext of possibleExtensions) {
      const p = path.join(
        path.resolve(sourcePath),
        (baseFileName.startsWith("/") ? baseFileName.slice(1) : baseFileName) +
          ext,
      );
      if (existsSync(p)) {
        sourceFile = p;
        break;
      }
    }

    if (sourceFile) {
      try {
        const buildResult = await Bun.build({
          entrypoints: [sourceFile],
          target: "browser",
          format: "esm",
          external: ["*"], // Don't bundle local imports
        });

        if (!buildResult.success || buildResult.outputs.length === 0) {
          console.error(
            `[Abret] Build error for ${sourceFile}:`,
            buildResult.logs,
          );
          return next();
        }

        const output = buildResult.outputs[0];
        if (!output) {
          console.error(`[Abret] No output files generated for ${sourceFile}`);
          return next();
        }

        const transpiledCode = await output.text();

        // --- IMPORT REWRITING LOGIC ---
        // 1. Rewrite bare specifiers: "preact" -> "/_modules/vendor/preact"
        // 2. Add extensions to relative imports: "./utils" -> "./utils.js"
        const finalCode = transpiledCode.replace(
          /((?:import|export)\s*[\s\S]*?from\s*['"]|import\s*\(['"])([^'"]+)(['"]\)?)/g,
          (match, prefix, path, suffix) => {
            // Skip absolute URLs (http, https, //)
            if (/^(https?:|(?:\/\/))/.test(path)) return match;

            // Handle bare specifiers (npm packages)
            if (!path.startsWith(".") && !path.startsWith("/")) {
              return `${prefix}${basePrefix}${vendorPath.replace(
                /^\/|\/$/g,
                "",
              )}/${path}${suffix}`;
            }

            // Handle relative imports without extensions
            if (path.startsWith(".") && !path.split("/").pop()?.includes(".")) {
              return `${prefix}${path}.js${suffix}`;
            }

            return match;
          },
        );

        return new Response(finalCode, {
          headers: { "Content-Type": "application/javascript" },
        });
      } catch (err) {
        console.error(`[Abret] Transpilation error for ${sourceFile}:`, err);
        return next();
      }
    }

    return next();
  });
};
