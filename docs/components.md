# HTML & Components

Abret includes a lightweight JSX compiler and HTML rendering engine tailored for server-side responses.

## Setup

Abret works with standard TSX files. Ensure your `tsconfig.json` is set to:

```json
{
  "jsx": "react-jsx",
  "jsxImportSource": "abret"
}
```

## HTML Responses

Use the `html` helper to return an `HTMLResponse`.

### Using JSX

```tsx
import { createRoute } from "abret";
import { html } from "abret/html";

function App() {
  return <div>Hello World</div>;
}

createRoute("/", () => {
  return html(<App />);
});
```

### Using Template Strings

You can also use tagged template literals for quick HTML chunks.

```ts
const name = "World";
return html`<h1>Hello ${name}</h1>`;
```

## Metadata & Head Management

Abret automatically manages the `<head>` of your document. Meta tags rendered anywhere in your component tree will be hoisted to the head.

```tsx
function SEO({ title }) {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content="My App" />
    </>
  );
}

function Page() {
  return (
    <html>
      <body>
        <SEO title="Home Page" />
        <h1>Content</h1>
      </body>
    </html>
  );
}
```

## Component Context

Similar to React, you can pass data through the component tree without props drilling.

```tsx
import { createContext, useContext } from "abret/store";

// Use default value if you want a Provider immediately
// This returns a ContextWithProvider object
const Theme = createContext("theme", "light");

function Button() {
  const theme = useContext(Theme);
  return <button class={theme}>Click</button>;
}

function App() {
  return (
    <Theme.Provider value="dark">
      <Button />
    </Theme.Provider>
  );
}
```

## Async Components

Abret supports `async` components and `Suspense`-like behavior via `Promise`.

```tsx
async function UserProfile({ id }) {
  const user = await db.getUser(id);
  return <div>{user.name}</div>;
}

// Automatically awaited during render
// Automatically awaited during render
html(<UserProfile id="1" />);
```

## Raw HTML & dangerouslySetInnerHTML

You can inject raw HTML strings using either the `raw` helper or the `dangerouslySetInnerHTML` prop.

### Using `raw` Helper

```tsx
import { raw } from "abret/html";

// In JSX
return <div>{raw("<span>Raw Content</span>")}</div>;

// In Template Literals
return html`<div>${raw("<strong>Bold</strong>")}</div>`;
```

### Using `dangerouslySetInnerHTML`

Compatible with React patterns:

```tsx
<div dangerouslySetInnerHTML={{ __html: "<p>Legacy Content</p>" }} />
```

## Components in Template Literals

You can render components directly within `html` template literals, which is useful if you prefer not to use a build step for JSX.

```tsx
function Button({ label }) {
  return html`<button>${label}</button>`;
}

// Function Component
const view = html`
  <div>
    <${Button} label="Click Me" />
  </div>
`;
```

Supported features:

- **Dynamic Props**: `<${Component} count=${count} />`
- **Spread Props**: `<${Component} ...${props} />`
- **Children**: `<${Wrapper}>Content<//>` (using `<//>` to close)
- **Self-Closing**: `<${Component} />`
