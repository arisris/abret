# Routing

Abret utilizes a type-safe routing system that sits on top of `Bun.serve`'s native routing.

## Creating Routes

Use `createRoute` to define a single route. It supports:

- Static paths: `/`
- Dynamic parameters: `/users/:id`
- Wildcards: `/catch/*`

```ts
import { createAbret } from "abret";

const { createRoute } = createAbret();

// Simple handler
const home = createRoute("/", () => new Response("Home"));

// Dynamic parameter (inferred as string)
const user = createRoute("/users/:id", (req) => {
  return Response.json({ id: req.params.id });
});
```

## Method Handlers

You can define handlers for specific HTTP methods by passing an object:

```ts
const api = createRoute("/api/resource", {
  GET: () => Response.json({ data: "read" }),
  POST: async (req) => {
    const data = await req.json();
    return Response.json({ created: true });
  },
  DELETE: () => new Response(null, { status: 204 }),
});
```

## Route Groups

`createRouteGroup` allows you to define a prefix and shared middleware for a set of routes.

```ts
import { createAbret } from "abret";

const { createRouteGroup, mergeRoutes } = createAbret();

const v1 = createRouteGroup("/v1", [authMiddleware]);

const routes = mergeRoutes(
  v1("/users", { GET: getAllUsers }),
  v1("/users/:id", { GET: getUserById }),
);
```

## Merging Routes

To pass routes to `Bun.serve`, you must flatten them into a single object using `mergeRoutes`.

```ts
const routes = mergeRoutes(home, user, api);

Bun.serve({ routes });
```
