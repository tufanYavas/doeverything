// Core DOM types
export {
  NodeType,
  type AccessibilityProperty,
  type AccessibilityNode,
  type VisualInfo,
  type ComputedStylesSubset,
  type DOMRectData,
  type CompoundChildInfo,
  type PropagatingBounds,
  type EnhancedDOMNode,
  createEmptyEnhancedNode,
} from './dom-node.js';

// Simplified node for serialization
export { type SimplifiedNode, createSimplifiedNode } from './simplified-node.js';

// Serialized state
export { type SelectorMap, type SerializedDOMState, createEmptySerializedState } from './serialized-state.js';

// Page statistics
export { type PageStats, type PageInfo, createEmptyPageStats, getCurrentPageInfo } from './page-stats.js';
