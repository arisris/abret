/** @jsxImportSource abret */
import {
  composeMiddlewares,
  createMiddleware,
  createRoute,
  createRouteGroup,
  mergeRoutes,
} from "abret";
import { html } from "abret/html";
import { createContext, setContext, useContext } from "abret/store";

// Abret uses exact path matching. You can manually handle trailing slashes using catch-all routes.

import { transpiler } from "../src/middleware/transpiler";

// ============================================================================
// 1. Setup Context & Middleware
// ============================================================================

// Type-safe context key for user data
const CurrentUserContext = createContext<{ name: string; role: string }>(
  "currentUser",
);

// Middleware: Logger
const logger = createMiddleware((req, _server, next) => {
  const start = performance.now();
  console.log(`[${req.method}] ${req.url}`);
  const res = next();

  // Handle async response to log duration
  if (res instanceof Promise) {
    return res.then((r) => {
      const duration = (performance.now() - start).toFixed(2);
      console.log(`  -> ${r.status} (${duration}ms)`);
      return r;
    });
  }

  const duration = (performance.now() - start).toFixed(2);
  console.log(`  -> ${res.status} (${duration}ms)`);
  return res;
});

// Middleware: Fake Auth (adds user to context)
const auth = createMiddleware((req, _server, next) => {
  const url = new URL(req.url);
  // Simulating auth via query param ?user=name for demo
  const userParam = url.searchParams.get("user") || "Guest";

  // Set context (no req needed)
  setContext(CurrentUserContext, {
    name: userParam,
    role: userParam === "Admin" ? "admin" : "user",
  });

  return next();
});

// ============================================================================
// 2. Components
// ============================================================================

const ThemeContext = createContext("Theme", "light");

function Layout(props: { title: string; children: any; scripts?: boolean }) {
  // We can use context here if we wrapped it in a provider
  const theme = useContext(ThemeContext);

  // We can also access UserContext directly in components now!
  const user = useContext(CurrentUserContext);

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title} - Abret Example</title>
        <style>
          {`
            body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
            nav { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #eee; }
            a { margin-right: 1rem; color: #0070f3; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .card { border: 1px solid #ddd; padding: 1rem; border-radius: 8px; background: #f9f9f9; }
            .badge { background: #333; color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; }
            .theme-dark { background: #333; color: white; }
          `}
        </style>
      </head>
      <body class={theme === "dark" ? "theme-dark" : ""}>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/interactive">Interactive</a>
          <a href="/api/me">API (Me)</a>
          <a href="/?user=Admin">Login as Admin</a>
          {user ? (
            <span>
              Logged in as: <strong>{user.name}</strong>
            </span>
          ) : null}
        </nav>
        <main>{props.children}</main>
        <footer>
          <p style="margin-top: 3rem; color: #666; font-size: 0.9rem;">
            Powered by Abret & Bun
          </p>
        </footer>
        {props.scripts && (
          <script type="module" src="/_modules/main.js"></script>
        )}
      </body>
    </html>
  );
}

function UserBadge() {
  // Access data implicitly from storage!
  const user = useContext(CurrentUserContext);

  if (!user) return null;

  return <span>(Component Level: {user.name})</span>;
}

// ============================================================================
// 3. Routes
// ============================================================================

// Global middleware
const appMiddleware = composeMiddlewares(logger, auth);

// -- Home Route --
const home = createRoute(
  "/",
  () => {
    // Get context (no req needed)
    const user = useContext(CurrentUserContext, { required: true });

    return html(
      <Layout title="Home">
        <h1>Hello, {user.name}!</h1>
        <p>
          Welcome to the <strong>Abret</strong> example.
        </p>

        <div class="card">
          <h3>User Status</h3>
          <p>
            Role: <span class="badge">{user.role}</span>
          </p>
          <p>
            <UserBadge />
          </p>
        </div>

        <div style="margin-top: 2rem">
          <ThemeContext.Provider value="light">
            <p>This section uses Context API for theming.</p>
          </ThemeContext.Provider>
        </div>
      </Layout>,
    ).doctype(); // Adds <!DOCTYPE html>
  },
  appMiddleware,
);

// -- Interactive Route (demonstrates transpiler) --
const interactive = createRoute(
  "/interactive",
  () => {
    return html(
      <Layout title="Interactive" scripts>
        <h1>Interactive Page</h1>
        <p>
          This page loads a client-side Preact component via the Abret
          Transpiler.
        </p>
        <div id="root">
          <p>Loading interactive counter...</p>
        </div>
      </Layout>,
    ).doctype();
  },
  appMiddleware,
);

// -- About Route --
const about = createRoute(
  "/about",
  () => {
    return html`
      <${Layout} title="About">
        <h1>About Abret</h1>
        <p>
          Abret is designed to be a thin but powerful layer over Bun.serve. It
          brings Type-Safe routing and JSX/TSX support without the bloat.
        </p>
        <ul>
          <li>Routes: Native Bun Routes</li>
          <li>JSX: Custom runtime, no React needed</li>
          <li>Middleware: Functional & Composable</li>
          <li><b>Transpiler</b>: On-the-fly TS/TSX & Vendor bundling</li>
        </ul>
      <//>
    `.doctype();
  },
  appMiddleware,
);

// -- API Group --
const api = createRouteGroup("/api", [appMiddleware]);

const apiRoutes = mergeRoutes(
  api("/me", () => {
    const user = useContext(CurrentUserContext, { required: true });
    return Response.json(user);
  }),

  api("/echo/:word", (req) => {
    return Response.json({
      word: req.params.word,
      length: req.params.word?.length,
    });
  }),
);

// ============================================================================
// 4. Server Init
// ============================================================================

const routes = mergeRoutes(
  home,
  about,
  interactive,
  apiRoutes,
  // 5. Add Transpiler Middleware for /_modules/*
  createRoute(
    "/_modules/*",
    () => new Response("Not Found", { status: 404 }),
    transpiler({
      sourcePath: "./src",
      staticBasePath: "/_modules",
      prewarm: ["preact", "@preact/signals"],
    }),
  ),
  createRoute("/*", (req) => {
    // handle trailing slash
    if (req.url.endsWith("/")) {
      return Response.redirect(new URL(req.url.slice(0, -1), req.url));
    }
    return new Response("Not Found", { status: 404 });
  }),
);

const server = Bun.serve({
  port: 4000,
  routes,
  development: true,
});

console.log(`🚀 Server running at ${server.url}`);
