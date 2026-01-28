# Abret

[![npm version](https://img.shields.io/npm/v/abret?style=flat-square)](https://www.npmjs.com/package/abret)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![License](https://img.shields.io/npm/l/abret?style=flat-square)](LICENSE)

**Abret** is a modern, lightweight, and type-safe web framework built specifically for [Bun](https://bun.sh). It extends `Bun.serve` with a powerful routing system, composable middleware, and a built-in JSX rendering engine, all while maintaining minimal overhead.

## ✨ Features

- **🚀 Native Bun Integration**: Built directly on top of `Bun.serve` for maximum performance.
- **🛡️ Type-Safe Routing**: Strict TypeScript inference for route parameters and handlers.
- **🔗 Composable Middleware**: Robust middleware system with `createMiddleware` and `composeMiddlewares`.
- **⚛️ JSX/TSX Support**: Server-side rendering with familiar JSX syntax (no Virtual DOM).
- **🧩 Unified Context**: Component and Request context unified into a single API using `AsyncLocalStorage`.
- **🧠 Smart HTML Generation**: Automatic `<head>` management (titles, meta tags) and DOCTYPE handling.

## ⚡ Benchmarks

Abret's JSX engine is optimized for high-performance server-side rendering, avoiding the overhead of Virtual DOM.

- **Simple Render**: ~800,000 ops/sec
- **Complex Component Tree**: ~82,000 ops/sec
- **VNode Creation**: ~2,200,000 ops/sec

_Preliminary results on typical hardware. Significantly faster than standard React/Preact `renderToString`._

## 📦 Installation

```bash
bun add abret
```

## 🚀 Quick Start

Create a simple server with routes and HTML rendering:

```tsx
import { createAbret } from "abret";
import { html } from "abret/html";

// Initialize Abret
const { createRoute, mergeRoutes } = createAbret();

const home = createRoute("/", () => {
  return html`
    <!DOCTYPE html>
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <h1>Welcome to Abret!</h1>
      </body>
    </html>
  `;
});

const api = createRoute("/api/hello", () =>
  Response.json({ message: "Hello World" }),
);

Bun.serve({
  routes: mergeRoutes(home, api),
});
```

## 📖 Key Concepts

### Routing & Groups

Organize your routes using `createRoute` and `createRouteGroup`. Types for parameters are automatically inferred.

```ts
import { createAbret } from "abret";

const { createRouteGroup, mergeRoutes } = createAbret();

// Create a group with a prefix
const api = createRouteGroup("/api/v1");

const routes = mergeRoutes(
  api("/users", { GET: () => Response.json([]) }),
  api("/users/:id", (req) => {
    // strict type safety: req.params.id is string
    return Response.json({ id: req.params.id });
  }),
);

Bun.serve({ routes });
```

### Middleware & Context

Create reusable middleware and share state across the request lifecycle using the unified Context API. Context is implicit and doesn't require passing `req` objects.

```ts
import { createAbret } from "abret";
import { createContext, setContext, useContext } from "abret/store";

const { createRoute, createMiddleware } = createAbret();

// Define a type-safe context key
const UserContext = createContext<{ name: string }>("user");

const authMiddleware = createMiddleware((req, server, next) => {
  const token = req.headers.get("Authorization");
  if (!token) return new Response("Unauthorized", { status: 401 });

  // Store user in context (implicit scope)
  setContext(UserContext, { name: "Alice" });
  return next();
});

// Apply middleware to a route
const dashboard = createRoute(
  "/dashboard",
  () => {
    // Safely retrieve context (no req needed)
    const user = useContext(UserContext, { required: true });
    return new Response(`Welcome ${user.name}`);
  },
  authMiddleware,
);
```

### Components & JSX

Build UI with components and share state using Context, just like in React (but on the server).

```tsx
import { createAbret } from "abret";
import { html } from "abret/html";
import { createContext, useContext } from "abret/store";

const { createRoute } = createAbret();

const ThemeContext = createContext("light"); // Default value

function ThemeButton() {
  const theme = useContext(ThemeContext);
  return <button class={`btn-${theme}`}>Click me</button>;
}

const page = createRoute("/component", () => {
  return html(
    <ThemeContext.Provider value="dark">
      <ThemeButton />
    </ThemeContext.Provider>,
  );
});
```

## 🛠️ API Reference

### Core (`abret`)

```ts
import { createAbret } from "abret";
const config = { trailingSlash: "both" }; // "both" | "strip" | "none"
const {
  createRoute,
  createRouteGroup,
  mergeRoutes,
  createMiddleware,
  composeMiddlewares,
} = createAbret(config);
```

- `createRoute(path, handler, ...middlewares)`
- `mergeRoutes(...routes)`
- `createRouteGroup(prefix, middlewares)`
- `createMiddleware(fn)`
- `composeMiddlewares(...middlewares)`

### Context Store (`abret/store`)

```ts
import {
  createContext,
  useContext,
  setContext,
  hasContext,
  clearContext,
} from "abret/store";
```

- `createContext<T>(name, defaultValue?)` - Creates a context key (and Provider if default given).
- `setContext(key, value)` - Sets value in current scope.
- `useContext(key, options?)` - Gets value (or default).
- `hasContext(key)` - Checks if set.
- `clearContext(key)` - Clears value.

### HTML & JSX (`abret/html`)

```ts
import { html, HTMLResponse } from "abret/html";
```

- `html(string | jsx)` - Creates an `HTMLResponse`.
- `HTMLResponse` - Extended Response with `.doctype()` and metadata handling.

## 📄 License

MIT
