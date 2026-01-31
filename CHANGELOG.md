# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### 🚀 Features

- **Direct API Exports**:
  - Deprecated and removed the `createAbret` factory pattern.
  - Exported `createRoute`, `createRouteGroup`, `mergeRoutes`, `createMiddleware`, and `composeMiddlewares` directly from the main entry point.
  - Exported context utilities (`createContext`, `useContext`, `setContext`, etc.) directly from the main entry point for easier access.

- **Exact Path Matching**:
  - Simplified routing by removing automatic trailing slash handling and the `trailingSlash` configuration.
  - Abret now uses exact path matching as provided in the route definition.
  - Users can now manually implement redirection strategies using catch-all routes if desired.

- **Component Support in Template Literals**:
  - Enabled rendering of functional components directly within `html` tagged template literals.
  - Supported dynamic syntax: `` html`<${Component} prop="value" />` ``.
  - Added support for nested, async, and self-closing/void components.
  - Introduced support for the `<//>` closing tag syntax for cleaner nested structures.

- **`dangerouslySetInnerHTML` Support**:
  - Implemented support for `dangerouslySetInnerHTML` in JSX to render raw, unescaped HTML content.
  - Added strict TypeScript definitions for better IDE operational support.

- **`raw()` Helper Utility**:
  - Introduced the `raw(str)` helper function as a standard way to creating unescaped `SafeString` content.
  - Provides a shorthand alternative to usage of `new SafeString()`.

### 🛠 Internal Improvements

- **API Simplification**: Removed internal configuration context and normalization logic to reduce runtime overhead and bundle size.
- **Robout HTML Parser**: Implemented a custom, zero-dependency HTM-like parser within `src/html.ts` to power the new template literal component features.
- **Code Consistency**: Refactored internal `src/html.ts` logic to consistently use the `raw()` helper instead of direct `SafeString` instantiation.

### ✅ Testing

- Added comprehensive test suites verifying component rendering, async handling, and raw HTML injection strategies in `tests/html.test.ts`.
- Updated routing tests to verify exact path matching and manual redirection patterns.
