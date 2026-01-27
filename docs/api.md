# API Reference

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

## Request Context

### `createContextKey<T>(name)`

Creates a unique symbol key for context storage.

### `setContext(req, key, value)`

Stores a value in the request context.

### `getContext(req, key)`

Retrieves a value (returns `T | undefined`).

### `requireContext(req, key)`

Retrieves a value or throws if missing.

---

## HTML & JSX

### `html(content, init?)`

Creates an `HTMLResponse`.

- **content**: JSX Element or Template String.
- **init**: `ResponseInit` object (status, headers).

### `html` methods

- `.doctype(raw?)`: Prepend `<!DOCTYPE html>`.
- `.init(options)`: Update response options.

### `createContext(defaultValue)`

Creates a Component Context (Provider/Consumer).

### `useContext(context)`

Hook to consume Component Context value.
