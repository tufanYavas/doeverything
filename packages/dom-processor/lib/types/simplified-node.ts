import type { EnhancedDOMNode } from './dom-node.js';

/**
 * Simplified tree node for optimization
 */
export interface SimplifiedNode {
  /** Reference to original enhanced node */
  originalNode: EnhancedDOMNode;
  /** Optimized children list */
  children: SimplifiedNode[];
  /** Whether this node should be displayed in output */
  shouldDisplay: boolean;
  /** Whether this element is interactive (in selector_map) */
  isInteractive: boolean;
  /** Whether this is a new element (not in previous state) */
  isNew: boolean;
  /** Whether this element is a shadow host */
  isShadowHost: boolean;
  /** Whether ignored by paint order (z-index occlusion) */
  ignoredByPaintOrder: boolean;
  /** Whether excluded by parent bounding box */
  excludedByParent: boolean;
  /** Whether this is a compound component (virtual sub-element) */
  isCompoundComponent: boolean;
}

/**
 * Create a simplified node from enhanced node
 */
export function createSimplifiedNode(originalNode: EnhancedDOMNode): SimplifiedNode {
  return {
    originalNode,
    children: [],
    shouldDisplay: true,
    isInteractive: false,
    isNew: false,
    isShadowHost: originalNode.isShadowHost,
    ignoredByPaintOrder: false,
    excludedByParent: false,
    isCompoundComponent: false,
  };
}
