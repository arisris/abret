# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### 🚀 Features

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

- **Robout HTML Parser**: Implemented a custom, zero-dependency HTM-like parser within `src/html.ts` to power the new template literal component features.
- **Code Consistency**: Refactored internal `src/html.ts` logic to consistently use the `raw()` helper instead of direct `SafeString` instantiation.

### ✅ Testing

- Added comprehensive test suites verifying component rendering, async handling, and raw HTML injection strategies in `tests/html.test.ts`.
