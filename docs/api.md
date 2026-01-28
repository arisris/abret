# API Reference

## Core Factory

### `createAbret(config)`

Initializes the Abret library and returns the core functions.

```ts
const {
  createRoute,
  createRouteGroup,
  mergeRoutes,
  createMiddleware,
  composeMiddlewares,
} = createAbret({ trailingSlash: "both" });
```

- **config.trailingSlash**: `"both" | "strip" | "none"` (default: `"both"`).

## Routing

### `createRoute(path, handler, ...middleware)`

Creates a route definition.

- **path**: URL path pattern (e.g., `/users/:id`).
- **handler**: Function `(req, server) => Response` or object `{ GET: handler, ... }`.
- **middleware**: Optional list of middleware functions.

### `createRouteGroup(prefix, middleware)`

Creates a factory for prefixed routes.

- **prefix**: Path prefix (e.g., `/api`).
- **middleware**: Array of middleware to apply to all routes in group.

### `mergeRoutes(...routes)`

Combines route objects into a single object for `Bun.serve`.

---

## Middleware

### `createMiddleware(fn)`

Helper to type a middleware function.

- **fn**: `(req, server, next) => Response | Promise<Response>`

### `composeMiddlewares(...middlewares)`

Combines multiple middlewares into a single one.

---

## Context API (`abret/store`)

### `createContext<T>(name, defaultValue?)`

Creates a context key. If a `defaultValue` is provided, it returns a `ContextWithProvider` which includes a `.Provider` component.

### `setContext(key, value)`

Stores a value in the current context scope.

### `useContext(key, options?)`

Retrieves a value.

- **options.required**: If `true`, throws error if context is missing.

### `hasContext(key)`

Returns `true` if context is set.

---

## HTML & JSX (`abret/html`)

### `html(content, init?)`

Creates an `HTMLResponse`.

- **content**: JSX Element or Template String.
- **init**: `ResponseInit` object (status, headers).

### `html` methods

- `.doctype(raw?)`: Prepend `<!DOCTYPE html>`.
- `.init(options)`: Update response options.

### `HTMLResponse`

Extended Response class with metadata management features.
