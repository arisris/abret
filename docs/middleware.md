# Middleware & Context

Abret provides a middleware system and a unified context API for managing request-scoped data.

## Middleware

Use `createMiddleware` to define logic that runs before your route handlers.

```ts
import { createMiddleware } from "abret";

const logger = createMiddleware((req, server, next) => {
  console.log(`${req.method} ${req.url}`);
  return next();
});
```

## Context API (`abret/store`)

Abret uses `AsyncLocalStorage` to provide a unified context for both request-scoped data and component tree data.

### Creating Context

First, define a typed Context.

```ts
import { createContext } from "abret/store";

interface User {
  id: string;
  role: "admin" | "user";
}

export const UserContext = createContext<User>("user");
```

### Setting Context

Set values inside middleware. No need to pass the `req` object.

```ts
import { createMiddleware, setContext } from "abret";
import { UserContext } from "./context";

const auth = createMiddleware((req, server, next) => {
  const user = authenticate(req);
  if (user) {
    setContext(UserContext, user);
  }
  return next();
});
```

### Getting Context

Retrieve values inside your route handlers.

```ts
import { createRoute, useContext } from "abret";
import { UserContext } from "./context";

const profile = createRoute("/me", () => {
  // Throws if context is missing
  const user = useContext(UserContext, { required: true });
  return Response.json(user);
});
```
