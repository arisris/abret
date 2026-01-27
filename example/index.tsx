import {
  createRoute,
  mergeRoutes,
  createRouteGroup,
  html,
  createMiddleware,
  composeMiddlewares,
  createContext,
  useContext,
  createContextKey,
  setContext,
  requireContext,
  type Middleware,
} from "abret";

// ============================================================================
// 1. Setup Context & Middleware
// ============================================================================

// Type-safe context key for user data
const CurrentUserContext = createContextKey<{ name: string; role: string }>(
  "currentUser",
);

// Middleware: Logger
const logger: Middleware = (req, server, next) => {
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
};

// Middleware: Fake Auth (adds user to context)
const auth: Middleware = (req, server, next) => {
  const url = new URL(req.url);
  // Simulating auth via query param ?user=name for demo
  const userParam = url.searchParams.get("user") || "Guest";

  setContext(req, CurrentUserContext, {
    name: userParam,
    role: userParam === "Admin" ? "admin" : "user",
  });

  return next();
};

// ============================================================================
// 2. Components
// ============================================================================

const ThemeContext = createContext("light");

function Layout(props: { title: string; children: any }) {
  // We can use context here if we wrapped it in a provider
  const theme = useContext(ThemeContext);

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
          <a href="/api/me">API (Me)</a>
          <a href="/?user=Admin">Login as Admin</a>
        </nav>
        <main>{props.children}</main>
        <footer>
          <p style="margin-top: 3rem; color: #666; font-size: 0.9rem;">
            Powered by Abret & Bun
          </p>
        </footer>
      </body>
    </html>
  );
}

function UserBadge() {
  // Access request context implicitly via closure?
  // No, request context is request-scoped. Components render during request.
  // But components in 'abret' don't have direct access to 'req' object unless passed.
  // However, we can pass data down or use component-level context.

  // For 'req' specific data, we usually pass it as props in this architecture,
  // OR we could use AsyncLocalStorage for request context if we wanted global access,
  // but 'abret' uses WeakMap on 'req' object.
  // So we must pass user as prop to components or use Component Context if we had a Provider.

  return <span>(Component Level)</span>;
}

// ============================================================================
// 3. Routes
// ============================================================================

// Global middleware
const appMiddleware = composeMiddlewares(logger, auth);

// -- Home Route --
const home = createRoute(
  "/",
  (req) => {
    const user = requireContext(req, CurrentUserContext);

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
        </ul>
      <//>
    `.doctype();
  },
  appMiddleware,
);

// -- API Group --
const api = createRouteGroup("/api", [appMiddleware]);

const apiRoutes = mergeRoutes(
  api("/me", (req) => {
    const user = requireContext(req, CurrentUserContext);
    return Response.json(user);
  }),

  api("/echo/:word", (req) => {
    return Response.json({
      word: req.params.word,
      length: req.params.word.length,
    });
  }),
);

// ============================================================================
// 4. Server Init
// ============================================================================

const routes = mergeRoutes(home, about, apiRoutes);

console.log(`🚀 Server running at http://localhost:3000`);

Bun.serve({
  port: 3000,
  routes,
  development: true,
});
