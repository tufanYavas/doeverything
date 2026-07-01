/**
 * Page statistics for LLM context
 */
export interface PageStats {
  /** Total number of <a> elements */
  links: number;
  /** Total number of interactive elements (inputs, buttons, etc.) */
  interactiveElements: number;
  /** Number of iframes */
  iframes: number;
  /** Number of scrollable containers */
  scrollContainers: number;
  /** Number of open shadow DOMs */
  shadowOpen: number;
  /** Number of closed shadow DOMs */
  shadowClosed: number;
  /** Number of images */
  images: number;
  /** Total element count */
  totalElements: number;
}

/**
 * Page scroll/position information
 */
export interface PageInfo {
  /** Viewport height in pixels */
  viewportHeight: number;
  /** Viewport width in pixels */
  viewportWidth: number;
  /** Total page height */
  pageHeight: number;
  /** Total page width */
  pageWidth: number;
  /** Current scroll Y position */
  scrollY: number;
  /** Current scroll X position */
  scrollX: number;
  /** Pixels above current viewport */
  pixelsAbove: number;
  /** Pixels below current viewport */
  pixelsBelow: number;
  /** Pixels to the left of current viewport */
  pixelsLeft: number;
  /** Pixels to the right of current viewport */
  pixelsRight: number;
}

/**
 * Create empty page stats
 */
export function createEmptyPageStats(): PageStats {
  return {
    links: 0,
    interactiveElements: 0,
    iframes: 0,
    scrollContainers: 0,
    shadowOpen: 0,
    shadowClosed: 0,
    images: 0,
    totalElements: 0,
  };
}

/**
 * Get current page info from window
 */
export function getCurrentPageInfo(): PageInfo {
  const docEl = document.documentElement;
  const body = document.body;

  const pageHeight = Math.max(
    body.scrollHeight,
    body.offsetHeight,
    docEl.clientHeight,
    docEl.scrollHeight,
    docEl.offsetHeight,
  );

  const pageWidth = Math.max(
    body.scrollWidth,
    body.offsetWidth,
    docEl.clientWidth,
    docEl.scrollWidth,
    docEl.offsetWidth,
  );

  return {
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    pageHeight,
    pageWidth,
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    pixelsAbove: window.scrollY,
    pixelsBelow: Math.max(0, pageHeight - window.scrollY - window.innerHeight),
    pixelsLeft: window.scrollX,
    pixelsRight: Math.max(0, pageWidth - window.innerWidth - window.scrollX),
  };
}
