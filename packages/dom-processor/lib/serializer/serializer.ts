/**
 * DOMTreeSerializer — Serializes enhanced DOM trees to string format optimized for LLM consumption.
 */

import { NodeType, createSimplifiedNode } from '../types/index.js';
import type { DomService } from '../services/index.js';
import type {
  EnhancedDOMNode,
  SimplifiedNode,
  SerializedDOMState,
  SelectorMap,
  DOMRectData,
  PropagatingBounds,
} from '../types/index.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Attributes to include in serialized output
 */
const DEFAULT_INCLUDE_ATTRIBUTES = [
  'title',
  'type',
  'checked',
  'id',
  'name',
  'role',
  'value',
  'placeholder',
  'data-date-format',
  'alt',
  'aria-label',
  'aria-expanded',
  'data-state',
  'aria-checked',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'aria-placeholder',
  'pattern',
  'min',
  'max',
  'minlength',
  'maxlength',
  'step',
  'accept',
  'multiple',
  'inputmode',
  'autocomplete',
  'aria-autocomplete',
  'list',
  'data-mask',
  'data-inputmask',
  'data-datepicker',
  'format',
  'expected_format',
  'contenteditable',
  'pseudo',
  'checked',
  'selected',
  'expanded',
  'pressed',
  'disabled',
  'invalid',
  'valuemin',
  'valuemax',
  'valuenow',
  'keyshortcuts',
  'haspopup',
  'multiselectable',
  'required',
  'valuetext',
  'level',
  'busy',
  'live',
  'ax_name',
];

/**
 * SVG child elements to skip (decorative only)
 */
// Note: 'clipPath' is intentionally camelCase. Comparisons are against lowercased
// tag names, so this entry never fires in practice — a known quirk preserved
// for output compatibility.
const SVG_ELEMENTS = new Set([
  'path',
  'rect',
  'g',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'use',
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'image',
  'text',
  'tspan',
]);

/**
 * Non-content elements to skip entirely
 */
const DISABLED_ELEMENTS = new Set(['style', 'script', 'head', 'meta', 'link', 'title']);

// ============================================================================
// Options
// ============================================================================

export interface SerializerOptions {
  /**
   * Pixel threshold beyond the visible viewport to still consider elements
   * "visible" for DOM capture.
   *
   * Accepted values:
   *   - `undefined` (omitted) → internal default of the caller. The
   *     `dom-processor` scanDocument helper falls back to `1000` when its
   *     argument is undefined; the outer `getDOMState` wrapper currently
   *     passes `null` when the `options` object has no `viewportExpansion`
   *     key, so no-args `getDOMState()` captures the full page.
   *   - `null` → **viewport filter disabled**. Every CSS-visible element
   *     on the page is captured regardless of scroll position. Use this when you
   *     need an element that might be off-screen (e.g. agent searching
   *     for a button it will scroll to).
   *   - `0` → **strict viewport**. Only elements whose bounding box
   *     intersects the user's current visible screen are captured. No
   *     tolerance; an element 1 pixel below the fold is excluded.
   *   - `N > 0` → **viewport ± N pixels tolerance**. Elements within N
   *     pixels above/below/left/right of the visible viewport are
   *     included. Default is 1000 — catches just-off-screen content so
   *     the agent can scroll into it.
   */
  viewportExpansion?: number | null;
  /**
   * Enable bounding box filtering (propagating bounds from a/button).
   * Default: true
   */
  enableBboxFiltering?: boolean;
  /**
   * Containment threshold (0.0-1.0) for bbox filtering.
   * Default: 0.99 (99%)
   */
  containmentThreshold?: number;
}

// ============================================================================
// Propagating element patterns
// ============================================================================

const PROPAGATING_ELEMENTS: Array<{ tag: string; role: string | null }> = [
  { tag: 'a', role: null }, // Any <a> tag
  { tag: 'button', role: null }, // Any <button> tag
  { tag: 'div', role: 'button' }, // <div role="button">
  { tag: 'div', role: 'combobox' }, // <div role="combobox">
  { tag: 'span', role: 'button' }, // <span role="button">
  { tag: 'span', role: 'combobox' }, // <span role="combobox">
  { tag: 'input', role: 'combobox' }, // <input role="combobox">
];

// ============================================================================
// DOMTreeSerializer
// ============================================================================

export class DOMTreeSerializer {
  private root: EnhancedDOMNode;
  private domService: DomService;
  private interactiveCounter: number = 1;
  private selectorMap: SelectorMap = {};
  private previousBackendIds: Set<number> | null = null;
  private enableBboxFiltering: boolean;
  private containmentThreshold: number;
  private clickableCache: Map<number, boolean> = new Map();

  constructor(
    root: EnhancedDOMNode,
    domService: DomService,
    previousSelectorMap: SelectorMap | null = null,
    options: SerializerOptions = {},
  ) {
    this.root = root;
    this.domService = domService;
    // Pre-compute the set of previous backendNodeIds once, instead of per-node
    this.previousBackendIds = previousSelectorMap
      ? new Set(Object.values(previousSelectorMap).map(n => n.backendNodeId))
      : null;
    this.enableBboxFiltering = options.enableBboxFiltering ?? true;
    this.containmentThreshold = options.containmentThreshold ?? 0.99;
  }

  // ========================================================================
  // Main entry point
  // ========================================================================

  serialize(): SerializedDOMState {
    // Reset state
    this.interactiveCounter = 1;
    this.selectorMap = {};
    this.clickableCache.clear();

    // Step 1: Create simplified tree (includes clickable detection)
    const simplifiedTree = this.createSimplifiedTree(this.root);

    if (!simplifiedTree) {
      return { root: null, selectorMap: {}, interactiveCount: 0 };
    }

    // Step 2: Paint order filtering — not available without CDP, skip
    // (requires DOMSnapshot.paintOrders from a CDP session)

    // Step 3: Optimize tree (remove unnecessary parents)
    const optimizedTree = this.optimizeTree(simplifiedTree);

    if (!optimizedTree) {
      return { root: null, selectorMap: {}, interactiveCount: 0 };
    }

    // Step 4: Bounding box filtering (propagating bounds from a/button)
    if (this.enableBboxFiltering) {
      this.applyBoundingBoxFiltering(optimizedTree);
    }

    // Step 5: Assign interactive indices and mark new nodes
    this.assignInteractiveIndicesAndMarkNewNodes(optimizedTree);

    return {
      root: optimizedTree,
      selectorMap: this.selectorMap,
      interactiveCount: this.interactiveCounter - 1,
    };
  }

  // ========================================================================
  // Step 1: Create simplified tree
  // ========================================================================

  private isInteractiveCached(node: EnhancedDOMNode): boolean {
    if (!this.clickableCache.has(node.nodeId)) {
      this.clickableCache.set(node.nodeId, this.domService.isInteractive(node));
    }
    return this.clickableCache.get(node.nodeId)!;
  }

  private createSimplifiedTree(node: EnhancedDOMNode, depth: number = 0): SimplifiedNode | null {
    // DOCUMENT_NODE — iframe content document
    if (node.nodeType === NodeType.DOCUMENT_NODE) {
      for (const child of [...node.children, ...node.shadowRoots]) {
        const simplified = this.createSimplifiedTree(child, depth + 1);
        if (simplified) return simplified;
      }
      return null;
    }

    // DOCUMENT_FRAGMENT_NODE — shadow root
    // ENHANCED shadow DOM processing - always include shadow content.
    // Always return shadow DOM fragments, even if children seem empty.
    if (node.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE) {
      const simplified = createSimplifiedNode(node);
      for (const child of [...node.children, ...node.shadowRoots]) {
        const childSimplified = this.createSimplifiedTree(child, depth + 1);
        if (childSimplified) simplified.children.push(childSimplified);
      }
      return simplified;
    }

    if (node.nodeType === NodeType.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();

      // Skip non-content elements
      if (DISABLED_ELEMENTS.has(tag)) return null;

      // Skip SVG child elements
      if (SVG_ELEMENTS.has(tag)) return null;

      // Check for exclude attribute (data-browser-use-exclude is an API attribute users set on their HTML).
      const excludeAttr = node.attributes['data-browser-use-exclude'];
      if (typeof excludeAttr === 'string' && excludeAttr.toLowerCase() === 'true') {
        return null;
      }

      // IFRAME/FRAME: process content document
      if ((tag === 'iframe' || tag === 'frame') && node.contentDocument) {
        const simplified = createSimplifiedNode(node);
        for (const child of node.contentDocument.children) {
          const childSimplified = this.createSimplifiedTree(child, depth + 1);
          if (childSimplified) simplified.children.push(childSimplified);
        }
        return simplified;
      }

      let isVisible = node.visual.isVisible;
      const isScrollable = DOMTreeSerializer.isActuallyScrollableStatic(node);
      const hasShadowContent = node.children.length > 0 || node.shadowRoots.length > 0;

      // Shadow host detection
      const isShadowHost = node.shadowRoots.some(sr => sr.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE);

      // Override visibility for elements with validation attributes
      if (!isVisible && node.attributes) {
        const hasValidationAttrs = Object.keys(node.attributes).some(
          attr => attr.startsWith('aria-') || attr.startsWith('pseudo'),
        );
        if (hasValidationAttrs) isVisible = true;
      }

      // Override visibility for file inputs
      const isFileInput = tag === 'input' && node.attributes.type === 'file';
      if (!isVisible && isFileInput) isVisible = true;

      // Override visibility for CSS-hidden checkboxes/radios whose visual
      // representation is delegated to a sibling or parent <label> via
      // ::before/::after pseudo-elements (custom toggle/radio pattern).
      const isHiddenFormToggle =
        tag === 'input' &&
        (node.attributes.type === 'checkbox' || node.attributes.type === 'radio');
      if (!isVisible && isHiddenFormToggle && this.hasVisibleAssociatedLabel(node)) {
        isVisible = true;
      }

      // Include if visible, scrollable, has children, or is shadow host
      if (isVisible || isScrollable || hasShadowContent || isShadowHost) {
        const simplified = createSimplifiedNode(node);
        simplified.isShadowHost = isShadowHost;

        // Process ALL children including shadow roots
        for (const child of node.children) {
          const childSimplified = this.createSimplifiedTree(child, depth + 1);
          if (childSimplified) simplified.children.push(childSimplified);
        }
        for (const shadowRoot of node.shadowRoots) {
          const shadowSimplified = this.createSimplifiedTree(shadowRoot, depth + 1);
          if (shadowSimplified) simplified.children.push(shadowSimplified);
        }

        // Add compound components
        this.addCompoundComponents(simplified, node);

        // Shadow host special case: always include if has children
        if (isShadowHost && simplified.children.length > 0) {
          return simplified;
        }

        // Return if meaningful
        if (isVisible || isScrollable || simplified.children.length > 0) {
          return simplified;
        }
      }
    } else if (node.nodeType === NodeType.TEXT_NODE) {
      // Include meaningful text nodes
      const isVisible = node.visual.isVisible;
      if (isVisible && node.textContent && node.textContent.trim() && node.textContent.trim().length > 1) {
        return createSimplifiedNode(node);
      }
    }

    return null;
  }

  // ========================================================================
  // Step 3: Optimize tree
  // ========================================================================

  private optimizeTree(node: SimplifiedNode | null): SimplifiedNode | null {
    if (!node) return null;

    // Process children
    const optimizedChildren: SimplifiedNode[] = [];
    for (const child of node.children) {
      const optimized = this.optimizeTree(child);
      if (optimized) optimizedChildren.push(optimized);
    }
    node.children = optimizedChildren;

    // Keep meaningful nodes
    const isVisible = node.originalNode.visual.isVisible;
    const isFileInput = node.originalNode.tagName === 'input' && node.originalNode.attributes.type === 'file';
    const isHiddenFormToggle =
      node.originalNode.tagName === 'input' &&
      (node.originalNode.attributes.type === 'checkbox' || node.originalNode.attributes.type === 'radio') &&
      this.hasVisibleAssociatedLabel(node.originalNode);

    if (
      isVisible ||
      DOMTreeSerializer.isActuallyScrollableStatic(node.originalNode) ||
      node.originalNode.nodeType === NodeType.TEXT_NODE ||
      node.children.length > 0 ||
      isFileInput ||
      isHiddenFormToggle
    ) {
      return node;
    }

    return null;
  }

  // ========================================================================
  // Step 4: Bounding box filtering
  // ========================================================================

  private applyBoundingBoxFiltering(node: SimplifiedNode): void {
    this.filterTreeRecursive(node, null, 0);
  }

  private filterTreeRecursive(node: SimplifiedNode, activeBounds: PropagatingBounds | null, depth: number): void {
    // Check if this node should be excluded by active bounds
    if (activeBounds && this.shouldExcludeChild(node, activeBounds)) {
      node.excludedByParent = true;
    }

    // Check if this node starts new propagation
    let newBounds: PropagatingBounds | null = null;
    const tag = node.originalNode.tagName.toLowerCase();
    const role = node.originalNode.attributes.role || null;

    if (this.isPropagatingElement(tag, role)) {
      const bounds = node.originalNode.visual.bounds;
      if (bounds) {
        newBounds = { tag, bounds, nodeId: node.originalNode.nodeId, depth };
      }
    }

    // Propagate to ALL children
    const propagateBounds = newBounds || activeBounds;
    for (const child of node.children) {
      this.filterTreeRecursive(child, propagateBounds, depth + 1);
    }
  }

  private shouldExcludeChild(node: SimplifiedNode, activeBounds: PropagatingBounds): boolean {
    // Never exclude text nodes
    if (node.originalNode.nodeType === NodeType.TEXT_NODE) return false;

    // Get child bounds
    const childBounds = node.originalNode.visual.bounds;
    if (!childBounds) return false;

    // Check containment
    if (!this.isContained(childBounds, activeBounds.bounds, this.containmentThreshold)) {
      return false;
    }

    const childTag = node.originalNode.tagName.toLowerCase();
    const childRole = node.originalNode.attributes.role || null;

    // EXCEPTION: Never exclude form elements
    if (['input', 'select', 'textarea', 'label'].includes(childTag)) return false;

    // EXCEPTION: Keep if child is also a propagating element
    if (this.isPropagatingElement(childTag, childRole)) return false;

    // EXCEPTION: Keep if has onclick handler
    if (node.originalNode.attributes.onclick) return false;

    // EXCEPTION: Keep if has aria-label
    const ariaLabel = node.originalNode.attributes['aria-label'];
    if (ariaLabel && ariaLabel.trim()) return false;

    // EXCEPTION: Keep if has interactive role
    const role = node.originalNode.attributes.role;
    if (role && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option'].includes(role)) {
      return false;
    }

    return true;
  }

  private isContained(child: DOMRectData, parent: DOMRectData, threshold: number): boolean {
    const xOverlap = Math.max(
      0,
      Math.min(child.x + child.width, parent.x + parent.width) - Math.max(child.x, parent.x),
    );
    const yOverlap = Math.max(
      0,
      Math.min(child.y + child.height, parent.y + parent.height) - Math.max(child.y, parent.y),
    );
    const intersectionArea = xOverlap * yOverlap;
    const childArea = child.width * child.height;
    if (childArea === 0) return false;
    return intersectionArea / childArea >= threshold;
  }

  private isPropagatingElement(tag: string, role: string | null): boolean {
    for (const pattern of PROPAGATING_ELEMENTS) {
      const tagMatch = pattern.tag === tag;
      const roleMatch = pattern.role === null || pattern.role === role;
      if (tagMatch && roleMatch) return true;
    }
    return false;
  }

  // ========================================================================
  // Step 5: Assign interactive indices
  // ========================================================================

  private assignInteractiveIndicesAndMarkNewNodes(node: SimplifiedNode | null): void {
    if (!node) return;

    // Skip excluded or paint-order-ignored nodes
    if (!node.excludedByParent && !node.ignoredByPaintOrder) {
      const isInteractiveAssign = this.isInteractiveCached(node.originalNode);
      const isVisible = node.originalNode.visual.isVisible;
      const isScrollable = DOMTreeSerializer.isActuallyScrollableStatic(node.originalNode);

      const isFileInput = node.originalNode.tagName === 'input' && node.originalNode.attributes.type === 'file';
      const isHiddenFormToggle =
        node.originalNode.tagName === 'input' &&
        (node.originalNode.attributes.type === 'checkbox' || node.originalNode.attributes.type === 'radio') &&
        this.hasVisibleAssociatedLabel(node.originalNode);

      // Shadow DOM form elements may lack visibility data
      const isShadowDomElement =
        isInteractiveAssign &&
        !isVisible &&
        ['input', 'button', 'select', 'textarea', 'a'].includes(node.originalNode.tagName) &&
        this.isInsideShadowDom(node);

      let shouldMakeInteractive = false;

      if (isScrollable) {
        // Scrollable elements: check for dropdown or no interactive descendants
        const attrs = node.originalNode.attributes;
        const nodeRole = (attrs.role || '').toLowerCase();
        const tag = node.originalNode.tagName.toLowerCase();
        const classAttr = (attrs.class || '').toLowerCase();
        const classList = classAttr.split(/\s+/);

        const isDropdownByRole = ['listbox', 'menu', 'combobox', 'menubar', 'tree', 'grid'].includes(nodeRole);
        const isDropdownByTag = tag === 'select';
        const isDropdownByClass =
          classList.includes('dropdown') ||
          classList.includes('dropdown-menu') ||
          classList.includes('select-menu') ||
          (classList.includes('ui') && classAttr.includes('dropdown')); // Semantic UI
        const isDropdownContainer = isDropdownByRole || isDropdownByTag || isDropdownByClass;

        if (isDropdownContainer) {
          shouldMakeInteractive = true;
        } else {
          // Only make interactive if no interactive descendants
          if (!this.hasInteractiveDescendants(node)) {
            shouldMakeInteractive = true;
          }
        }
      } else if (isInteractiveAssign && (isVisible || isFileInput || isShadowDomElement || isHiddenFormToggle)) {
        shouldMakeInteractive = true;
      }

      if (shouldMakeInteractive) {
        node.isInteractive = true;
        // Store with backend_node_id as key
        this.selectorMap[node.originalNode.backendNodeId] = node.originalNode;
        this.interactiveCounter++;

        // Mark new elements
        if (node.isCompoundComponent) {
          node.isNew = true;
        } else if (this.previousBackendIds) {
          if (!this.previousBackendIds.has(node.originalNode.backendNodeId)) {
            node.isNew = true;
          }
        }
      }
    }

    // Process children
    for (const child of node.children) {
      this.assignInteractiveIndicesAndMarkNewNodes(child);
    }
  }

  private hasVisibleAssociatedLabel(node: EnhancedDOMNode): boolean {
    // Pattern A: parent is a visible <label> (e.g. <label><input hidden> text</label>)
    if (
      node.parent &&
      node.parent.tagName.toLowerCase() === 'label' &&
      node.parent.visual.isVisible
    ) {
      return true;
    }

    // Read the element's id from the live DOM element when available, because
    // `node.attributes` only contains INCLUDE_ATTRIBUTES (which omits many HTML
    // attributes). `sourceElement` is set for all regular DOM nodes.
    const nodeId =
      (node.sourceElement as HTMLElement | undefined)?.id ||
      node.attributes['id'];

    const siblings = node.parent?.children ?? [];
    const selfIdx = siblings.indexOf(node);

    /** Read the `for` attribute of a label node from its live DOM element. */
    const getLabelFor = (sibling: EnhancedDOMNode): string =>
      (sibling.sourceElement as HTMLLabelElement | undefined)?.htmlFor ??
      sibling.attributes['for'] ??
      '';

    // Pattern B: immediate next sibling is a visible <label> (CSS `input + label` pattern).
    // Accept when the label's `for` matches our id, or when it has no `for` at all
    // (CSS-proximity: the label visually represents the preceding input via ::before/::after).
    // Reject when `for` points to a *different* element — that label belongs elsewhere.
    if (selfIdx !== -1 && selfIdx + 1 < siblings.length) {
      const next = siblings[selfIdx + 1];
      if (next.tagName.toLowerCase() === 'label' && next.visual.isVisible) {
        const forAttr = getLabelFor(next);
        if (!forAttr || forAttr === nodeId) {
          return true;
        }
      }
    }

    // Pattern D: immediate previous sibling is a visible <label> (CSS `label + input` pattern).
    if (selfIdx > 0) {
      const prev = siblings[selfIdx - 1];
      if (prev.tagName.toLowerCase() === 'label' && prev.visual.isVisible) {
        const forAttr = getLabelFor(prev);
        if (!forAttr || forAttr === nodeId) {
          return true;
        }
      }
    }

    // Pattern C: any sibling <label for="id"> is visible (any position, any distance)
    if (nodeId) {
      for (const sibling of siblings) {
        if (
          sibling !== node &&
          sibling.tagName.toLowerCase() === 'label' &&
          sibling.visual.isVisible &&
          getLabelFor(sibling) === nodeId
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private hasInteractiveDescendants(node: SimplifiedNode): boolean {
    for (const child of node.children) {
      if (this.isInteractiveCached(child.originalNode)) return true;
      if (this.hasInteractiveDescendants(child)) return true;
    }
    return false;
  }

  private isInsideShadowDom(node: SimplifiedNode): boolean {
    return this.isEnhancedNodeInsideShadowDom(node.originalNode);
  }

  private isEnhancedNodeInsideShadowDom(node: EnhancedDOMNode): boolean {
    let current = node.parent;
    while (current) {
      if (current.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE && current.shadowRootType) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  // ========================================================================
  // Serialization: serialize_tree
  // ========================================================================

  static serializeTree(
    node: SimplifiedNode | null,
    includeAttributes: string[] = DEFAULT_INCLUDE_ATTRIBUTES,
    depth: number = 0,
  ): string {
    if (!node) return '';

    // Skip excluded nodes, but process their children
    if (node.excludedByParent) {
      const formatted: string[] = [];
      for (const child of node.children) {
        const childText = DOMTreeSerializer.serializeTree(child, includeAttributes, depth);
        if (childText) formatted.push(childText);
      }
      return formatted.join('\n');
    }

    const formatted: string[] = [];
    const depthStr = '\t'.repeat(depth);
    let nextDepth = depth;

    if (node.originalNode.nodeType === NodeType.ELEMENT_NODE) {
      // Skip displaying nodes marked as shouldDisplay=false
      if (!node.shouldDisplay) {
        for (const child of node.children) {
          const childText = DOMTreeSerializer.serializeTree(child, includeAttributes, depth);
          if (childText) formatted.push(childText);
        }
        return formatted.join('\n');
      }

      const tag = node.originalNode.tagName.toLowerCase();

      // SVG: show tag but collapse children (decorative content)
      if (tag === 'svg') {
        // Build shadow prefix for SVG shadow hosts
        let shadowPrefix = '';
        if (node.isShadowHost) {
          const hasClosed = node.children.some(
            c =>
              c.originalNode.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE && c.originalNode.shadowRootType === 'closed',
          );
          shadowPrefix = hasClosed ? '|SHADOW(closed)|' : '|SHADOW(open)|';
        }
        let line = `${depthStr}${shadowPrefix}`;
        if (node.isInteractive) {
          const newPrefix = node.isNew ? '*' : '';
          line += `${newPrefix}[${node.originalNode.backendNodeId}]`;
        }
        line += '<svg';
        const attrs = DOMTreeSerializer.buildAttributesString(node.originalNode, includeAttributes, '');
        if (attrs) line += ` ${attrs}`;
        line += ' /> <!-- SVG content collapsed -->';
        formatted.push(line);
        return formatted.join('\n');
      }

      // Interactive, scrollable, iframe, or list container
      const isAnyScrollable =
        node.originalNode.visual.isScrollable || DOMTreeSerializer.isActuallyScrollableStatic(node.originalNode);
      const shouldShowScroll = DOMTreeSerializer.shouldShowScrollInfo(node.originalNode);
      const isIframe = tag === 'iframe' || tag === 'frame';

      if (node.isInteractive || isAnyScrollable || isIframe) {
        nextDepth += 1;

        // Build attributes string
        const textContent = '';
        let attributesStr = DOMTreeSerializer.buildAttributesString(node.originalNode, includeAttributes, textContent);

        // Add compound component info
        if (node.originalNode.compoundChildren.length > 0) {
          const compoundParts: string[] = [];
          for (const childInfo of node.originalNode.compoundChildren) {
            const parts: string[] = [];
            if (childInfo.name) parts.push(`name=${childInfo.name}`);
            if (childInfo.role) parts.push(`role=${childInfo.role}`);
            if (childInfo.valuemin != null) parts.push(`min=${childInfo.valuemin}`);
            if (childInfo.valuemax != null) parts.push(`max=${childInfo.valuemax}`);
            if (childInfo.valuenow != null) parts.push(`current=${childInfo.valuenow}`);
            if (childInfo.options_count != null) parts.push(`count=${childInfo.options_count}`);
            if (childInfo.first_options?.length) {
              parts.push(`options=${childInfo.first_options.slice(0, 4).join('|')}`);
            }
            if (childInfo.format_hint) parts.push(`format=${childInfo.format_hint}`);
            if (parts.length > 0) compoundParts.push(`(${parts.join(',')})`);
          }
          if (compoundParts.length > 0) {
            const compoundAttr = `compound_components=${compoundParts.join(',')}`;
            attributesStr = attributesStr ? `${attributesStr} ${compoundAttr}` : compoundAttr;
          }
        }

        // Build shadow prefix
        let shadowPrefix = '';
        if (node.isShadowHost) {
          const hasClosed = node.children.some(
            c =>
              c.originalNode.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE && c.originalNode.shadowRootType === 'closed',
          );
          shadowPrefix = hasClosed ? '|SHADOW(closed)|' : '|SHADOW(open)|';
        }

        let line: string;
        if (node.isInteractive) {
          // Interactive (and possibly scrollable)
          const newPrefix = node.isNew ? '*' : '';
          const scrollPrefix = shouldShowScroll ? '|scroll element[' : '[';
          line = `${depthStr}${shadowPrefix}${newPrefix}${scrollPrefix}${node.originalNode.backendNodeId}]<${tag}`;
        } else if (shouldShowScroll) {
          // Scrollable container but not clickable
          line = `${depthStr}${shadowPrefix}|scroll element|<${tag}`;
        } else if (tag === 'iframe') {
          // Non-interactive iframe
          line = `${depthStr}${shadowPrefix}|IFRAME|<${tag}`;
        } else if (tag === 'frame') {
          // Non-interactive frame
          line = `${depthStr}${shadowPrefix}|FRAME|<${tag}`;
        } else {
          line = `${depthStr}${shadowPrefix}<${tag}`;
        }

        if (attributesStr) line += ` ${attributesStr}`;
        line += ' />';

        // Add scroll info
        if (shouldShowScroll) {
          const scrollText = DOMTreeSerializer.getScrollInfoText(node.originalNode);
          if (scrollText) line += ` (${scrollText})`;
        }

        formatted.push(line);
      }
      // Non-interactive, non-scrollable, non-iframe elements that survived tree optimization
      // are not rendered (their children will be rendered at parent depth)
    } else if (node.originalNode.nodeType === NodeType.DOCUMENT_FRAGMENT_NODE) {
      // Shadow DOM representation: always emit Open Shadow, emit Shadow End iff
      // node.children is non-empty. Empty-shadow chains are filtered upstream
      // by `pruneNonProductiveSubtrees`.
      if (node.originalNode.shadowRootType === 'closed') {
        formatted.push(`${depthStr}Closed Shadow`);
      } else {
        formatted.push(`${depthStr}Open Shadow`);
      }
      nextDepth += 1;

      for (const child of node.children) {
        const childText = DOMTreeSerializer.serializeTree(child, includeAttributes, nextDepth);
        if (childText) formatted.push(childText);
      }

      if (node.children.length > 0) {
        formatted.push(`${depthStr}Shadow End`);
      }
    } else if (node.originalNode.nodeType === NodeType.TEXT_NODE) {
      const isVisible = node.originalNode.visual.isVisible;
      if (isVisible && node.originalNode.textContent && node.originalNode.textContent.trim().length > 1) {
        const cleanText = node.originalNode.textContent.trim();
        formatted.push(`${depthStr}${cleanText}`);
      }
    }

    // DOCUMENT_FRAGMENT_NODE already processes its children above (shadow DOM block)
    // Skip general child processing to avoid duplicate output
    if (node.originalNode.nodeType !== NodeType.DOCUMENT_FRAGMENT_NODE) {
      for (const child of node.children) {
        const childText = DOMTreeSerializer.serializeTree(child, includeAttributes, nextDepth);
        if (childText) formatted.push(childText);
      }
    }

    // Hidden content hint for iframes
    if (
      node.originalNode.nodeType === NodeType.ELEMENT_NODE &&
      (node.originalNode.tagName === 'iframe' || node.originalNode.tagName === 'frame')
    ) {
      if (node.originalNode.hiddenElementsInfo.length > 0) {
        const hidden = node.originalNode.hiddenElementsInfo;
        formatted.push(`${depthStr}... (${hidden.length} more elements below - scroll to reveal):`);
        for (const elem of hidden) {
          formatted.push(`${depthStr}    <${elem.tag}> "${elem.text}" ~${elem.pages} pages down`);
        }
      } else if (node.originalNode.hasHiddenContent) {
        formatted.push(`${depthStr}... (more content below viewport - scroll to reveal)`);
      }
    }

    return formatted.join('\n');
  }

  // ========================================================================
  // Attribute building
  // ========================================================================

  static buildAttributesString(node: EnhancedDOMNode, includeAttributes: string[], textContent: string): string {
    const attributesToInclude: Record<string, string> = {};

    // 1. Include HTML attributes
    for (const [key, value] of Object.entries(node.attributes)) {
      if (includeAttributes.includes(key) && String(value).trim() !== '') {
        attributesToInclude[key] = String(value).trim();
      }
    }

    // 2. Date/time format hints + datepicker detection
    //    - `format` is set unconditionally for HTML5 date/time inputs.
    //    - The placeholder (and datepicker detection nested inside it) is gated
    //      on placeholder being in include_attributes but not yet in attributesToInclude.
    if (node.tagName === 'input') {
      const inputType = (node.attributes.type || '').toLowerCase();
      const formatMap: Record<string, string> = {
        date: 'YYYY-MM-DD',
        time: 'HH:MM',
        'datetime-local': 'YYYY-MM-DDTHH:MM',
        month: 'YYYY-MM',
        week: 'YYYY-W##',
      };

      // Unconditional format attribute for HTML5 date/time inputs.
      if (formatMap[inputType]) {
        attributesToInclude['format'] = formatMap[inputType];
      }

      // Placeholder-gated block.
      if (includeAttributes.includes('placeholder') && !('placeholder' in attributesToInclude)) {
        if (inputType === 'date') {
          attributesToInclude['placeholder'] = 'YYYY-MM-DD';
        } else if (inputType === 'time') {
          attributesToInclude['placeholder'] = 'HH:MM';
        } else if (inputType === 'datetime-local') {
          attributesToInclude['placeholder'] = 'YYYY-MM-DDTHH:MM';
        } else if (inputType === 'month') {
          attributesToInclude['placeholder'] = 'YYYY-MM';
        } else if (inputType === 'week') {
          attributesToInclude['placeholder'] = 'YYYY-W##';
        } else if (inputType === 'tel' && !('pattern' in attributesToInclude)) {
          attributesToInclude['placeholder'] = '123-456-7890';
        } else if (inputType === 'text' || inputType === '') {
          const classAttr = (node.attributes.class || '').toLowerCase();

          // AngularJS UI Bootstrap datepicker (most specific).
          if ('uib-datepicker-popup' in node.attributes) {
            const dateFormat = node.attributes['uib-datepicker-popup'] || '';
            if (dateFormat) {
              attributesToInclude['expected_format'] = dateFormat;
              attributesToInclude['format'] = dateFormat;
            }
          } else if (['datepicker', 'datetimepicker', 'daterangepicker'].some(ind => classAttr.includes(ind))) {
            const dateFormat = node.attributes['data-date-format'] || '';
            if (dateFormat) {
              attributesToInclude['placeholder'] = dateFormat;
              attributesToInclude['format'] = dateFormat;
            } else {
              attributesToInclude['placeholder'] = 'mm/dd/yyyy';
              attributesToInclude['format'] = 'mm/dd/yyyy';
            }
          } else if ('data-datepicker' in node.attributes) {
            const dateFormat = node.attributes['data-date-format'] || '';
            if (dateFormat) {
              attributesToInclude['placeholder'] = dateFormat;
              attributesToInclude['format'] = dateFormat;
            } else {
              attributesToInclude['placeholder'] = 'mm/dd/yyyy';
              attributesToInclude['format'] = 'mm/dd/yyyy';
            }
          }
        }
      }
    }

    // 3. Password field protection
    const isPasswordField = node.tagName === 'input' && (node.attributes.type || '').toLowerCase() === 'password';

    // 4. Include accessibility properties
    const valueProperties = new Set(['value', 'valuetext']);
    if (node.axNode?.properties) {
      for (const prop of node.axNode.properties) {
        if (includeAttributes.includes(prop.name) && prop.value != null) {
          if (isPasswordField && valueProperties.has(prop.name)) continue;
          if (typeof prop.value === 'boolean') {
            attributesToInclude[prop.name] = String(prop.value).toLowerCase();
          } else {
            const strVal = String(prop.value).trim();
            if (strVal) attributesToInclude[prop.name] = strVal;
          }
        }
      }
    }

    // 5. Form element value handling
    if (['input', 'textarea', 'select'].includes(node.tagName)) {
      if (isPasswordField) {
        delete attributesToInclude['value'];
      } else if (node.axNode?.properties) {
        // First pass: prefer valuetext (human-readable display value)
        let found = false;
        for (const prop of node.axNode.properties) {
          if (prop.name === 'valuetext' && prop.value) {
            const val = String(prop.value).trim();
            if (val) {
              attributesToInclude['value'] = val;
              found = true;
              break;
            }
          }
        }
        // Second pass: fall back to value
        if (!found) {
          for (const prop of node.axNode.properties) {
            if (prop.name === 'value' && prop.value) {
              const val = String(prop.value).trim();
              if (val) {
                attributesToInclude['value'] = val;
                break;
              }
            }
          }
        }
      }
    }

    if (Object.keys(attributesToInclude).length === 0) return '';

    // Duplicate removal
    const orderedKeys = includeAttributes.filter(k => k in attributesToInclude);
    if (orderedKeys.length > 1) {
      const protectedAttrs = new Set(['format', 'expected_format', 'placeholder', 'value', 'aria-label', 'title']);
      const seenValues = new Map<string, string>();
      const keysToRemove = new Set<string>();
      for (const key of orderedKeys) {
        const val = attributesToInclude[key];
        if (val.length > 5) {
          if (seenValues.has(val) && !protectedAttrs.has(key)) {
            keysToRemove.add(key);
          } else {
            seenValues.set(val, key);
          }
        }
      }
      keysToRemove.forEach(k => delete attributesToInclude[k]);
    }

    // Remove role if AX role matches the node's tag name (compared case-insensitively
    // by uppercasing the stored lowercase tagName).
    const axRole = node.axNode?.role;
    if (axRole && node.tagName.toUpperCase() === axRole) {
      delete attributesToInclude['role'];
    }

    // Remove type if value matches the tag name (redundant info).
    if (attributesToInclude['type'] && attributesToInclude['type'].toLowerCase() === node.tagName.toLowerCase()) {
      delete attributesToInclude['type'];
    }

    // Remove invalid=false
    if (attributesToInclude['invalid']?.toLowerCase() === 'false') delete attributesToInclude['invalid'];

    // Remove required=false
    if (
      attributesToInclude['required']?.toLowerCase() === 'false' ||
      attributesToInclude['required'] === '0' ||
      attributesToInclude['required'] === 'no'
    ) {
      delete attributesToInclude['required'];
    }

    // Prefer expanded over aria-expanded
    if ('expanded' in attributesToInclude && 'aria-expanded' in attributesToInclude) {
      delete attributesToInclude['aria-expanded'];
    }

    // Remove attrs matching text content
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      if (
        attributesToInclude[attr] &&
        textContent &&
        attributesToInclude[attr].trim().toLowerCase() === textContent.trim().toLowerCase()
      ) {
        delete attributesToInclude[attr];
      }
    }

    // Format
    const parts: string[] = [];
    for (const [key, value] of Object.entries(attributesToInclude)) {
      const capped = capTextLength(value, 100);
      parts.push(capped ? `${key}=${capped}` : `${key}=''`);
    }
    return parts.join(' ');
  }

  // ========================================================================
  // Scroll helpers
  // ========================================================================

  /**
   * Enhanced scroll detection combining CSS + actual overflow.
   */
  static isActuallyScrollableStatic(node: EnhancedDOMNode): boolean {
    if (node.visual.isScrollable) return true;
    const el = node.sourceElement as HTMLElement | undefined;
    if (!el) return false;
    const hasVerticalScroll = el.scrollHeight > el.clientHeight + 1;
    const hasHorizontalScroll = el.scrollWidth > el.clientWidth + 1;
    if (hasVerticalScroll || hasHorizontalScroll) {
      // getComputedStyle() always returns a non-null object in a content script,
      // so computedStyles is always populated here. Only CSS-explicit
      // overflow: auto|scroll|overlay counts.
      const cs = node.visual.computedStyles;
      if (!cs) return false;
      const overflow = cs.overflow.toLowerCase();
      const ox = cs.overflowX.toLowerCase();
      const oy = cs.overflowY.toLowerCase();
      return (
        ['auto', 'scroll', 'overlay'].includes(overflow) ||
        ['auto', 'scroll', 'overlay'].includes(ox) ||
        ['auto', 'scroll', 'overlay'].includes(oy)
      );
    }
    return false;
  }

  /**
   * Show scroll info only if scrollable and parent is not also scrollable.
   */
  static shouldShowScrollInfo(node: EnhancedDOMNode): boolean {
    const tag = node.tagName.toLowerCase();

    // Always show for iframes
    if (tag === 'iframe') return true;

    // Must be scrollable
    if (!node.visual.isScrollable && !DOMTreeSerializer.isActuallyScrollableStatic(node)) return false;

    // Always show for body/html (iframe content docs)
    if (tag === 'body' || tag === 'html') return true;

    return true;
  }

  /**
   * Build scroll position text for display in the serialized tree.
   */
  static getScrollInfoText(node: EnhancedDOMNode): string {
    // Iframe special case: scroll metrics come from the content document's
    // documentElement, not the iframe element itself.
    if (node.tagName.toLowerCase() === 'iframe') {
      const iframeEl = node.sourceElement as HTMLIFrameElement | undefined;
      let html: HTMLElement | undefined;
      try {
        html = iframeEl?.contentDocument?.documentElement ?? undefined;
      } catch {
        html = undefined;
      }
      if (html && html.scrollHeight > html.clientHeight) {
        const contentAbove = Math.max(0, html.scrollTop);
        const contentBelow = Math.max(0, html.scrollHeight - html.clientHeight - html.scrollTop);
        const pagesAbove = html.clientHeight > 0 ? contentAbove / html.clientHeight : 0;
        const pagesBelow = html.clientHeight > 0 ? contentBelow / html.clientHeight : 0;
        const maxScroll = html.scrollHeight - html.clientHeight;
        // Math.trunc truncates toward zero (matches scroll percentage behavior).
        const vPct = maxScroll > 0 ? Math.trunc((html.scrollTop / maxScroll) * 100) : 0;
        if (pagesAbove > 0 || pagesBelow > 0) {
          return `scroll: ${pagesAbove.toFixed(1)}↑ ${pagesBelow.toFixed(1)}↓ ${vPct}%`;
        }
      }
      return 'scroll';
    }

    const el = node.sourceElement as HTMLElement | undefined;
    if (!el) return '';

    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollLeft = el.scrollLeft;
    const scrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;

    if (scrollHeight <= clientHeight && scrollWidth <= clientWidth) return '';

    const parts: string[] = [];

    // Vertical
    if (scrollHeight > clientHeight) {
      const contentAbove = Math.max(0, scrollTop);
      const contentBelow = Math.max(0, scrollHeight - clientHeight - scrollTop);
      const pagesAbove = clientHeight > 0 ? contentAbove / clientHeight : 0;
      const pagesBelow = clientHeight > 0 ? contentBelow / clientHeight : 0;
      parts.push(`${pagesAbove.toFixed(1)} pages above, ${pagesBelow.toFixed(1)} pages below`);
    }

    // Horizontal
    if (scrollWidth > clientWidth) {
      const maxScrollLeft = scrollWidth - clientWidth;
      const hPct = maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * 100 : 0;
      parts.push(`horizontal ${hPct.toFixed(0)}%`);
    }

    return parts.join(' ');
  }

  // ========================================================================
  // Compound components
  // ========================================================================

  private addCompoundComponents(simplified: SimplifiedNode, node: EnhancedDOMNode): void {
    const tag = node.tagName.toLowerCase();
    if (!['input', 'select', 'details', 'audio', 'video'].includes(tag)) return;

    const attrs = node.attributes;

    if (tag === 'input') {
      const inputType = (attrs.type || '').toLowerCase();
      if (
        !['date', 'time', 'datetime-local', 'month', 'week', 'range', 'number', 'color', 'file'].includes(inputType)
      ) {
        return;
      }

      // Date/time: skip compound components (format shown in placeholder)
      if (['date', 'time', 'datetime-local', 'month', 'week'].includes(inputType)) {
        return;
      }

      if (inputType === 'range') {
        node.compoundChildren.push({
          role: 'slider',
          name: 'Value',
          valuemin: parseFloat(attrs.min || '0') || 0,
          valuemax: parseFloat(attrs.max || '100') || 100,
          valuenow: null,
        });
        simplified.isCompoundComponent = true;
      } else if (inputType === 'number') {
        node.compoundChildren.push(
          { role: 'button', name: 'Increment' },
          { role: 'button', name: 'Decrement' },
          {
            role: 'textbox',
            name: 'Value',
            valuemin: attrs.min ? parseFloat(attrs.min) : null,
            valuemax: attrs.max ? parseFloat(attrs.max) : null,
          },
        );
        simplified.isCompoundComponent = true;
      } else if (inputType === 'color') {
        node.compoundChildren.push({ role: 'textbox', name: 'Hex Value' }, { role: 'button', name: 'Color Picker' });
        simplified.isCompoundComponent = true;
      } else if (inputType === 'file') {
        const multiple = 'multiple' in attrs;
        let currentValue = 'None';

        // Try to get current file from the actual element
        const el = node.sourceElement as HTMLInputElement | undefined;
        if (el?.files && el.files.length > 0) {
          currentValue = Array.from(el.files)
            .map(f => f.name)
            .join(', ');
        }

        node.compoundChildren.push(
          { role: 'button', name: 'Browse Files' },
          {
            role: 'textbox',
            name: multiple ? 'Files Selected' : 'File Selected',
            valuenow: currentValue,
          },
        );
        simplified.isCompoundComponent = true;
      }
    } else if (tag === 'select') {
      const baseComponents = [{ role: 'button', name: 'Dropdown Toggle' } as any];

      // Extract option information
      const optionsInfo = this.extractSelectOptions(node);
      if (optionsInfo) {
        const optComp: any = {
          role: 'listbox',
          name: 'Options',
          options_count: optionsInfo.count,
          first_options: optionsInfo.firstOptions,
        };
        if (optionsInfo.formatHint) optComp.format_hint = optionsInfo.formatHint;
        baseComponents.push(optComp);
      } else {
        baseComponents.push({ role: 'listbox', name: 'Options' });
      }

      node.compoundChildren.push(...baseComponents);
      simplified.isCompoundComponent = true;
    } else if (tag === 'details') {
      node.compoundChildren.push(
        { role: 'button', name: 'Toggle Disclosure' },
        { role: 'region', name: 'Content Area' },
      );
      simplified.isCompoundComponent = true;
    } else if (tag === 'audio') {
      node.compoundChildren.push(
        { role: 'button', name: 'Play/Pause' },
        { role: 'slider', name: 'Progress', valuemin: 0, valuemax: 100 },
        { role: 'button', name: 'Mute' },
        { role: 'slider', name: 'Volume', valuemin: 0, valuemax: 100 },
      );
      simplified.isCompoundComponent = true;
    } else if (tag === 'video') {
      node.compoundChildren.push(
        { role: 'button', name: 'Play/Pause' },
        { role: 'slider', name: 'Progress', valuemin: 0, valuemax: 100 },
        { role: 'button', name: 'Mute' },
        { role: 'slider', name: 'Volume', valuemin: 0, valuemax: 100 },
        { role: 'button', name: 'Fullscreen' },
      );
      simplified.isCompoundComponent = true;
    }
  }

  private extractSelectOptions(
    selectNode: EnhancedDOMNode,
  ): { count: number; firstOptions: string[]; formatHint: string | null } | null {
    if (selectNode.children.length === 0) return null;

    const options: Array<{ text: string; value: string }> = [];
    const optionValues: string[] = [];

    const extractRecursive = (node: EnhancedDOMNode): void => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'option') {
        const value = (node.attributes.value || '').trim();
        // Get text from children text nodes
        let text = '';
        for (const child of node.children) {
          if (child.nodeType === NodeType.TEXT_NODE && child.textContent) {
            text += child.textContent.trim() + ' ';
          }
        }
        text = text.trim();
        const effectiveValue = value || text;
        if (text || effectiveValue) {
          options.push({ text, value: effectiveValue });
          optionValues.push(effectiveValue);
        }
      } else {
        for (const child of node.children) {
          extractRecursive(child);
        }
      }
    };

    for (const child of selectNode.children) {
      extractRecursive(child);
    }

    if (options.length === 0) return null;

    const firstOptions: string[] = [];
    for (const opt of options.slice(0, 4)) {
      const display = opt.text || opt.value;
      if (display) {
        firstOptions.push(display.length > 30 ? display.substring(0, 30) + '...' : display);
      }
    }
    if (options.length > 4) {
      firstOptions.push(`... ${options.length - 4} more options...`);
    }

    // Format hint
    let formatHint: string | null = null;
    const sampleValues = optionValues.slice(0, 5).filter(Boolean);
    if (sampleValues.length >= 2) {
      if (sampleValues.every(v => /^\d+$/.test(v))) formatHint = 'numeric';
      else if (sampleValues.every(v => v.length === 2 && v === v.toUpperCase() && /[A-Z]/.test(v)))
        formatHint = 'country/state codes';
      else if (sampleValues.every(v => v.includes('/') || v.includes('-'))) formatHint = 'date/path format';
      else if (sampleValues.some(v => v.includes('@'))) formatHint = 'email addresses';
    }

    return { count: options.length, firstOptions, formatHint };
  }

  // ========================================================================
  // Public convenience: get LLM representation
  // ========================================================================

  /**
   * Get the text representation ready for LLM consumption.
   */
  static llmRepresentation(state: SerializedDOMState, includeAttributes?: string[]): string {
    if (!state.root) return 'Empty DOM tree (you might have to wait for the page to load)';
    return DOMTreeSerializer.serializeTree(state.root, includeAttributes || DEFAULT_INCLUDE_ATTRIBUTES);
  }
}

// ============================================================================
// Utility
// ============================================================================

function capTextLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}
