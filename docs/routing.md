# Routing

Abret utilizes a type-safe routing system that sits on top of `Bun.serve`'s native routing.

## Creating Routes

Use `createRoute` to define a single route. It supports:

- Static paths: `/`
- Dynamic parameters: `/users/:id`
- Wildcards: `/catch/*`

```ts
import { createRoute } from "abret";

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
import { createRouteGroup, mergeRoutes } from "abret";

const v1 = createRouteGroup("/v1", [authMiddleware]);

const routes = mergeRoutes(
  v1("/users", { GET: getAllUsers }),
  v1("/users/:id", { GET: getUserById }),
);
```

## Serving your Application

To pass routes to `Bun.serve`, you must flatten them into a single object using `mergeRoutes`.

```ts
const routes = mergeRoutes(home, user, api);

Bun.serve({
  port: 3000,
  routes,
  development: process.env.NODE_ENV !== "production",
});
```

Abret-generated routes are compatible with all `Bun.serve` options.

## Trailing Slashes

Abret uses exact path matching as provided in the `path` argument. No automatic trailing slash normalization or redirection is performed. If you want to support both `/path` and `/path/`, you should define them explicitly.

### Manual Trailing Slash Redirection

You can implement a global trailing slash redirection strategy by using a catch-all route at the end of your route list. This is useful for SEO consistency.

```ts
import { createRoute, mergeRoutes } from "abret";

const home = createRoute("/", () => new Response("Home"));
const about = createRoute("/about", () => new Response("About"));

const routes = mergeRoutes(
  home,
  about,
  // Catch-all route to handle trailing slash redirection
  createRoute("/*", (req) => {
    if (req.url.endsWith("/")) {
      const url = new URL(req.url.slice(0, -1), req.url);
      return Response.redirect(url);
    }
    return new Response("Not Found", { status: 404 });
  }),
);

Bun.serve({ routes });
```

This pattern ensures that any request ending with a `/` that didn't match an existing route will be redirected to its non-slash counterpart.
