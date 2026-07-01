import type { EnhancedDOMNode } from './dom-node.js';
import type { SimplifiedNode } from './simplified-node.js';

/**
 * Selector map: backend_node_id -> node reference
 * The model outputs backend_node_id to identify elements.
 */
export type SelectorMap = Record<number, EnhancedDOMNode>;

/**
 * Serialized DOM state ready for LLM consumption
 */
export interface SerializedDOMState {
  /** Root of the simplified tree */
  root: SimplifiedNode | null;
  /** Map of backend_node_id to nodes for action execution */
  selectorMap: SelectorMap;
  /** Total number of interactive elements */
  interactiveCount: number;
}

/**
 * Create empty serialized state
 */
export function createEmptySerializedState(): SerializedDOMState {
  return {
    root: null,
    selectorMap: {},
    interactiveCount: 0,
  };
}
