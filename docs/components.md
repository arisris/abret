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
import { html } from "abret";

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
import { createContext, useContext } from "abret";

const Theme = createContext("light");

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
html(<UserProfile id="1" />);
```
