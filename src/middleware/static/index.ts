import path from "node:path";
import type { Middleware } from "../..";

export type ServeStaticOptions = {
  /**
   * Root directory to serve files from.
   * @default "./"
   */
  root?: string;
  /**
   * Path to specific file to serve.
   * If set, this file will be served for all requests.
   */
  path?: string;
  /**
   * Rewrite the request path before file resolution.
   */
  rewriteRequestPath?: (path: string) => string;
  /**
   * Custom mapping of mime types.
   * Extension (without dot) -> Mime Type
   */
  mimes?: Record<string, string>;
};

/**
 * Middleware to serve static files using Bun.file
 * behaves like hono serveStatic
 */
export const serveStatic = (options: ServeStaticOptions = {}): Middleware => {
  return async (req, _server, next) => {
    // Only serve GET and HEAD requests
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    const url = new URL(req.url);
    let filename = options.path ?? url.pathname;

    if (options.rewriteRequestPath) {
      filename = options.rewriteRequestPath(filename);
    }

    // Default root to current working directory
    const root = options.root ?? "./";

    // Strip leading slash to ensure clean join with root
    const validFilename = filename.startsWith("/")
      ? filename.slice(1)
      : filename;

    // Resolve absolute path
    const filePath = path.resolve(root, validFilename);

    // Security check: ensure the resolved path is inside the root [Optional but recommended]
    // However, Bun.file might handle some of this, but generic traversal protection is good.
    // For now, matching Hono's simple behavior which mostly trusts the input or Bun's handling.
    // Hono doesn't enforce strict jail in basic serveStatic unless configured.
    // But let's just use the path.

    // Note: path.resolve(root, validFilename) handles ../ too.
    // If root is ./public and validFilename is ../secret, filePath becomes ./secret.
    // We should probably check if it starts with resolved root.
    const resolvedRoot = path.resolve(root);
    if (!filePath.startsWith(resolvedRoot)) {
      return next();
    }

    const file = Bun.file(filePath);

    if (await file.exists()) {
      const response = new Response(file);

      // Handle custom mimes
      if (options.mimes) {
        const ext = path.extname(filePath).slice(1);
        if (options.mimes[ext]) {
          response.headers.set("Content-Type", options.mimes[ext]);
        }
      }

      return response;
    }

    return next();
  };
};
