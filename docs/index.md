# Introduction

**Abret** is a lightweight, type-safe web framework built specifically for [Bun](https://bun.sh). It leverages standard web APIs (`Request`, `Response`) and extends `Bun.serve` with powerful features without the bloat of traditional frameworks.

## Why Abret?

- **Zero Runtime Overhead**: Routes are compiled to native `Bun.serve` routing table.
- **Type Safety**: strict TypeScript inference for route parameters and context.
- **Standards Based**: Uses standard `Request` and `Response` objects.
- **Built-in JSX**: Server-side rendering without React or heavy Virtual DOM.
- **Composable**: Middleware and Context system inspired by functional patterns.

## Installation

```bash
bun add abret
```

## Quick Start

Create a file named `server.ts`:

```ts
import { createAbret } from "abret";
import { html } from "abret/html";

// Initialize Abret
const { createRoute, mergeRoutes } = createAbret();

const home = createRoute("/", () => {
  return html`<h1>Welcome to Abret</h1>`;
});

Bun.serve({
  port: 3000,
  routes: mergeRoutes(home),
});
```

Run it:

```bash
bun run server.ts
```
