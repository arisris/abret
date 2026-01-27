# Middleware & Context

Abret provides a functional middleware system and a request-scoped context API.

## Middleware

Middleware functions intercept requests before they reach the handler. They can modify the request, execute code (logging), or block the request (auth).

### Creating Middleware

Use `createMiddleware` to define a middleware function.

```ts
import { createMiddleware } from "abret";

const logger = createMiddleware((req, server, next) => {
  console.log(`${req.method} ${req.url}`);
  return next();
});
```

### Composing Middleware

You can combine multiple middlewares using `composeMiddlewares`.

```ts
import { composeMiddlewares } from "abret";

const stack = composeMiddlewares(logger, securityHeaders, auth);
```

### Applying to Routes

Pass middleware as the last arguments to `createRoute` or `createRouteGroup`.

```ts
// On a single route
createRoute("/admin", handler, authMiddleware);

// On a group
createRouteGroup("/api", [logger, authMiddleware]);
```

---

## Context API

Abret uses a `WeakMap`-based storage to attach data to the `Request` object safely, without polluting the standard Request properties.

### Typed Keys

First, define a typed Key.

```ts
import { createContextKey } from "abret";

interface User {
  id: string;
  role: "admin" | "user";
}

export const UserContext = createContextKey<User>("user");
```

### Setting Context

Set values inside middleware.

```ts
import { setContext } from "abret";

const auth = createMiddleware((req, server, next) => {
  const user = authenticate(req);
  if (user) {
    setContext(req, UserContext, user);
  }
  return next();
});
```

### Getting Context

Retrieve values inside your route handlers.

```ts
import { requireContext } from "abret";

const profile = createRoute("/me", (req) => {
  // Throws if context is missing
  const user = requireContext(req, UserContext);
  return Response.json(user);
});
```
