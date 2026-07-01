/** Check if an element is in the browser's paint tree (visible, not display:none, not opacity:0). Uses checkVisibility() API with CSS property fallbacks. */
export function isElementTrulyVisible(element: Element): boolean {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

  const el = element as HTMLElement;

  // checkVisibility() returns false whenever the browser would omit the element
  // from the paint tree (display:none or visibility:hidden on self/ancestors,
  // opacity:0, content-visibility:hidden, <details> without open).
  interface CheckVisibilityOptions {
    contentVisibilityAuto?: boolean;
    opacityProperty?: boolean;
    visibilityProperty?: boolean;
  }
  const checkVisibility = (
    el as HTMLElement & {
      checkVisibility?: (opts?: CheckVisibilityOptions) => boolean;
    }
  ).checkVisibility;
  if (typeof checkVisibility === 'function') {
    if (
      !checkVisibility.call(el, {
        contentVisibilityAuto: true,
        opacityProperty: true,
        visibilityProperty: true,
      })
    ) {
      return false;
    }
  }

  // display/visibility/opacity from the element's own computed styles.
  // Kept as explicit fallback even though checkVisibility already covers the common cases.
  const style = window.getComputedStyle(el);
  const display = (style.display || '').toLowerCase();
  const visibility = (style.visibility || '').toLowerCase();
  const opacityStr = style.opacity || '1';

  if (display === 'none' || visibility === 'hidden') return false;

  const opacity = parseFloat(opacityStr);
  if (!isNaN(opacity) && opacity <= 0) return false;

  // `getBoundingClientRect` always returns a value in a content script,
  // so a bounds-null check is a no-op. Empty layout boxes (zero width/height)
  // are considered visible — we do not filter on size here.

  return true;
}
