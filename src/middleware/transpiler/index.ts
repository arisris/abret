import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { BunPlugin } from "bun";
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
  /** Minify local modules. Defaults to false (recommended for dev) */
  minify?: boolean;
  /** Browser cache TTL for local modules in seconds. Defaults to 0 */
  localMaxAge?: number;
  /** Global identifier replacements */
  define?: Record<string, string>;
  /** Map modules to global variables (e.g., { 'react': 'React' }) */
  globals?: Record<string, string>;
  /** Automatically fallback to esm.sh if package is not found locally */
  cdnFallback?: boolean;
  /** Additional Bun plugins */
  plugins?: any[];
}

/**
 * Transpiler middleware that handles on-the-fly TS/TSX transpilation
 * and automatic npm module bundling (vendor modules).
 */
export const transpiler = (options: TranspilerOptions) => {
  const {
    sourcePath,
    staticBasePath,
    vendorPath = "vendor",
    prewarm = [],
    minify = false,
    localMaxAge = 0,
    define = {},
    globals = {},
    cdnFallback = false,
    plugins = [],
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

  // Collect PUBLIC_ environment variables for exposure
  const publicEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("PUBLIC_")) {
      publicEnv[`process.env.${key}`] = JSON.stringify(value);
    }
  }

  const defaultDefine = {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "development"
    ),
    ...publicEnv,
    ...define,
  };

  // Concurrency lock to prevent redundant builds
  const activeBundles = new Map<string, Promise<any>>();

  /**
   * Helper to resolve module path to either local vendor path or CDN
   */
  function resolveModulePath(moduleName: string): string {
    if (globals[moduleName]) return moduleName; // Handled by globals plugin

    try {
      Bun.resolveSync(moduleName, process.cwd());
      // Found locally
      return `${basePrefix}${vendorPath.replace(/^\/|\/$/g, "")}/${moduleName}`;
    } catch {
      // Not found locally
      if (cdnFallback) {
        return `https://esm.sh/${moduleName}`;
      }
      // Fallback to local path anyway (will 404, but consistent)
      return `${basePrefix}${vendorPath.replace(/^\/|\/$/g, "")}/${moduleName}`;
    }
  }

  /**
   * Helper to bundle a vendor module and save to cache
   */
  async function bundleVendorModule(moduleName: string) {
    const cacheKey = moduleName.replace(/\//g, "__");
    const cachedFile = path.join(cacheDir, `${cacheKey}.js`);

    if (existsSync(cachedFile)) return;

    // Concurrency lock
    if (activeBundles.has(cacheKey)) {
      return activeBundles.get(cacheKey);
    }

    const promise = (async () => {
      // Re-check existence inside promise
      if (existsSync(cachedFile)) return;

      try {
        const entryPoint = Bun.resolveSync(moduleName, process.cwd());

        // Prepare globals plugin for vendor too if needed
        const globalsPlugin: BunPlugin = {
          name: "abret-globals",
          setup(build) {
            for (const moduleName of Object.keys(globals)) {
              build.onResolve(
                { filter: new RegExp(`^${moduleName}$`) },
                () => ({
                  path: moduleName,
                  namespace: "abret-globals",
                }),
              );
            }
            build.onLoad(
              { filter: /.*/, namespace: "abret-globals" },
              (args) => {
                const gName = globals[args.path];
                return {
                  contents: `export default globalThis.${gName}; export const ${gName} = globalThis.${gName};`,
                  loader: "js",
                };
              },
            );
          },
        };

        const result = await Bun.build({
          entrypoints: [entryPoint],
          target: "browser",
          format: "esm",
          minify: true,
          define: defaultDefine,
          plugins: [
            globalsPlugin,
            {
              name: "abret-external-vendor",
              setup(build) {
                build.onResolve({ filter: /^[^./]/ }, (args) => {
                  // Don't externalize the entry point or globals
                  if (args.path === moduleName || globals[args.path])
                    return null;
                  return { path: args.path, external: true };
                });
              },
            },
            ...plugins,
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
              return `${prefix}${resolveModulePath(path)}${suffix}`;
            }
            return match;
          }
        );

        await Bun.write(cachedFile, content);
        console.log(`[Abret] Pre-bundled: ${moduleName}`);
      } catch (err) {
        console.error(`[Abret] Error bundling ${moduleName}:`, err);
      } finally {
        activeBundles.delete(cacheKey);
      }
    })();

    activeBundles.set(cacheKey, promise);
    return promise;
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

    // --- 2. HANDLE LOCAL SOURCE FILES (e.g., /app.js -> src/app.ts, /style.css -> src/style.css) ---
    const extname = path.extname(internalPath);
    let sourceFile = "";
    let contentType = "application/javascript";

    if (extname === ".css") {
      const p = path.join(path.resolve(sourcePath), internalPath);
      if (existsSync(p)) {
        sourceFile = p;
        contentType = "text/css";
      }
    } else {
      const baseFileName = internalPath.endsWith(".js")
        ? internalPath.slice(0, -3)
        : internalPath;

      const possibleExtensions = [".tsx", ".ts", ".jsx", ".js"];
      for (const ext of possibleExtensions) {
        const p = path.join(
          path.resolve(sourcePath),
          (baseFileName.startsWith("/")
            ? baseFileName.slice(1)
            : baseFileName) + ext,
        );
        if (existsSync(p)) {
          sourceFile = p;
          break;
        }
      }
    }

    if (sourceFile) {
      const sourceStat = statSync(sourceFile);
      const fastEtag = `W/"${sourceStat.size}-${sourceStat.mtimeMs}-${minify}"`;

      // Fast-path: Skip build if ETag matches
      if (req.headers.get("if-none-match") === fastEtag) {
        return new Response(null, { status: 304 });
      }

      // Concurrency lock for local file
      const lockKey = `local:${sourceFile}:${fastEtag}`;
      if (activeBundles.has(lockKey)) {
        const result = await activeBundles.get(lockKey);
        return new Response(result.content, {
          headers: {
            "Content-Type": result.contentType,
            ETag: fastEtag,
            "Cache-Control":
              localMaxAge > 0 ? `public, max-age=${localMaxAge}` : "no-cache",
          },
        });
      }

      const buildPromise = (async () => {
        try {
          const buildResult = await Bun.build({
            entrypoints: [sourceFile],
            target: "browser",
            format: "esm",
            minify,
            define: defaultDefine,
            external: ["*"], // Don't bundle local imports
            plugins: [
              // Handle globals in local files
              {
                name: "abret-globals-local",
                setup(build: any) {
                  for (const moduleName of Object.keys(globals)) {
                    build.onResolve(
                      { filter: new RegExp(`^${moduleName}$`) },
                      () => ({
                        path: moduleName,
                        namespace: "abret-globals",
                      })
                    );
                  }
                  build.onLoad(
                    { filter: /.*/, namespace: "abret-globals" },
                    (args: any) => {
                      const gName = globals[args.path];
                      return {
                        contents: `export default globalThis.${gName};`,
                        loader: "js",
                      };
                    }
                  );
                },
              },
              ...plugins,
            ],
          });

          if (!buildResult.success || buildResult.outputs.length === 0) {
            throw new Error(
              `Build failed: ${buildResult.logs.map((l) => l.message).join(", ")}`
            );
          }

          const output = buildResult.outputs[0];
          if (!output) throw new Error("No output generated");

          const transpiledCode = await output.text();

          if (contentType === "text/css") {
            return { content: transpiledCode, contentType };
          }

          // --- IMPORT REWRITING LOGIC (JS only) ---
          const finalCode = transpiledCode.replace(
            /((?:import|export)\s*[\s\S]*?from\s*['"]|import\s*\(['"])([^'"]+)(['"]\)?)/g,
            (match, prefix, path, suffix) => {
              if (/^(https?:|(?:\/\/))/.test(path)) return match;
              if (!path.startsWith(".") && !path.startsWith("/")) {
                return `${prefix}${resolveModulePath(path)}${suffix}`;
              }
              if (
                path.startsWith(".") &&
                !path.split("/").pop()?.includes(".")
              ) {
                return `${prefix}${path}.js${suffix}`;
              }
              return match;
            }
          );

          return { content: finalCode, contentType };
        } finally {
          activeBundles.delete(lockKey);
        }
      })();

    activeBundles.set(lockKey, buildPromise);
    try {
      const finalResult = await buildPromise;

      return new Response(finalResult.content, {
        headers: {
          "Content-Type": finalResult.contentType,
          ETag: fastEtag,
          "Cache-Control":
            localMaxAge > 0 ? `public, max-age=${localMaxAge}` : "no-cache",
        },
      });
    } catch (err: any) {
      const errorMessage = err.message || "Unknown transpilation error";
      console.error(`[Abret] ${errorMessage} for ${sourceFile}`);

      // Return browser-friendly error overlay/logger
      return new Response(
        `console.error("[Abret] Build Error in ${sourceFile}:", ${JSON.stringify(errorMessage)});
        if (typeof document !== 'undefined') {
          const div = document.createElement('div');
          div.style.position = 'fixed';
          div.style.top = '0';
          div.style.left = '0';
          div.style.width = '100%';
          div.style.padding = '1rem';
          div.style.background = '#fee2e2';
          div.style.color = '#991b1b';
          div.style.borderBottom = '1px solid #ef4444';
          div.style.zIndex = '999999';
          div.style.fontFamily = 'monospace';
          div.innerText = "[Abret] Build Error in ${sourceFile.split("/").pop()}: " + ${JSON.stringify(errorMessage)};
          document.body.appendChild(div);
        }`,
        { headers: { "Content-Type": "application/javascript" } }
      );
    }
  }

    return next();
  });
};
