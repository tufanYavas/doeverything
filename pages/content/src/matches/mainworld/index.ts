/**
 * doeverything MAIN-world content script.
 *
 * The DOM walker (`window.___oadp`) gives ISOLATED-world tools the structured
 * tree they need to:
 *   - serialize the page into a compact text representation that
 *     LLMs can read efficiently (`browserState`)
 *   - resolve [N] ref ids back to live HTMLElements for click/input/etc.
 *   - flag DOM mutations between calls (new elements detection)
 *
 * Backed by `@doeverything/dom-processor` — the same processor the reference
 * implementation uses. Injected at `document_start` so the cache is ready
 * before any tool fires.
 */

import { getDOMState, getFormFields, getNewElements, findHTMLElement } from '@doeverything/dom-processor';
import type { SelectorMap, SerializerOptions, DOMStateResult } from '@doeverything/dom-processor';

declare global {
  interface Window {
    ___selectorMap?: SelectorMap;
    ___oadp?: Record<string, unknown>;
  }
}

let lastSelectorMap: SelectorMap | null = null;
let lastResult: DOMStateResult | null = null;

/**
 * Wrapper around getDOMState that caches the selectorMap so action tools can
 * resolve element refs across calls. Mirrors the reference impl: callers may
 * pass `null` (or omit) to reuse the cached map; passing an explicit prior map
 * forces "new element" detection against that snapshot.
 */
function getDOMStateWrapped(previousSelectorMap?: SelectorMap | null, options?: SerializerOptions): DOMStateResult {
  const result = getDOMState(previousSelectorMap ?? lastSelectorMap ?? undefined, options);
  lastSelectorMap = result.selectorMap;
  lastResult = result;
  window.___selectorMap = result.selectorMap;
  return result;
}

/**
 * Resolve a backend_node_id ([N] index from browserState) to a live
 * HTMLElement. Used by action tools (click, input, file_upload, etc.).
 */
function getElement(backendNodeId: number): HTMLElement | null {
  if (!lastSelectorMap) return null;
  const node = lastSelectorMap[backendNodeId];
  if (!node) return null;
  return findHTMLElement(node);
}

const processor = {
  getFormFields,
  getDOMState: getDOMStateWrapped,
  getNewElements,
  getElement,
  findHTMLElement,
  get selectorMap() {
    return lastSelectorMap;
  },
  get lastResult() {
    return lastResult;
  },
};

if (!window.___oadp) {
  Object.defineProperty(window, '___oadp', {
    value: processor,
    configurable: false,
    writable: false,
    enumerable: false,
  });
}
