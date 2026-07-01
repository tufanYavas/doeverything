/**
 * DOM Node Types
 * Based on DOM specification node type constants
 */
export enum NodeType {
  ELEMENT_NODE = 1,
  ATTRIBUTE_NODE = 2,
  TEXT_NODE = 3,
  CDATA_SECTION_NODE = 4,
  PROCESSING_INSTRUCTION_NODE = 7,
  COMMENT_NODE = 8,
  DOCUMENT_NODE = 9,
  DOCUMENT_TYPE_NODE = 10,
  DOCUMENT_FRAGMENT_NODE = 11,
}

/**
 * Accessibility property from ARIA attributes
 */
export interface AccessibilityProperty {
  name: string;
  value: string | boolean | number | null;
}

/**
 * Accessibility node data extracted from element
 */
export interface AccessibilityNode {
  /** ARIA role or implicit role */
  role: string | null;
  /** Accessible name (aria-label, label text, etc.) */
  name: string | null;
  /** Accessible description (aria-describedby, title, etc.) */
  description: string | null;
  /** All accessibility properties */
  properties: AccessibilityProperty[];
}

/**
 * Visual info extracted from element
 */
export interface VisualInfo {
  /** Element bounding rect (viewport coordinates) */
  bounds: DOMRectData | null;
  /** Whether element is currently visible */
  isVisible: boolean;
  /** Whether element has scrollable overflow */
  isScrollable: boolean;
  /** Cursor style (pointer indicates clickable) */
  cursorStyle: string | null;
  /** Selected computed styles relevant for interaction */
  computedStyles: ComputedStylesSubset | null;
}

/**
 * Subset of computed styles we care about
 */
export interface ComputedStylesSubset {
  display: string;
  visibility: string;
  opacity: string;
  overflow: string;
  overflowX: string;
  overflowY: string;
  cursor: string;
  pointerEvents: string;
}

/**
 * DOMRect-like data structure (serializable)
 */
export interface DOMRectData {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compound child component info (for select, date/time, file inputs, etc.)
 */
export interface CompoundChildInfo {
  role: string;
  name: string;
  valuemin?: number | null;
  valuemax?: number | null;
  valuenow?: string | number | null;
  options_count?: number;
  first_options?: string[];
  format_hint?: string;
}

/**
 * Propagating bounds from parent interactive elements
 */
export interface PropagatingBounds {
  tag: string;
  bounds: DOMRectData;
  nodeId: number;
  depth: number;
}

/**
 * Enhanced DOM node combining DOM, accessibility, and visual data
 */
export interface EnhancedDOMNode {
  // === Identification ===
  /** Unique node ID within the tree */
  nodeId: number;
  /** DOM node type */
  nodeType: NodeType;
  /** Tag name in lowercase (for elements) */
  tagName: string;
  /** Text content for text nodes */
  textContent: string;

  // === Attributes ===
  /** All HTML attributes */
  attributes: Record<string, string>;

  // === Accessibility ===
  /** Accessibility tree data */
  axNode: AccessibilityNode | null;

  // === Visual ===
  /** Visual/layout information */
  visual: VisualInfo;

  // === Tree Navigation ===
  /** Parent node reference */
  parent: EnhancedDOMNode | null;
  /** Child nodes */
  children: EnhancedDOMNode[];
  /** Shadow root children (if shadow host) */
  shadowRoots: EnhancedDOMNode[];

  // === Iframe ===
  /** Content document for same-origin iframes */
  contentDocument: EnhancedDOMNode | null;

  // === Shadow DOM ===
  /** Type of shadow root (if this is a shadow root node) */
  shadowRootType: 'open' | 'closed' | null;
  /** Whether this element is a shadow host */
  isShadowHost: boolean;
  /** Whether this element is newly appeared since last state */
  isNew?: boolean;

  // === Computed ===
  /** XPath to this element */
  xpath: string;
  /** Unique CSS selector */
  selector: string;
  /** Backend Node ID (CDP) */
  backendNodeId: number;
  /** Direct reference to the original DOM element (survives shadow root scoping) */
  sourceElement?: Element;

  // === Compound Components ===
  /** Virtual sub-components for compound controls (date/time, select, file, etc.) */
  compoundChildren: CompoundChildInfo[];

  // === Hidden Content Info ===
  /** Interactive elements hidden below viewport (for iframe scroll hints) */
  hiddenElementsInfo: Array<{ tag: string; text: string; pages: number }>;
  /** Whether this element has hidden content below viewport */
  hasHiddenContent: boolean;
}

/**
 * Factory function type for creating empty enhanced node
 */
export function createEmptyEnhancedNode(nodeId: number): EnhancedDOMNode {
  return {
    nodeId,
    backendNodeId: 0,
    nodeType: NodeType.ELEMENT_NODE,
    tagName: '',
    textContent: '',
    attributes: {},
    axNode: null,
    visual: {
      bounds: null,
      isVisible: false,
      isScrollable: false,
      cursorStyle: null,
      computedStyles: null,
    },
    parent: null,
    children: [],
    shadowRoots: [],
    contentDocument: null,
    shadowRootType: null,
    isShadowHost: false,
    isNew: false,
    xpath: '',
    selector: '',
    compoundChildren: [],
    hiddenElementsInfo: [],
    hasHiddenContent: false,
  };
}
