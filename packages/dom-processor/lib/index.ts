/**
 * @doeverything/dom-processor
 *
 * DOM processing for LLM consumption.
 * Scans DOM, extracts accessibility and visual info, and serializes
 * to a text format optimized for AI agents.
 *
 * Also provides form-focused extraction for autofill use cases.
 */

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Convenience Functions
// ============================================================================

import { DOMTreeSerializer } from './serializer/index.js';
import { DomService, FormFieldExtractor } from './services/index.js';
import { PageStateBuilder } from './state-builder/index.js';
import type { SerializerOptions } from './serializer/index.js';
import type { FormField } from './services/index.js';
import type { SerializedDOMState, SelectorMap, EnhancedDOMNode } from './types/index.js';

export * from './types/index.js';
export { isElementTrulyVisible } from './utils/visibility.js';

// ============================================================================
// Services
// ============================================================================

export { DomService } from './services/index.js';
export { FormFieldExtractor, type FormField, type FormFieldType } from './services/index.js';
export { fillFormField, fillFileInput } from './services/index.js';

// ============================================================================
// Serializer
// ============================================================================

export { DOMTreeSerializer, type SerializerOptions } from './serializer/index.js';

// ============================================================================
// State Builder
// ============================================================================

export { PageStateBuilder } from './state-builder/index.js';

/**
 * Result from getDOMState function
 */
export interface DOMStateResult {
  /** Full browser state string ready for LLM */
  browserState: string;
  /** Selector map: backend_node_id â†’ EnhancedDOMNode (for executing actions) */
  selectorMap: SelectorMap;
  /** Root of enhanced DOM tree */
  rootNode: EnhancedDOMNode;
  /** Serialized state */
  serializedState: SerializedDOMState;
}

/**
 * One-shot function to get full DOM state for LLM.
 *
 * @param previousSelectorMap - Previous state's selectorMap for detecting new elements
 * @param options - Serializer options (bbox filtering, etc.)
 *
 * @example
 * ```typescript
 * const { browserState, selectorMap } = getDOMState();
 *
 * // Send browserState to LLM
 * const response = await llm.chat(browserState);
 *
 * // Execute action on element by backend_node_id
 * const element = selectorMap[42]; // Get element [42]
 * ```
 */
export function getDOMState(previousSelectorMap?: SelectorMap | null, options?: SerializerOptions): DOMStateResult {
  // Step 1: Scan document (with viewport filtering at scan time)
  const domService = new DomService();
  const viewportExpansion = options?.viewportExpansion !== undefined ? options.viewportExpansion : null;
  const rootNode = domService.scanDocument(undefined, viewportExpansion);

  // Step 2: Serialize (create simplified tree â†’ optimize â†’ bbox filter â†’ assign indices)
  const serializer = new DOMTreeSerializer(rootNode, domService, previousSelectorMap || null, options);
  const serializedState = serializer.serialize();

  // Step 3: Build browser state
  // When viewportExpansion is null, full DOM is captured â€” scroll markers are meaningless.
  const fullPage = viewportExpansion === null;
  const stateBuilder = new PageStateBuilder(serializedState, { fullPage });
  const browserState = stateBuilder.buildFullStateMessage();

  return {
    browserState,
    selectorMap: serializedState.selectorMap,
    rootNode,
    serializedState,
  };
}

/**
 * Get just the browser state string (simpler API)
 */
export function getBrowserStateString(): string {
  const { browserState } = getDOMState();
  return browserState;
}

/**
 * Get element by backend_node_id from selector map
 */
export function getElementByIndex(selectorMap: SelectorMap, backendNodeId: number): EnhancedDOMNode | undefined {
  return selectorMap[backendNodeId];
}

/**
 * Find HTML element from enhanced node
 */
export function findHTMLElement(node: EnhancedDOMNode): HTMLElement | null {
  // Try sourceElement first
  if (node.sourceElement) return node.sourceElement as HTMLElement;

  // Try by selector
  if (node.selector) {
    try {
      const element = document.querySelector(node.selector);
      if (element) return element as HTMLElement;
    } catch {
      // Selector might be invalid
    }
  }

  // Try by XPath
  if (node.xpath) {
    try {
      const result = document.evaluate(node.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (result.singleNodeValue) return result.singleNodeValue as HTMLElement;
    } catch {
      // XPath might be invalid
    }
  }

  return null;
}

/**
 * Get all elements that are new since the last state
 */
export function getNewElements(selectorMap: SelectorMap): EnhancedDOMNode[] {
  const newElements: EnhancedDOMNode[] = [];
  for (const node of Object.values(selectorMap)) {
    if (node.isNew) {
      newElements.push(node);
    }
  }
  return newElements;
}

// ============================================================================
// Form Field Convenience Functions
// ============================================================================

/**
 * One-shot function to extract all form-fillable fields with resolved labels.
 */
export async function getFormFields(): Promise<FormField[]> {
  const extractor = new FormFieldExtractor();
  return extractor.extractFormFields();
}
