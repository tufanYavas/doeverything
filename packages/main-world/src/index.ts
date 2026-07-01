import { getFormFields, getDOMState, getNewElements, findHTMLElement } from '@doeverything/dom-processor';
import type { SelectorMap, SerializerOptions, DOMStateResult } from '@doeverything/dom-processor';

declare global {
  interface Window {
    ___selectorMap?: SelectorMap;
    ___oadp?: Record<string, unknown>;
  }
}

/**
 * Last selectorMap from getDOMState call.
 * Persists across calls so action tools can resolve element IDs.
 */
let lastSelectorMap: SelectorMap | null = null;

/**
 * Last full DOM state result.
 */
let lastResult: DOMStateResult | null = null;

/**
 * Wrapper around getDOMState that caches selectorMap for element lookup.
 */
function getDOMStateWrapped(previousSelectorMap?: SelectorMap | null, options?: SerializerOptions): DOMStateResult {
  const result = getDOMState(previousSelectorMap ?? lastSelectorMap ?? undefined, options);
  lastSelectorMap = result.selectorMap;
  lastResult = result;
  window.___selectorMap = result.selectorMap;
  return result;
}

/**
 * Resolve a backend_node_id to a live HTMLElement.
 * Used by action tools (click, form_input, file_upload, etc.)
 * to find the DOM element corresponding to [N] in browser state.
 */
function getElement(backendNodeId: number): HTMLElement | null {
  if (!lastSelectorMap) return null;
  const node = lastSelectorMap[backendNodeId];
  if (!node) return null;
  return findHTMLElement(node);
}

window.___oadp = {
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
