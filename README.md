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
- **🧩 Context API**: React-style `createContext` and `useContext` for component trees.
- **⚡ Request Context**: `WeakMap`-based per-request storage for safe data passing.
- **🧠 Smart HTML Generation**: Automatic `<head>` management (titles, meta tags) and DOCTYPE handling.

## 📦 Installation

```bash
bun add abret
```

## 🚀 Quick Start

Create a simple server with routes and HTML rendering:

```tsx
import { createRoute, mergeRoutes, html } from "abret";

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
import { createRouteGroup, mergeRoutes } from "abret";

// Create a group with a prefix and middleware
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

### Middleware

Create reusable middleware for authentication, logging, and more.

```ts
import {
  createMiddleware,
  setContext,
  createContextKey,
  requireContext,
} from "abret";

// Define a type-safe context key
const UserContext = createContextKey<{ name: string }>("user");

const authMiddleware = createMiddleware((req, server, next) => {
  const token = req.headers.get("Authorization");
  if (!token) return new Response("Unauthorized", { status: 401 });

  // Store user in request context
  setContext(req, UserContext, { name: "Alice" });
  return next();
});

// Apply middleware to a route
const dashboard = createRoute(
  "/dashboard",
  (req) => {
    // Safely retrieve context
    const user = requireContext(req, UserContext);
    return new Response(`Welcome ${user.name}`);
  },
  authMiddleware,
);
```

### Components & Context

Build UI with components and share state using Context, just like in React (but on the server).

```tsx
import { createContext, useContext, html } from "abret";

const ThemeContext = createContext("light");

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

### Core

- `createRoute(path, handler, ...middlewares)`
- `mergeRoutes(...routes)`
- `createRouteGroup(prefix, middlewares)`

### Middleware & Context

- `createMiddleware(fn)`
- `composeMiddlewares(...middlewares)`
- `createContextKey(name)`
- `setContext(req, key, value)`
- `getContext(req, key)`
- `requireContext(req, key)`
- `hasContext(req, key)`

### HTML & JSX

- `html(string | jsx)` - Creates an `HTMLResponse`.
- `createContext(defaultValue)` - Creates a context provider/consumer.
- `useContext(context)` - Consumes context value.
- `HTMLResponse` - Extended Response with `.doctype()` and metadata handling.

## 📄 License

MIT
