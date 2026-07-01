import { DOMTreeSerializer } from '../serializer/index.js';
import { NodeType, createEmptyPageStats, getCurrentPageInfo } from '../types/index.js';
import type { SerializedDOMState, SimplifiedNode, PageStats, PageInfo } from '../types/index.js';

/**
 * PageStateBuilder — returns the raw DOM llm_representation exactly like
 * Python `state.dom_state.llm_representation()`. No header, no wrapper.
 *
 * The fullPage option is retained for backward-compatible constructor
 * signature but does not affect the output.
 */
export class PageStateBuilder {
  private serializedState: SerializedDOMState;

  private fullPage: boolean;

  constructor(serializedState: SerializedDOMState, options?: { fullPage?: boolean }) {
    this.serializedState = serializedState;
    this.fullPage = options?.fullPage ?? false;
  }

  /**
   * Extract page statistics from serialized tree
   */
  extractPageStats(): PageStats {
    const stats = createEmptyPageStats();
    if (!this.serializedState.root) return stats;
    this.traverseForStats(this.serializedState.root, stats);
    return stats;
  }

  private traverseForStats(node: SimplifiedNode, stats: PageStats): void {
    stats.totalElements++;
    const original = node.originalNode;

    if (original.nodeType === NodeType.ELEMENT_NODE) {
      const tag = original.tagName.toLowerCase();
      if (tag === 'a') stats.links++;
      if (tag === 'iframe' || tag === 'frame') stats.iframes++;
      if (tag === 'img') stats.images++;
      if (node.isInteractive) stats.interactiveElements++;
      if (original.visual.isScrollable) stats.scrollContainers++;
      if (node.isShadowHost) {
        const shadowType = original.shadowRoots[0]?.shadowRootType;
        if (shadowType === 'closed') stats.shadowClosed++;
        else stats.shadowOpen++;
      }
    }

    for (const child of node.children) this.traverseForStats(child, stats);
  }

  /**
   * Get page scroll/position information
   */
  getPageInfo(): PageInfo {
    return getCurrentPageInfo();
  }

  /**
   * Return the raw serialize_tree llm_representation output.
   * Matches Python `state.dom_state.llm_representation()` — no header,
   * no wrapper, no preamble. Just the tree text.
   */
  buildFullStateMessage(): string {
    return DOMTreeSerializer.llmRepresentation(this.serializedState);
  }
}
