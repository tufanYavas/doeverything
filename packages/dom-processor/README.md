# @doeverything/dom-processor

Browser DOM scanner and LLM serializer for AI browser agents. Scans the live DOM, extracts accessibility and visual information, and serializes it to a compact text format optimized for LLM consumption.

## Features

- **DOM scanning** — traverses the full document tree including shadow DOM, iframes, and cross-frame content
- **Interactivity detection** — identifies clickable, focusable, and form elements using ARIA roles, computed styles, and accessibility tree data
- **LLM serialization** — produces a numbered, indented element tree that LLMs can use to identify and act on page elements
- **Stable element IDs** — fingerprint-based IDs that survive SPA re-renders without CDP
- **Form field extraction** — extract and fill form fields with resolved labels
- **Viewport filtering** — configurable threshold for capturing off-screen elements

## Usage

```typescript
import { getDOMState, getFormFields } from '@doeverything/dom-processor';

// Get full DOM state for LLM
const { browserState, selectorMap } = getDOMState();
// Send browserState to your LLM, use selectorMap to resolve element references

// Extract form fields
const fields = await getFormFields();
```

## API

### `getDOMState(previousSelectorMap?, options?)`

Scans the DOM and returns a complete state snapshot.

- `browserState` — string ready to send to an LLM
- `selectorMap` — map of element index → DOM node (for executing actions)
- `rootNode` — root of the enhanced DOM tree
- `serializedState` — structured intermediate representation

### `getBrowserStateString()`

Returns just the LLM-ready string. Shorthand for `getDOMState().browserState`.

### `getFormFields()`

Extracts all form-fillable fields with resolved labels, current values, and field types.

### `DOMTreeSerializer`

Low-level serializer class for custom pipelines.

### `DomService`

DOM scanner that builds the enhanced node tree.

## Browser-only

This package runs in browser context only (content scripts, injected scripts). It requires `document`, `window`, `getComputedStyle`, and related browser APIs.

## Attribution

DOM processing approach inspired by [browser-use](https://github.com/browser-use/browser-use) (MIT).

## License

MIT
