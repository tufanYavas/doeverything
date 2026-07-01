import { NodeType, createEmptyEnhancedNode } from '../types/index.js';
import { isElementTrulyVisible } from '../utils/visibility.js';
import type {
  AccessibilityNode,
  AccessibilityProperty,
  ComputedStylesSubset,
  DOMRectData,
  EnhancedDOMNode,
  VisualInfo,
} from '../types/index.js';

/**
 * Attributes to include for LLM consumption
 */
const INCLUDE_ATTRIBUTES = new Set([
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
  'data-mask',
  'data-inputmask',
  'data-datepicker',
  'format',
  'expected_format',
  'contenteditable',
  'pseudo',
  'selected',
  'pressed',
  'disabled',
  'invalid',
  'keyshortcuts',
  'haspopup',
  'multiselectable',
  'required',
  'valuetext',
  'level',
  'busy',
  'live',
  'label',
  'aria-required',
  'aria-disabled',
  'aria-autocomplete',
  'aria-haspopup',
  // tabindex: makes any element keyboard-focusable → interactable.
  'tabindex',
]);

/**
 * Tags that are inherently interactive
 */
const INTERACTIVE_TAGS = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'details',
  'summary',
  'option',
  'optgroup',
]);

/**
 * Interactive ARIA roles
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'option',
  'radio',
  'checkbox',
  'tab',
  'textbox',
  'combobox',
  'slider',
  'spinbutton',
  'search',
  'searchbox',
  'row',
  'cell',
  'gridcell',
]);

/**
 * Interactive accessibility roles from AX tree
 */
const INTERACTIVE_AX_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'option',
  'radio',
  'checkbox',
  'tab',
  'textbox',
  'combobox',
  'slider',
  'spinbutton',
  'listbox',
  'search',
  'searchbox',
  'row',
  'cell',
  'gridcell',
]);

/**
 * Search-related indicators for clickable detection
 */
const SEARCH_INDICATORS = new Set([
  'search',
  'magnify',
  'glass',
  'lookup',
  'find',
  'query',
  'search-icon',
  'search-btn',
  'search-button',
  'searchbox',
]);

/**
 * Stable element ID system — fingerprint-based, survives SPA re-renders.
 *
 * Fingerprint = parent_branch_path (full tag path from root) + sorted STATIC_ATTRIBUTES + ax_name
 *
 * Key design decisions:
 *  - NO nth-of-type index — shifts when siblings are added/removed, causing cascade instability
 *  - Full parent path provides structural context without sibling-order dependency
 *  - ax_name (accessible name / visible text) disambiguates identical siblings (e.g., <li> items)
 *  - Dynamic CSS classes filtered out for stability across hover/focus/animation states
 *
 * Collision handling:
 *  - fingerprintEntries stores WeakRef<Element> per fingerprint
 *  - When a fingerprint matches but the old element is GC'd → reuse that ID (SPA re-render)
 *  - When a fingerprint matches and old element is alive → collision, assign new ID
 */
const elementRefCache = new WeakMap<Element, number>();
const fingerprintEntries = new Map<string, { id: number; ref: WeakRef<Element> }[]>();
let globalBackendNodeIdCounter = 1;

/** Attributes that are stable across re-renders */
const STATIC_ATTRIBUTES = new Set([
  'class',
  'id',
  'name',
  'type',
  'placeholder',
  'aria-label',
  'title',
  'role',
  'data-testid',
  'data-test',
  'data-cy',
  'data-selenium',
  'for',
  'required',
  'disabled',
  'readonly',
  'checked',
  'selected',
  'multiple',
  'accept',
  'href',
  'target',
  'rel',
  'aria-describedby',
  'aria-labelledby',
  'aria-controls',
  'aria-owns',
  'aria-live',
  'aria-atomic',
  'aria-busy',
  'aria-disabled',
  'aria-hidden',
  'aria-pressed',
  'aria-autocomplete',
  'aria-checked',
  'aria-selected',
  'list',
  'tabindex',
  'alt',
  'src',
  'lang',
  'itemscope',
  'itemtype',
  'itemprop',
  'pseudo',
  'aria-valuemin',
  'aria-valuemax',
  'aria-valuenow',
  'aria-placeholder',
]);

/** Class patterns indicating dynamic/transient UI state — excluded from fingerprint */
const DYNAMIC_CLASS_PATTERNS = new Set([
  'focus',
  'hover',
  'active',
  'selected',
  'disabled',
  'animation',
  'transition',
  'loading',
  'open',
  'closed',
  'expanded',
  'collapsed',
  'visible',
  'hidden',
  'pressed',
  'checked',
  'highlighted',
  'current',
  'entering',
  'leaving',
]);

/**
 * Filter dynamic state classes, keep semantic/identifying ones.
 * Returns sorted classes for deterministic hashing.
 */
function filterDynamicClasses(classStr: string): string {
  const classes = classStr.split(/\s+/).filter(Boolean);
  const stable = classes.filter(
    c => !Array.from(DYNAMIC_CLASS_PATTERNS).some(pattern => c.toLowerCase().includes(pattern)),
  );
  return stable.sort().join(' ');
}

/**
 * Get the parent branch path — full tag name path from root to element.
 * e.g., ['HTML', 'BODY', 'DIV', 'UL', 'LI']
 */
function getParentBranchPath(element: Element): string[] {
  const path: string[] = [];
  let current: Element | null = element;
  while (current) {
    path.push(current.tagName);
    // Cross shadow boundaries: parentElement is null at shadow root,
    // so fall back to getRootNode().host
    const p: Element | null = current.parentElement;
    if (p) {
      current = p;
    } else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
  }
  path.reverse();
  return path;
}

/**
 * Get accessible name for an element.
 * In browser context we don't have CDP AX tree, so we approximate:
 *  1. aria-label attribute
 *  2. aria-labelledby resolved text
 *  3. Direct own text content (not deeply nested — first text node only)
 *  4. title attribute
 *  5. alt attribute (for images)
 *  6. placeholder (for inputs)
 */
function getAccessibleName(element: Element): string {
  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts: string[] = [];
    for (const id of labelledBy.split(/\s+/)) {
      const ref = document.getElementById(id);
      if (ref) parts.push(ref.textContent?.trim() || '');
    }
    const resolved = parts.join(' ').trim();
    if (resolved) return resolved;
  }

  // Own direct text content (first-level text nodes only, not deep children text)
  let ownText = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      ownText += child.textContent || '';
    }
  }
  ownText = ownText.trim();
  if (ownText) return ownText.slice(0, 80); // truncate for fingerprint stability

  // Fallbacks
  const title = element.getAttribute('title');
  if (title) return title.trim();

  const alt = element.getAttribute('alt');
  if (alt) return alt.trim();

  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();

  return '';
}

/**
 * Compute a structural fingerprint for a DOM element.
 *   parent_branch_path | sorted STATIC_ATTRIBUTES | ax_name
 */
function computeFingerprint(element: Element): string {
  // 1. Full parent branch path
  const branchPath = getParentBranchPath(element).join('/');

  // 2. Sorted STATIC_ATTRIBUTES (with dynamic class filtering)
  const attrParts: string[] = [];
  for (const attr of Array.from(element.attributes)) {
    if (!STATIC_ATTRIBUTES.has(attr.name)) continue;
    let val = attr.value;
    if (attr.name === 'class') {
      val = filterDynamicClasses(val);
      if (!val) continue; // skip empty class after filtering
    }
    attrParts.push(`${attr.name}=${val}`);
  }
  attrParts.sort();
  const attributesString = attrParts.join('');

  // 3. Accessible name (disambiguates identical siblings)
  const axName = getAccessibleName(element);
  const axNamePart = axName ? `|ax_name=${axName}` : '';

  return `${branchPath}|${attributesString}${axNamePart}`;
}

/**
 * Get or assign a stable backend node ID for an element.
 *
 * - Fast path: element is still alive in WeakMap → return cached ID
 * - Slow path: compute fingerprint, then:
 *   - If fingerprint exists and WeakRef is dead → reuse ID (SPA re-render of same element)
 *   - If fingerprint exists but all refs alive → collision, assign new ID
 *   - If fingerprint new → assign new ID
 */
function getStableBackendNodeId(element: Element): number {
  // Fast path: same DOM element reference
  const cached = elementRefCache.get(element);
  if (cached !== undefined) return cached;

  // Slow path: fingerprint lookup
  const fp = computeFingerprint(element);
  const entries = fingerprintEntries.get(fp);

  if (entries) {
    // Check if any entry's element was GC'd (re-render case) → reuse its ID
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const oldElement = entry.ref.deref();
      if (!oldElement || !oldElement.isConnected) {
        // Element was GC'd or disconnected — this is a re-render, reuse the ID
        entry.ref = new WeakRef(element);
        elementRefCache.set(element, entry.id);
        return entry.id;
      }
      // If it's the exact same element (shouldn't happen since WeakMap would have caught it)
      if (oldElement === element) {
        elementRefCache.set(element, entry.id);
        return entry.id;
      }
    }
    // All entries alive and different elements → collision, assign new ID
    const id = globalBackendNodeIdCounter++;
    entries.push({ id, ref: new WeakRef(element) });
    elementRefCache.set(element, id);
    return id;
  }

  // New fingerprint
  const id = globalBackendNodeIdCounter++;
  fingerprintEntries.set(fp, [{ id, ref: new WeakRef(element) }]);
  elementRefCache.set(element, id);
  return id;
}

/**
 * DomService - Scans DOM and builds enhanced DOM tree
 *
 * This service traverses the document body and creates an EnhancedDOMNode tree
 * containing DOM, accessibility, and visual information for each element.
 */
export class DomService {
  private nodeIdCounter: number = 0;
  /**
   * Pixel threshold beyond viewport to still consider elements "visible".
   * Default 1000. Set to null to disable viewport filtering entirely.
   */
  private viewportExpansion: number | null = 1000;

  /**
   * Scan document and build enhanced DOM tree.
   * If root is provided, scopes to that element; otherwise scans document.body.
   *
   * @param root - Root element to scan (defaults to document.body)
   * @param viewportExpansion - Pixels beyond viewport to consider visible.
   *   Default 1000. Set to null to disable viewport filtering.
   */
  scanDocument(root?: HTMLElement, viewportExpansion?: number | null): EnhancedDOMNode {
    this.nodeIdCounter = 0;
    this.viewportExpansion = viewportExpansion === undefined ? 1000 : viewportExpansion;
    const rootEl = root || document.body;
    const tree = this.buildEnhancedNode(rootEl, null);

    // Post-processing pass: populate hidden_elements_info / has_hidden_content for iframes.
    this.countHiddenElementsInIframes(tree);

    return tree;
  }

  /**
   * For every ELEMENT_NODE that is an iframe/frame AND has an accessible
   * `content_document`, walk the content document and:
   *   1. Collect `{tag, text, pages}` entries for interactive descendants
   *      that are "hidden by threshold" (not currently visible, but not
   *      CSS-hidden either). Sort by pages, cap to 10, store on the iframe
   *      as `hiddenElementsInfo`.
   *   2. If no interactive hidden elements were found but the subtree
   *      contains any hidden-by-threshold node (interactive or not),
   *      set `hasHiddenContent = true` on the iframe.
   *
   * Cross-origin iframes have no `content_document` (security restriction),
   * so they are skipped.
   */
  private countHiddenElementsInIframes(node: EnhancedDOMNode): void {
    // An element is "hidden by threshold" if it's not currently visible but
    // also not CSS-hidden — meaning it exists in the layout but is outside
    // the viewport. These are elements the agent can reach by scrolling.
    const isHiddenByThreshold = (element: EnhancedDOMNode): boolean => {
      if (element.visual.isVisible) return false;
      if (!element.visual.bounds) return false;

      const cs = element.visual.computedStyles;
      const display = (cs?.display ?? '').toLowerCase();
      const visibility = (cs?.visibility ?? '').toLowerCase();
      const opacity = cs?.opacity ?? '1';

      let cssHidden = display === 'none' || visibility === 'hidden';
      const opacityNum = parseFloat(opacity);
      if (!Number.isNaN(opacityNum) && opacityNum <= 0) {
        cssHidden = true;
      }

      return !cssHidden;
    };

    const collectHiddenElements = (
      subtreeRoot: EnhancedDOMNode,
      viewportHeight: number,
    ): Array<{ tag: string; text: string; pages: number }> => {
      const hidden: Array<{ tag: string; text: string; pages: number }> = [];

      if (subtreeRoot.nodeType === NodeType.ELEMENT_NODE) {
        const isInteractive = this.isInteractive(subtreeRoot);

        if (isInteractive && isHiddenByThreshold(subtreeRoot)) {
          // Get element text/name
          let text = '';
          if (subtreeRoot.axNode && subtreeRoot.axNode.name) {
            text = subtreeRoot.axNode.name.slice(0, 40);
          } else if (subtreeRoot.attributes) {
            text = (
              subtreeRoot.attributes.placeholder ||
              subtreeRoot.attributes.title ||
              subtreeRoot.attributes['aria-label'] ||
              ''
            ).slice(0, 40);
          }

          // Get y position and convert to pages
          let yPos = 0;
          if (subtreeRoot.visual.bounds) {
            yPos = subtreeRoot.visual.bounds.y;
          }
          const pagesDown = viewportHeight > 0 ? Math.round((yPos / viewportHeight) * 10) / 10 : 0;

          hidden.push({
            tag: subtreeRoot.tagName || '?',
            text: text || '(no label)',
            pages: pagesDown,
          });
        }
      }

      for (const child of subtreeRoot.children) {
        hidden.push(...collectHiddenElements(child, viewportHeight));
      }
      for (const shadowRoot of subtreeRoot.shadowRoots) {
        hidden.push(...collectHiddenElements(shadowRoot, viewportHeight));
      }

      return hidden;
    };

    const hasAnyHiddenContent = (subtreeRoot: EnhancedDOMNode): boolean => {
      if (isHiddenByThreshold(subtreeRoot)) return true;
      for (const child of subtreeRoot.children) {
        if (hasAnyHiddenContent(child)) return true;
      }
      for (const shadowRoot of subtreeRoot.shadowRoots) {
        if (hasAnyHiddenContent(shadowRoot)) return true;
      }
      return false;
    };

    const processNode = (currentNode: EnhancedDOMNode): void => {
      if (
        currentNode.nodeType === NodeType.ELEMENT_NODE &&
        currentNode.tagName &&
        (currentNode.tagName === 'iframe' || currentNode.tagName === 'frame') &&
        currentNode.contentDocument
      ) {
        // Get viewport height from the live iframe element's clientHeight
        let viewportHeight = 0;
        const el = currentNode.sourceElement as HTMLElement | undefined;
        if (el && typeof el.clientHeight === 'number') {
          viewportHeight = el.clientHeight;
        }

        const hidden = collectHiddenElements(currentNode.contentDocument, viewportHeight);
        // Sort by pages and limit to avoid bloating context
        hidden.sort((a, b) => a.pages - b.pages);
        currentNode.hiddenElementsInfo = hidden.slice(0, 10);

        // Check for hidden non-interactive content when no interactive elements found
        if (hidden.length === 0 && hasAnyHiddenContent(currentNode.contentDocument)) {
          currentNode.hasHiddenContent = true;
        }
      }

      for (const child of currentNode.children) {
        processNode(child);
      }
      if (currentNode.contentDocument) {
        processNode(currentNode.contentDocument);
      }
      for (const shadowRoot of currentNode.shadowRoots) {
        processNode(shadowRoot);
      }
    };

    processNode(node);
  }

  /**
   * Build enhanced node from HTML element
   */
  private buildEnhancedNode(element: Element, parent: EnhancedDOMNode | null): EnhancedDOMNode {
    const nodeId = this.nodeIdCounter++;
    const node = createEmptyEnhancedNode(nodeId);

    // Assign stable backendNodeId (survives SPA re-renders)
    node.backendNodeId = getStableBackendNodeId(element);

    // Basic node info
    node.nodeType = NodeType.ELEMENT_NODE;
    node.tagName = element.tagName.toLowerCase();
    node.parent = parent;

    // Extract attributes
    node.attributes = this.extractAttributes(element);

    // Extract accessibility info
    node.axNode = this.extractAccessibilityInfo(element);

    // Extract visual info
    node.visual = this.extractVisualInfo(element);

    // Generate selectors
    node.xpath = this.generateXPath(element);
    node.selector = this.generateSelector(element);
    node.sourceElement = element;

    // Process children
    this.processChildren(element, node);

    // Process shadow DOM
    this.processShadowRoot(element, node);

    return node;
  }

  /**
   * Extract relevant HTML attributes
   */
  private extractAttributes(element: Element): Record<string, string> {
    const attrs: Record<string, string> = {};

    for (const attr of Array.from(element.attributes)) {
      // Include all aria-* and data-* attributes, plus whitelisted ones
      if (INCLUDE_ATTRIBUTES.has(attr.name) || attr.name.startsWith('aria-') || attr.name.startsWith('data-')) {
        attrs[attr.name] = attr.value;
      }
    }

    return attrs;
  }

  /**
   * Extract accessibility information from element
   */
  private extractAccessibilityInfo(element: Element): AccessibilityNode | null {
    const htmlEl = element as HTMLElement;

    // Prefer AOM (browser's real accessibility engine) over manual guesswork.
    // computedRole/computedName are supported in Chrome 90+, Edge 90+, Firefox 119+.
    const role =
      ('computedRole' in htmlEl ? (htmlEl as any).computedRole : null) ||
      element.getAttribute('role') ||
      this.getImplicitRole(element);

    const properties: AccessibilityProperty[] = [];

    // Extract accessibility name — AOM first, then manual fallback
    const name: string | null =
      ('computedName' in htmlEl ? (htmlEl as any).computedName : null) || this.getAccessibleName(element);

    // Extract description
    const description = this.getAccessibleDescription(element);

    // Extract ARIA properties
    const ariaProps = [
      'aria-checked',
      'aria-selected',
      'aria-expanded',
      'aria-pressed',
      'aria-disabled',
      'aria-invalid',
      'aria-required',
      'aria-readonly',
      'aria-hidden',
      'aria-valuemin',
      'aria-valuemax',
      'aria-valuenow',
      'aria-valuetext',
      'aria-busy',
      'aria-live',
      'aria-haspopup',
      'aria-multiselectable',
    ];

    for (const prop of ariaProps) {
      const value = element.getAttribute(prop);
      if (value !== null) {
        const propName = prop.replace('aria-', '');
        // Convert boolean strings
        if (value === 'true' || value === 'false') {
          properties.push({ name: propName, value: value === 'true' });
        } else {
          properties.push({ name: propName, value });
        }
      }
    }

    // Add native properties for form elements
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      if (element.required) properties.push({ name: 'required', value: true });
      if (element.disabled) properties.push({ name: 'disabled', value: true });
      if ('readOnly' in element && element.readOnly) properties.push({ name: 'readonly', value: true });
      if (('checked' in element && element.type === 'checkbox') || element.type === 'radio') {
        properties.push({ name: 'checked', value: (element as HTMLInputElement).checked });
      }
      if (element instanceof HTMLSelectElement || element instanceof HTMLInputElement) {
        if ('validity' in element && !element.validity.valid) {
          properties.push({ name: 'invalid', value: true });
        }
      }

      // Current field value — the CDP accessibility tree exposes a `value`
      // property for form fields (via Accessibility.getFullAXTree); without it
      // the serializer emits identical lines for empty and filled inputs,
      // which causes the agent to re-type the same field forever.
      // Password fields: the serializer drops `value` downstream.
      if (element instanceof HTMLInputElement) {
        const t = element.type;
        const textLike =
          t === '' ||
          t === 'text' ||
          t === 'email' ||
          t === 'search' ||
          t === 'tel' ||
          t === 'url' ||
          t === 'password' ||
          t === 'number' ||
          t === 'date' ||
          t === 'time' ||
          t === 'datetime-local' ||
          t === 'month' ||
          t === 'week' ||
          t === 'color' ||
          t === 'range';
        if (textLike && element.value) {
          properties.push({ name: 'value', value: element.value });
        } else if (t === 'file' && element.files && element.files.length > 0) {
          // `.value` on file inputs is a bogus "C:\fakepath\xxx" string —
          // expose the actual selected file names so the agent can see
          // that a file has been chosen and stop re-uploading.
          const names = Array.from(element.files)
            .map(f => f.name)
            .join(', ');
          properties.push({ name: 'valuetext', value: names });
        }
      } else if (element instanceof HTMLTextAreaElement) {
        if (element.value) {
          properties.push({ name: 'value', value: element.value });
        }
      } else if (element instanceof HTMLSelectElement) {
        const labels: string[] = [];
        for (const opt of Array.from(element.selectedOptions)) {
          const label = (opt.label || opt.text || opt.value || '').trim();
          if (label) labels.push(label);
        }
        if (labels.length > 0) {
          properties.push({ name: 'valuetext', value: labels.join(', ') });
        }
      }
    }

    return {
      role,
      name,
      description,
      properties,
    };
  }

  /**
   * Get implicit ARIA role for element
   */
  private getImplicitRole(element: Element): string | null {
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');

    const roleMap: Record<string, string> = {
      a: element.hasAttribute('href') ? 'link' : null,
      article: 'article',
      aside: 'complementary',
      button: 'button',
      footer: 'contentinfo',
      form: 'form',
      header: 'banner',
      main: 'main',
      nav: 'navigation',
      section: 'region',
      select: 'listbox',
      textarea: 'textbox',
      img: 'img',
    } as Record<string, string>;

    if (tag === 'input') {
      const inputRoleMap: Record<string, string> = {
        button: 'button',
        checkbox: 'checkbox',
        email: 'textbox',
        image: 'button',
        number: 'spinbutton',
        radio: 'radio',
        range: 'slider',
        reset: 'button',
        search: 'searchbox',
        submit: 'button',
        tel: 'textbox',
        text: 'textbox',
        url: 'textbox',
      };
      return inputRoleMap[type || 'text'] || 'textbox';
    }

    return roleMap[tag] || null;
  }

  /**
   * Get accessible name for element
   */
  private getAccessibleName(element: Element): string | null {
    // aria-label takes priority
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // aria-labelledby
    const ariaLabelledby = element.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      const labelEl = document.getElementById(ariaLabelledby);
      if (labelEl) return labelEl.textContent?.trim() || null;
    }

    // For form elements, check associated label
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      const id = element.id;
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) return label.textContent?.trim() || null;
      }

      // Check if wrapped in label
      const parentLabel = element.closest('label');
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true) as HTMLElement;
        const input = clone.querySelector('input, select, textarea');
        if (input) input.remove();
        return clone.textContent?.trim() || null;
      }
    }

    // For buttons and links, use text content
    if (element.tagName === 'BUTTON' || element.tagName === 'A') {
      return element.textContent?.trim() || null;
    }

    // Check title and placeholder
    const title = element.getAttribute('title');
    if (title) return title;

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder;

    // Check alt for images
    const alt = element.getAttribute('alt');
    if (alt) return alt;

    return null;
  }

  /**
   * Get accessible description
   */
  private getAccessibleDescription(element: Element): string | null {
    const ariaDescribedby = element.getAttribute('aria-describedby');
    if (ariaDescribedby) {
      const descEl = document.getElementById(ariaDescribedby);
      if (descEl) return descEl.textContent?.trim() || null;
    }

    // Fallback to title if not used for name
    if (!element.getAttribute('aria-label') && element.hasAttribute('title')) {
      return element.getAttribute('title');
    }

    return null;
  }

  /**
   * Extract visual/layout information
   */
  private extractVisualInfo(element: Element): VisualInfo {
    const htmlElement = element as HTMLElement;
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(htmlElement);

    const bounds: DOMRectData = {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };

    const isVisible = this.isElementVisible(htmlElement, rect, styles);
    const isScrollable = this.isElementScrollable(htmlElement, styles);

    const computedStyles: ComputedStylesSubset = {
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      overflow: styles.overflow,
      overflowX: styles.overflowX,
      overflowY: styles.overflowY,
      cursor: styles.cursor,
      pointerEvents: styles.pointerEvents,
    };

    return {
      bounds,
      isVisible,
      isScrollable,
      cursorStyle: styles.cursor,
      computedStyles,
    };
  }

  /**
   * Check if element is visible.
   * 1. CSS visibility (display:none, visibility:hidden, opacity:0)
   * 2. Viewport threshold check (element within viewport ± viewportExpansion pixels)
   */
  private isElementVisible(element: HTMLElement, rect: DOMRect, styles: CSSStyleDeclaration): boolean {
    // Hidden input types
    if (element instanceof HTMLInputElement && element.type === 'hidden') return false;

    // CSS visibility checks
    if (styles.display === 'none' || styles.visibility === 'hidden') return false;
    try {
      if (parseFloat(styles.opacity) <= 0) return false;
    } catch {
      /* ignore */
    }

    // Base visibility from DOM check
    if (!isElementTrulyVisible(element)) return false;

    // If viewport filtering disabled, stop here (CSS-only check)
    if (this.viewportExpansion === null) return true;

    // Viewport threshold check — element is visible if within viewport ± threshold vertically
    const vpTop = 0;
    const vpBottom = window.innerHeight;
    const threshold = this.viewportExpansion;

    const inVerticalRange = rect.bottom > vpTop - threshold && rect.top < vpBottom + threshold;

    // Horizontal viewport check
    const inHorizontalRange = rect.right > -threshold && rect.left < window.innerWidth + threshold;

    return inVerticalRange && inHorizontalRange;
  }

  /**
   * Check if element is scrollable.
   *  - Content overflow check (scrollHeight/Width > clientHeight/Width + 1)
   *  - Requires CSS overflow explicitly in {auto, scroll, overlay}
   *  - Does NOT fall back to a tag whitelist because getComputedStyle() is
   *    always available in a content script. A tag-based fallback was causing
   *    body/main to be falsely marked scrollable on pages where the html
   *    element is the real scroll container.
   */
  private isElementScrollable(element: HTMLElement, styles: CSSStyleDeclaration): boolean {
    const hasVerticalScroll = element.scrollHeight > element.clientHeight + 1;
    const hasHorizontalScroll = element.scrollWidth > element.clientWidth + 1;

    if (!hasVerticalScroll && !hasHorizontalScroll) return false;

    const overflow = (styles.overflow || 'visible').toLowerCase();
    const overflowX = (styles.overflowX || overflow).toLowerCase();
    const overflowY = (styles.overflowY || overflow).toLowerCase();
    const scrollValues = new Set(['auto', 'scroll', 'overlay']);

    return scrollValues.has(overflow) || scrollValues.has(overflowX) || scrollValues.has(overflowY);
  }

  /**
   * Process child elements
   */
  private processChildren(element: Element, parentNode: EnhancedDOMNode): void {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childElement = child as Element;

        // Skip our own extension elements
        if (this.shouldSkipElement(childElement)) continue;

        const childNode = this.buildEnhancedNode(childElement, parentNode);
        parentNode.children.push(childNode);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim();
        if (text) {
          // Create text node
          const textNode = createEmptyEnhancedNode(this.nodeIdCounter++);
          textNode.nodeType = NodeType.TEXT_NODE;
          textNode.textContent = text;
          textNode.parent = parentNode;

          // Compute bounds for text node using Range API and apply viewport filtering.
          // Text visibility inherits from parent — if parent is invisible
          // (display:none, hidden attr), rect will be zero-size → not visible
          let textVisible = parentNode.visual.isVisible;
          try {
            const range = document.createRange();
            range.selectNodeContents(child);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              textNode.visual.bounds = {
                x: rect.left + window.scrollX,
                y: rect.top + window.scrollY,
                width: rect.width,
                height: rect.height,
              };
              // Viewport threshold check for text nodes
              if (this.viewportExpansion !== null) {
                const threshold = this.viewportExpansion;
                textVisible = rect.bottom > -threshold && rect.top < window.innerHeight + threshold;
              }
            } else {
              // Zero-size rect means parent is display:none or element is hidden
              textVisible = false;
            }
          } catch {
            textVisible = false;
          }
          textNode.visual.isVisible = textVisible;

          parentNode.children.push(textNode);
        }
      }
    }

    // Traverse same-origin iframe/frame content document.
    // Store as contentDocument on the iframe node, not flattened into children.
    // Iterates from contentDocument.childNodes so the <html> element is included —
    // required for iframe scroll info lookup.
    const tag = element.tagName.toLowerCase();
    if (tag === 'iframe' || tag === 'frame') {
      try {
        const iframe = element as HTMLIFrameElement;
        const contentDoc = iframe.contentDocument;
        if (contentDoc?.documentElement) {
          // Create a document node for the iframe content
          const docNode = createEmptyEnhancedNode(this.nodeIdCounter++);
          docNode.nodeType = NodeType.DOCUMENT_NODE;
          docNode.tagName = '#document';
          docNode.parent = parentNode;
          // Document nodes have no layout box — mark not visible so
          // `optimizeTree` treats them as structural pass-throughs.
          docNode.visual.isVisible = false;

          // Walk from the content document's top-level children (typically just <html>),
          // preserving the full frame document structure.
          for (const child of Array.from(contentDoc.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE) {
              const childElement = child as Element;
              if (this.shouldSkipElement(childElement)) continue;
              const childNode = this.buildEnhancedNode(childElement, docNode);
              docNode.children.push(childNode);
            } else if (child.nodeType === Node.TEXT_NODE) {
              const text = child.textContent?.trim();
              if (text) {
                const textNode = createEmptyEnhancedNode(this.nodeIdCounter++);
                textNode.nodeType = NodeType.TEXT_NODE;
                textNode.textContent = text;
                textNode.parent = docNode;
                textNode.visual.isVisible = parentNode.visual.isVisible;
                docNode.children.push(textNode);
              }
            }
          }

          parentNode.contentDocument = docNode;
        }
      } catch {
        // Cross-origin iframe — can't access contentDocument
      }
    }
  }

  /**
   * Process shadow DOM
   */
  private processShadowRoot(element: Element, node: EnhancedDOMNode): void {
    const htmlElement = element as HTMLElement;

    if (htmlElement.shadowRoot) {
      node.isShadowHost = true;

      // Create shadow root node
      const shadowNode = createEmptyEnhancedNode(this.nodeIdCounter++);
      shadowNode.nodeType = NodeType.DOCUMENT_FRAGMENT_NODE;
      shadowNode.tagName = '#shadow-root';
      shadowNode.shadowRootType = 'open';
      shadowNode.parent = node;
      // Shadow root fragments have no layout box of their own — mark not visible
      // so empty shadow-root fragments are dropped by `optimizeTree` via the
      // visibility gate, cascading through non-visible custom-element hosts
      // (e.g. digit slots) and preventing empty-shadow explosions.
      shadowNode.visual.isVisible = false;

      // Process shadow root children — both elements AND text nodes
      for (const child of Array.from(htmlElement.shadowRoot.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childNode = this.buildEnhancedNode(child as Element, shadowNode);
          shadowNode.children.push(childNode);
        } else if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent?.trim();
          if (text && text.length > 1) {
            const textNode = createEmptyEnhancedNode(this.nodeIdCounter++);
            textNode.nodeType = NodeType.TEXT_NODE;
            textNode.textContent = text;
            textNode.parent = shadowNode;
            // Text visibility inherits from shadow host
            textNode.visual.isVisible = node.visual.isVisible;
            // Compute bounds via Range API
            try {
              const range = document.createRange();
              range.selectNodeContents(child);
              const rect = range.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                textNode.visual.bounds = {
                  x: rect.left + window.scrollX,
                  y: rect.top + window.scrollY,
                  width: rect.width,
                  height: rect.height,
                };
              }
            } catch {
              // Range API may fail for detached nodes
            }
            shadowNode.children.push(textNode);
          }
        }
      }

      node.shadowRoots.push(shadowNode);
    }
  }

  /**
   * Check if element should be skipped
   */
  private shouldSkipElement(element: Element): boolean {
    // Skip script, style, noscript
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') {
      return true;
    }

    // Skip extension elements
    const id = element.id || '';
    const className = element.className || '';
    if (id.includes('CEB-extension') || (typeof className === 'string' && className.includes('CEB-extension'))) {
      return true;
    }

    // Respect data-browser-use-exclude attribute (API attribute users set on their HTML)
    if (element.getAttribute('data-browser-use-exclude') === 'true') {
      return true;
    }

    return false;
  }

  /**
   * Generate XPath for element.
   * Passes through shadow roots transparently, stops at iframe boundary.
   */
  private generateXPath(element: Element): string {
    // - No //*[@id="..."] shortcut
    // - Walk up to root of the (frame's) document, stopping only at iframe boundary
    // - Position index emitted only when more than one same-tag sibling (1-based)
    const segments: string[] = [];
    let current: Element | null = element;

    while (current) {
      // Stop ONLY if parent is iframe/frame
      const parent: Element | null = current.parentElement;
      if (parent && (parent.tagName === 'IFRAME' || parent.tagName === 'FRAME')) {
        segments.unshift(this.xpathSegment(current));
        break;
      }

      segments.unshift(this.xpathSegment(current));

      if (parent) {
        current = parent;
      } else {
        // Cross shadow boundary transparently
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
    }

    return segments.join('/');
  }

  /**
   * Generate a single xpath segment for an element, emitting [N] only when
   * more than one same-tag sibling exists.
   */
  private xpathSegment(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) return tagName;

    const sameTagSiblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
    if (sameTagSiblings.length <= 1) return tagName;

    const position = sameTagSiblings.indexOf(element) + 1;
    return `${tagName}[${position}]`;
  }

  /**
   * Generate unique CSS selector.
   * Crosses shadow boundaries, stops at iframe boundary.
   */
  private generateSelector(element: Element): string {
    if (element.id) {
      return `#${element.id}`;
    }

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .trim()
          .split(/\s+/)
          .filter(c => c && !c.includes('CEB-extension'))
          .slice(0, 2);
        if (classes.length > 0) {
          selector += '.' + classes.join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children);
        const sameTagSiblings = siblings.filter(s => s.tagName === current!.tagName);
        if (sameTagSiblings.length > 1) {
          const index = siblings.indexOf(current);
          selector += `:nth-child(${index + 1})`;
        }
      }

      path.unshift(selector);

      // Cross shadow boundaries, stop at iframe
      const parent: Element | null = current.parentElement;
      if (parent) {
        if (parent.tagName === 'IFRAME' || parent.tagName === 'FRAME') {
          break;
        }
        current = parent;
      } else {
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
    }

    return path.join(' > ');
  }

  /**
   * Check if an element is interactive.
   */
  isInteractive(node: EnhancedDOMNode): boolean {
    // Skip non-element nodes
    if (node.nodeType !== NodeType.ELEMENT_NODE) return false;

    const tag = node.tagName.toLowerCase();

    // Skip html and body
    if (tag === 'html' || tag === 'body') return false;

    // IFRAME/FRAME: interactive if large enough (>100x100px)
    if (tag === 'iframe' || tag === 'frame') {
      const bounds = node.visual.bounds;
      if (bounds && bounds.width > 100 && bounds.height > 100) return true;
    }

    // Label handling: skip labels with "for" attribute to avoid double-activating
    // the associated input. Labels that wrap a form control directly are
    // clickable (click → associated input focus). Labels that wrap a custom
    // component (e.g. spl-typography-label) without a form control descendant
    // are treated as NON-interactive — on pages like SmartRecruiters these
    // label wrappers have cursor:default, so the cursor:pointer fallback
    // never fires for them. Falling through would incorrectly pick them up
    // via our getComputedStyle-based cursor check.
    if (tag === 'label') {
      if (node.attributes.for) return false;
      if (this.hasFormControlDescendant(node, 2)) return true;
      return false;
    }

    // Span wrappers: check for nested form controls
    if (tag === 'span') {
      if (this.hasFormControlDescendant(node, 2)) return true;
      // Fall through to other heuristics
    }

    // SEARCH ELEMENT DETECTION
    // node.attributes.class is not extracted (class is not in INCLUDE_ATTRIBUTES to keep LLM
    // output lean). Fall back to sourceElement.getAttribute to enable class-based detection.
    const classAttr = (node.attributes.class || node.sourceElement?.getAttribute('class') || '').toLowerCase();
    const classList = classAttr.split(/\s+/);
    if (SEARCH_INDICATORS.size > 0) {
      const joinedClasses = classList.join(' ');
      for (const indicator of SEARCH_INDICATORS) {
        if (joinedClasses.includes(indicator)) return true;
      }
      const elementId = (node.attributes.id || '').toLowerCase();
      for (const indicator of SEARCH_INDICATORS) {
        if (elementId.includes(indicator)) return true;
      }
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        if (attrName.startsWith('data-')) {
          for (const indicator of SEARCH_INDICATORS) {
            if (attrValue.toLowerCase().includes(indicator)) return true;
          }
        }
      }
    }

    // Accessibility property checks
    if (node.axNode?.properties) {
      for (const prop of node.axNode.properties) {
        // aria disabled / hidden
        if (prop.name === 'disabled' && prop.value) return false;
        if (prop.name === 'hidden' && prop.value) return false;
        // Direct interactiveness indicators
        if (['focusable', 'editable', 'settable'].includes(prop.name) && prop.value) return true;
        // Interactive state properties
        if (['checked', 'expanded', 'pressed', 'selected'].includes(prop.name)) return true;
        // Form-related
        if (['required', 'autocomplete'].includes(prop.name) && prop.value) return true;
        // Keyboard shortcuts
        if (prop.name === 'keyshortcuts' && prop.value) return true;
      }
    }

    // Native interactive elements
    if (INTERACTIVE_TAGS.has(tag)) {
      return true;
    }

    // Contenteditable elements (rich text editors, inline editors)
    const ce = node.attributes.contenteditable;
    if (ce === 'true' || ce === '') return true;
    
    // Event handler attributes
    const interactiveAttrs = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'tabindex'];
    if (interactiveAttrs.some(attr => node.attributes[attr] !== undefined)) return true;

    // tabindex: any value makes the element keyboard-focusable → interactive
    if (node.attributes.tabindex !== undefined) return true;

    // Interactive ARIA roles (explicit role attribute)
    const explicitRole = node.attributes.role;
    if (explicitRole && INTERACTIVE_ROLES.has(explicitRole)) return true;

    // Accessibility tree roles
    if (node.axNode?.role && INTERACTIVE_AX_ROLES.has(node.axNode.role)) return true;

    // Icon/small element check (10-50px).
    // `class` is intentionally excluded: virtually every styled element has a
    // class for CSS reasons; it is not evidence of interactivity on its own.
    const bounds = node.visual.bounds;
    if (bounds && bounds.width >= 10 && bounds.width <= 50 && bounds.height >= 10 && bounds.height <= 50) {
      const iconAttrs = ['role', 'onclick', 'data-action', 'aria-label'];
      if (iconAttrs.some(attr => node.attributes[attr] !== undefined)) return true;
    }

    // Cursor pointer (final fallback).
    //
    // The naive `if (cursor === 'pointer') return true` floods the index
    // with decorative descendants that inherit cursor from a parent container
    // (e.g. `.selectbox { cursor:pointer }` marks every <span>, <b>, <div>
    // child as interactive).
    //
    // Strategy — three layers:
    //
    //   Layer 0 — pointer-events:none is a hard exclusion: clicking the
    //     element via automation would do nothing.
    //
    //   Layer 1 — parent comparison (O(1), framework-agnostic): if the parent
    //     does NOT have cursor:pointer, this element set it on itself → own
    //     signal → interactive.
    //
    //   Layer 2 — when cursor IS inherited (parent also has pointer), accept
    //     the element only if it carries an independent semantic reason:
    //     (a) accessible name (aria-label / aria-labelledby / title),
    //     (b) substantial visible text (TEXT_NODE child > 2 chars — filters
    //         single emoji and CSS pseudo-content arrow characters),
    //     (c) non-zero-area leaf (no children but has real bounds — catches
    //         absolutely-positioned overlay divs and icon-font leaf nodes;
    //         bounds are 0×0 in test environments so this path is production-
    //         only — overlays without accessible names should add aria-label).
    if (node.visual.cursorStyle === 'pointer') {
      if (node.visual.computedStyles?.pointerEvents === 'none') return false;

      const parentHasPointer = node.parent?.visual?.cursorStyle === 'pointer';
      if (!parentHasPointer) return true;

      // Inherited context — require at least one independent semantic signal.
      if (
        node.attributes['aria-label'] ||
        node.attributes['aria-labelledby'] ||
        node.attributes['title']
      ) return true;

      // Substantial visible text (> 2 chars filters single emoji / arrow glyphs).
      const hasSubstantialText = node.children.some(
        c => c.nodeType === NodeType.TEXT_NODE && c.textContent.trim().length > 2,
      );
      if (hasSubstantialText) return true;

      // Non-zero-area leaf: possible overlay div or icon-font node.
      const isLeaf = node.children.length === 0;
      if (isLeaf && bounds && bounds.width > 0 && bounds.height > 0) return true;

      return false;
    }

    return false;
  }

  /**
   * Check if element has a form control descendant within max_depth levels.
   */
  private hasFormControlDescendant(node: EnhancedDOMNode, maxDepth: number): boolean {
    if (maxDepth <= 0) return false;
    for (const child of [...node.children, ...node.shadowRoots]) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      if (['input', 'select', 'textarea'].includes(child.tagName)) return true;
      if (this.hasFormControlDescendant(child, maxDepth - 1)) return true;
    }
    return false;
  }
}
