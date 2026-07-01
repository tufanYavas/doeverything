/**
 * Comprehensive tests for the cursor:pointer interactive-element heuristic.
 *
 * The cursor:pointer block inside isInteractive() uses a three-layer strategy
 * to decide which elements are truly interactive vs. merely inheriting a pointer
 * cursor from an ancestor:
 *
 *   Layer 0: Hard exclusion — pointer-events:none → always NOT interactive
 *   Layer 1: Element owns its pointer (parent does NOT have cursor:pointer) → interactive
 *   Layer 2: Element inherits pointer from parent → needs independent signal:
 *     (a) Accessible name (aria-label, aria-labelledby, title)
 *     (b) Substantial direct text child (TEXT_NODE with trimmed .length > 2)
 *     (c) Non-zero-area leaf [PRODUCTION ONLY — bounds are 0×0 in happy-dom]
 *
 * Test environment notes (happy-dom):
 *   - getBoundingClientRect() always returns { width:0, height:0 } for all elements.
 *   - Layer 2(c) (non-zero-area leaf) NEVER fires in tests.
 *   - cursor:pointer set via <style> tags IS computed correctly by happy-dom.
 *   - CSS inheritance (parent cursor propagating to children) IS computed correctly.
 *   - To test icon/overlay detection without Layer 2(c), use aria-label or title (Layer 2a).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDOMState } from '../lib/index.js';
import type { DOMStateResult } from '../lib/index.js';

afterEach(() => { document.body.innerHTML = ''; });

function scan(): DOMStateResult {
  return getDOMState(null, { viewportExpansion: null, enableBboxFiltering: false });
}
function isInteractive(result: DOMStateResult, el: Element | null): boolean {
  if (!el) return false;
  return Object.values(result.selectorMap).some(n => n.sourceElement === el);
}

// =============================================================================
// 1. Layer 1: element owns cursor:pointer (parent has different cursor)
// =============================================================================

describe('Layer 1: element owns cursor:pointer (parent has different cursor)', () => {

  it('div with cursor:pointer whose parent has no cursor set is interactive', () => {
    document.body.innerHTML = `
      <div id="card" style="cursor:pointer">Click me</div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('card')), 'card with cursor:pointer and no pointer-cursored parent').toBe(true);
  });

  it('div with cursor:pointer via class rule whose parent has no cursor is interactive', () => {
    document.body.innerHTML = `
      <style>.btn { cursor: pointer }</style>
      <div id="container">
        <div class="btn" id="btn">Submit</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn')), 'element with class-based cursor:pointer, non-pointer parent').toBe(true);
  });

  it('span with inline cursor:pointer whose parent has no cursor is interactive', () => {
    document.body.innerHTML = `
      <div>
        <span id="tag" style="cursor:pointer">JavaScript</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('tag')), 'span with inline cursor:pointer and no pointer-cursored parent').toBe(true);
  });

  it('element with cursor:pointer whose parent has cursor:auto is interactive (Layer 1)', () => {
    document.body.innerHTML = `
      <div style="cursor:auto">
        <span id="el" style="cursor:pointer">Action</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'element owns pointer; parent explicitly has cursor:auto').toBe(true);
  });

  it('element with cursor:pointer whose parent has cursor:default is interactive (Layer 1)', () => {
    document.body.innerHTML = `
      <div style="cursor:default">
        <span id="el" style="cursor:pointer">Action</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'element owns pointer; parent explicitly has cursor:default').toBe(true);
  });

  it('single-character content element is still interactive via Layer 1 when it owns cursor', () => {
    // When parent lacks pointer, Layer 1 fires BEFORE any text-length check.
    // Single char "←" is fine here because it is the pointer owner.
    document.body.innerHTML = `
      <div>
        <span id="prev" style="cursor:pointer">&#x2190;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('prev')), 'single-char element owns cursor:pointer — Layer 1 fires before text check').toBe(true);
  });

  it('two-character "OK" element is interactive via Layer 1 when it owns cursor', () => {
    // Layer 1 fires before Layer 2b text check, so "OK" (length 2) does not need > 2 chars
    document.body.innerHTML = `
      <div>
        <span id="ok" style="cursor:pointer">OK</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('ok')), 'two-char "OK" is interactive because element owns cursor:pointer (Layer 1)').toBe(true);
  });

  it('root-level element with cursor:pointer has no pointer-cursored parent — Layer 1 fires', () => {
    // node.parent is body, which has cursor:auto by default
    document.body.innerHTML = `<div id="root" style="cursor:pointer">Root action</div>`;
    const result = scan();
    expect(isInteractive(result, document.getElementById('root')), 'top-level div with cursor:pointer and non-pointer body parent').toBe(true);
  });

  it('multiple sibling elements each owning their own cursor:pointer are all interactive', () => {
    document.body.innerHTML = `
      <div>
        <span id="tag1" style="cursor:pointer">React</span>
        <span id="tag2" style="cursor:pointer">TypeScript</span>
        <span id="tag3" style="cursor:pointer">CSS</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('tag1')), 'first tag owns cursor:pointer').toBe(true);
    expect(isInteractive(result, document.getElementById('tag2')), 'second tag owns cursor:pointer').toBe(true);
    expect(isInteractive(result, document.getElementById('tag3')), 'third tag owns cursor:pointer').toBe(true);
  });

  it('breadcrumb li with inline cursor:pointer (parent ol has no pointer) is interactive', () => {
    document.body.innerHTML = `
      <nav>
        <ol>
          <li id="crumb1" style="cursor:pointer"><span>Home</span></li>
          <li id="crumb2" style="cursor:pointer"><span>Electronics</span></li>
          <li id="crumb3"><span>Laptops</span></li>
        </ol>
      </nav>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('crumb1')), 'first breadcrumb li owns cursor:pointer').toBe(true);
    expect(isInteractive(result, document.getElementById('crumb2')), 'second breadcrumb li owns cursor:pointer').toBe(true);
  });

  it('breadcrumb li without cursor:pointer is NOT interactive via cursor block', () => {
    document.body.innerHTML = `
      <nav>
        <ol>
          <li id="crumb-current"><span>Laptops</span></li>
        </ol>
      </nav>
    `;
    const result = scan();
    // li has no cursor:pointer and no interactive semantics, so it is not interactive
    expect(isInteractive(result, document.getElementById('crumb-current')), 'current-page breadcrumb li has no cursor:pointer and should not be interactive').toBe(false);
  });

});

// =============================================================================
// 2. Layer 2a: inherited cursor + accessible name
// =============================================================================

describe('Layer 2a: inherited cursor + accessible name', () => {

  it('div with inherited cursor:pointer and aria-label is interactive', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="overlay" aria-label="Open selector"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('overlay')), 'div with inherited pointer and aria-label').toBe(true);
  });

  it('div with inherited cursor:pointer and aria-labelledby is interactive', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <span id="lbl" style="display:none">Close panel</span>
      <div class="parent">
        <div id="el" aria-labelledby="lbl"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'div with inherited pointer and aria-labelledby').toBe(true);
  });

  it('div with inherited cursor:pointer and title attribute is interactive', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el" title="Delete record"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'div with inherited pointer and title attribute').toBe(true);
  });

  it('close button span with single-char content and aria-label inside pointer parent is interactive', () => {
    // "✕" is 1 char (length 1, NOT > 2), so Layer 2b would NOT fire.
    // aria-label provides the Layer 2a signal instead.
    document.body.innerHTML = `
      <style>.toast { cursor: pointer }</style>
      <div class="toast">
        <span id="close" aria-label="Dismiss">&#x2715;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('close')), 'close span with single char ✕ but aria-label triggers Layer 2a').toBe(true);
  });

  it('arrow icon span with single-char content and title inside pointer parent is interactive', () => {
    document.body.innerHTML = `
      <style>.menu { cursor: pointer }</style>
      <div class="menu">
        <span id="arrow" title="Expand menu">&#x25BC;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('arrow')), 'decorative arrow span becomes interactive via title attribute (Layer 2a)').toBe(true);
  });

  it('icon-only leaf element inside pointer parent with aria-label is interactive', () => {
    // This tests the Layer 2a escape hatch for overlays and icon nodes.
    // Without aria-label this would fail in tests (bounds are 0×0, Layer 2c never fires).
    document.body.innerHTML = `
      <style>.card { cursor: pointer }</style>
      <div class="card">
        <div id="icon-btn" aria-label="Add to wishlist"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('icon-btn')), 'empty leaf inside pointer parent is interactive only because of aria-label').toBe(true);
  });

  it('date picker cell with two-digit text and aria-label is interactive (Layer 2a)', () => {
    // "15" has length 2, which is NOT > 2, so Layer 2b does NOT fire.
    // aria-label with full date description provides the Layer 2a signal.
    document.body.innerHTML = `
      <style>.calendar-grid { cursor: pointer }</style>
      <div class="calendar-grid">
        <div id="day15" aria-label="June 15">15</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('day15')), 'date cell with "15" (len 2) is detected via aria-label, not text length').toBe(true);
  });

  it('date picker disabled cell with pointer-events:none is NOT interactive even with aria-label', () => {
    document.body.innerHTML = `
      <style>.calendar-grid { cursor: pointer } .disabled { pointer-events: none }</style>
      <div class="calendar-grid">
        <div id="day17" class="disabled" aria-label="June 17, unavailable">17</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('day17')), 'disabled day cell with pointer-events:none is hard-excluded by Layer 0 even with aria-label').toBe(false);
  });

  it('span with single-char content and no aria attributes inside pointer parent is NOT interactive', () => {
    // No aria-label, no title → Layer 2a does not fire.
    // "×" has length 1 → Layer 2b does not fire.
    // bounds are 0×0 in tests → Layer 2c does not fire.
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <span id="char">&#x00D7;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('char')), 'single-char span with no accessible name inside pointer parent is not interactive').toBe(false);
  });

});

// =============================================================================
// 3. Layer 2b: inherited cursor + substantial text — boundary cases
// =============================================================================

describe('Layer 2b: inherited cursor + substantial text — boundary cases', () => {

  it('empty text node child (length 0) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'element with no children at all: empty, no label, 0×0 → not interactive').toBe(false);
  });

  it('whitespace-only text node child (trimmed length 0) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent" id="parent">
        <div id="el">   \n  </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'whitespace-only text node trims to empty: not interactive').toBe(false);
  });

  it('single-char text "×" (length 1) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">&#x00D7;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"×" has length 1 — not > 2 — does not trigger Layer 2b').toBe(false);
  });

  it('single-char text "▼" (length 1) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <i id="arrow">&#x25BC;</i>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('arrow')), '"▼" has length 1 — decorative caret, not interactive').toBe(false);
  });

  it('single-char text "↕" (length 1) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <i id="sort">&#x2195;</i>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('sort')), '"↕" sort icon has length 1 — not interactive').toBe(false);
  });

  it('single-codepoint emoji "✓" (BMP, length 1) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">&#x2713;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"✓" is a BMP codepoint with length 1 — not interactive').toBe(false);
  });

  it('two-codepoint surrogate-pair emoji "🌟" (length 2) does NOT trigger Layer 2b', () => {
    // Astral-plane emoji: stored as high surrogate + low surrogate = 2 UTF-16 units.
    // 2 is NOT > 2, so Layer 2b does not fire.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">\u{1F31F}</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"🌟" has UTF-16 length 2 — equals threshold but does not exceed it — not interactive').toBe(false);
  });

  it('two-character text "OK" (length 2) does NOT trigger Layer 2b', () => {
    // "OK" is exactly 2 chars, which is NOT > 2.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el">OK</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"OK" has length 2 — equals threshold but does not exceed it — not interactive').toBe(false);
  });

  it('whitespace-padded " OK " trims to "OK" (length 2) and does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el"> OK </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '" OK " trims to "OK" (length 2) — not interactive').toBe(false);
  });

  it('three-character text "..." (length 3) triggers Layer 2b — interactive', () => {
    // Three full stops clears the > 2 threshold.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">...</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"..." has length 3 — exceeds threshold — interactive via Layer 2b').toBe(true);
  });

  it('four-letter text "Save" (length 4) triggers Layer 2b — interactive', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el">Save</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"Save" has length 4 — interactive via Layer 2b').toBe(true);
  });

  it('country flag emoji "🇺🇸" (4 UTF-16 code units) triggers Layer 2b — interactive', () => {
    // Regional indicator pair: each is 2 UTF-16 units → total length 4, which is > 2.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="flag">\u{1F1FA}\u{1F1F8}</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('flag')), '"🇺🇸" has UTF-16 length 4 — exceeds threshold — interactive via Layer 2b').toBe(true);
  });

  it('country flag emoji "🇩🇪" (4 UTF-16 code units) triggers Layer 2b — interactive', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="flag">\u{1F1E9}\u{1F1EA}</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('flag')), '"🇩🇪" has UTF-16 length 4 — interactive via Layer 2b').toBe(true);
  });

  it('right-arrow HTML entity decoded by DOM to "→" (length 1) does NOT trigger Layer 2b', () => {
    // &rarr; is decoded to → (U+2192) before the DOM TEXT_NODE is created.
    // The TEXT_NODE textContent is "→" with length 1.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">&rarr;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"→" (decoded entity) has length 1 — not interactive').toBe(false);
  });

  it('tab character "\\t" trims to empty (length 0) does NOT trigger Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">\t</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'tab char trims to "" (length 0) — not interactive').toBe(false);
  });

  it('zero-width space "\\u200B" does not trim (length 1) — does NOT trigger Layer 2b', () => {
    // U+200B is NOT stripped by JS .trim() (only ASCII whitespace is removed).
    // After trim, "​" remains with length 1, which is NOT > 2.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <span id="el">​</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'zero-width space has length 1 after trim — not interactive').toBe(false);
  });

  it('mixed children: direct TEXT_NODE with length > 2 plus ELEMENT_NODE child triggers Layer 2b', () => {
    // node.children has both a TEXT_NODE ("Add ") and an ELEMENT_NODE (<strong>).
    // Layer 2b iterates and finds the TEXT_NODE with trimmed length 3 > 2.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el">Add <strong>to Cart</strong></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'direct TEXT_NODE "Add " (trimmed length 3) triggers Layer 2b even though element also has ELEMENT_NODE child').toBe(true);
  });

  it('text only in a DESCENDANT (not direct child) does NOT trigger Layer 2b on wrapper', () => {
    // "Cancel" is inside a <p>, not a direct TEXT_NODE child of #wrapper.
    // Layer 2b only checks direct children. The <p> element child is nodeType 1, not TEXT_NODE.
    // The wrapper has one ELEMENT child → isLeaf=false → Layer 2c also does not fire.
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="wrapper">
          <p>Cancel</p>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('wrapper')), 'text buried in a child <p> does not count as direct TEXT_NODE — wrapper is not interactive').toBe(false);
  });

  it('long text "Open Menu" (length 9) comfortably triggers Layer 2b', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el">Open Menu</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), '"Open Menu" (length 9) — well above threshold — interactive via Layer 2b').toBe(true);
  });

});

// =============================================================================
// 4. Layer 2b: inherited cursor + substantial text — real-world patterns
// =============================================================================

describe('Layer 2b: inherited cursor + substantial text — real-world patterns', () => {

  it('navigation menu: each li with text > 2 inside pointer ul is interactive', () => {
    document.body.innerHTML = `
      <nav>
        <ul style="cursor:pointer" id="nav">
          <li id="home">Home</li>
          <li id="products">Products</li>
          <li id="about">About</li>
          <li id="contact">Contact</li>
        </ul>
      </nav>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('home')), '"Home" (len 4) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('products')), '"Products" (len 8) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('about')), '"About" (len 5) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('contact')), '"Contact" (len 7) — interactive via Layer 2b').toBe(true);
  });

  it('tab bar: each tab div with substantial text inside pointer container is interactive', () => {
    document.body.innerHTML = `
      <style>.tab-bar { cursor: pointer }</style>
      <div class="tab-bar" id="tab-bar">
        <div class="tab" id="tab-overview">Overview</div>
        <div class="tab" id="tab-analytics">Analytics</div>
        <div class="tab" id="tab-settings">Settings</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('tab-overview')), '"Overview" (len 8) — tab is interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('tab-analytics')), '"Analytics" (len 9) — tab is interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('tab-settings')), '"Settings" (len 8) — tab is interactive via Layer 2b').toBe(true);
  });

  it('product card: h3 with product name text inside pointer card is interactive', () => {
    document.body.innerHTML = `
      <style>.product-card { cursor: pointer }</style>
      <div class="product-card" id="card">
        <img src="shoe.jpg" alt="Running Shoe" id="img">
        <div class="product-info" id="info">
          <h3 class="product-name" id="name">Nike Air Max</h3>
          <span class="product-price" id="price">$129.99</span>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('name')), '"Nike Air Max" (len 12) inside pointer card — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('price')), '"$129.99" (len 7) inside pointer card — interactive via Layer 2b').toBe(true);
  });

  it('custom dropdown: "English" span with substantial text inside pointer widget is interactive', () => {
    document.body.innerHTML = `
      <style>.custom-select { cursor: pointer }</style>
      <div class="custom-select" id="dropdown" aria-label="Language selector">
        <span id="selected-value">English</span>
        <span id="flag">\u{1F1FA}\u{1F1F8}</span>
        <i id="arrow-icon">&#x25BC;</i>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('selected-value')), '"English" (len 7) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('flag')), '"🇺🇸" (len 4) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('arrow-icon')), '"▼" (len 1) — NOT interactive, single decorative glyph').toBe(false);
  });

  it('accordion header: label text span is interactive, decorative SVG is not', () => {
    document.body.innerHTML = `
      <style>.accordion-header { cursor: pointer }</style>
      <div class="accordion-header" id="header">
        <span id="label">Shipping &amp; Returns</span>
        <svg id="chevron" viewBox="0 0 24 24">
          <polyline id="poly" points="6 9 12 15 18 9"/>
        </svg>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('label')), '"Shipping & Returns" (len 18) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('chevron')), 'SVG with no direct TEXT_NODE children — not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('poly')), 'polyline leaf with no text, 0×0 bounds — not interactive in tests').toBe(false);
  });

  it('like button: "Like" span is interactive, decorative SVG and path are not', () => {
    document.body.innerHTML = `
      <style>.like-btn { cursor: pointer }</style>
      <div class="like-btn" id="like" aria-label="Like this post">
        <svg id="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path id="path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5"/>
        </svg>
        <span id="label">Like</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('label')), '"Like" (len 4) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('icon')), 'SVG with no direct TEXT_NODE children (only ELEMENT path child) — not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('path')), 'path leaf with no text and 0×0 bounds — not interactive in tests').toBe(false);
  });

  it('sortable table header: label span is interactive, sort icon is not', () => {
    document.body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th id="th-name" style="cursor:pointer">
              <span id="th-name-label">Name</span>
              <i id="th-name-icon">&#x2195;</i>
            </th>
            <th id="th-status">Status</th>
          </tr>
        </thead>
      </table>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('th-name-label')), '"Name" (len 4) inside pointer th — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('th-name-icon')), '"↕" (len 1) inside pointer th — NOT interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('th-status')), 'th with no cursor:pointer is not interactive via cursor block').toBe(false);
  });

  it('tag container: spans with text inside pointer parent are interactive', () => {
    document.body.innerHTML = `
      <style>.tag-list { cursor: pointer }</style>
      <div class="tag-list" id="tag-list">
        <span class="tag" id="tag-js">JavaScript</span>
        <span class="tag" id="tag-react">React</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('tag-js')), '"JavaScript" (len 10) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('tag-react')), '"React" (len 5) — interactive via Layer 2b').toBe(true);
  });

  it('breadcrumb span inheriting from pointer li is interactive via Layer 2b', () => {
    document.body.innerHTML = `
      <nav>
        <ol>
          <li id="li-crumb" style="cursor:pointer">
            <span id="crumb-text">Electronics</span>
          </li>
        </ol>
      </nav>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('crumb-text')), '"Electronics" (len 11) inheriting from pointer li — interactive via Layer 2b').toBe(true);
  });

  it('day header "Mon" (length 3) inside calendar grid with cursor:pointer is interactive', () => {
    document.body.innerHTML = `
      <style>.calendar-grid { cursor: pointer }</style>
      <div class="calendar-grid">
        <div id="day-header">Mon</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('day-header')), '"Mon" (len 3) — just above the > 2 threshold — interactive via Layer 2b').toBe(true);
  });

  it('date cell "15" (length 2) inside calendar grid is NOT interactive without aria-label', () => {
    // "15" has length 2, which is NOT > 2. No aria-label. Bounds are 0×0 in tests.
    document.body.innerHTML = `
      <style>.calendar-grid { cursor: pointer }</style>
      <div class="calendar-grid">
        <div id="day15">15</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('day15')), '"15" (len 2) — does not exceed threshold — not interactive in test environment').toBe(false);
  });

});

// =============================================================================
// 5. Structural wrapper suppression
// =============================================================================

describe('Structural wrapper suppression', () => {

  it('intermediate wrapper div with no direct TEXT_NODE and ELEMENT children is NOT interactive', () => {
    // The wrapper has one ELEMENT child (span), not a TEXT_NODE directly.
    // Layer 2b: no direct TEXT_NODE → does not fire.
    // Layer 2c: has children → isLeaf=false → does not fire.
    document.body.innerHTML = `
      <style>.container { cursor: pointer }</style>
      <div class="container" id="container">
        <div id="wrapper">
          <span>Settings</span>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('wrapper')), 'wrapper div with only ELEMENT children and no direct TEXT_NODE — not interactive').toBe(false);
  });

  it('deeply nested text-bearing span IS interactive even 4 levels deep', () => {
    document.body.innerHTML = `
      <style>.container { cursor: pointer }</style>
      <div class="container" id="l0">
        <div id="l1">
          <div id="l2">
            <div id="l3">
              <span id="leaf">Settings</span>
            </div>
          </div>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('l3')), 'l3 wrapper: no direct TEXT_NODE, only ELEMENT child — not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('leaf')), '"Settings" span 4 levels deep — direct TEXT_NODE child triggers Layer 2b').toBe(true);
  });

  it('arrow wrapper div with only empty <b> child is NOT interactive', () => {
    document.body.innerHTML = `
      <style>.selectbox { cursor: pointer }</style>
      <div class="selectbox" id="selectbox">
        <div class="arrow-wrap" id="arrow-wrap">
          <b id="arrow-shape"></b>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('arrow-wrap')), 'arrow-wrap div has only empty <b> child — no TEXT_NODE, not a leaf → not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('arrow-shape')), 'empty <b> leaf has 0×0 bounds and no label — not interactive in test env').toBe(false);
  });

  it('outer container with cursor:pointer that owns it IS interactive (Layer 1)', () => {
    document.body.innerHTML = `
      <style>.selectbox { cursor: pointer }</style>
      <div class="selectbox" id="selectbox">
        <div class="arrow-wrap" id="arrow-wrap">
          <b id="arrow-shape"></b>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('selectbox')), 'selectbox container owns cursor:pointer (Layer 1 fires)').toBe(true);
  });

  it('SVG element inside pointer parent with only ELEMENT children is NOT interactive', () => {
    document.body.innerHTML = `
      <style>.btn { cursor: pointer }</style>
      <div class="btn" id="btn">
        <svg id="icon" viewBox="0 0 24 24">
          <polyline id="poly" points="6 9 12 15 18 9"/>
        </svg>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('icon')), 'SVG with only ELEMENT child — not a leaf, no TEXT_NODE — not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('poly')), 'polyline leaf with 0×0 bounds and no label — not interactive in tests').toBe(false);
  });

  it('empty <i> leaf inside pointer parent without aria attributes is NOT interactive in tests', () => {
    // In production, Layer 2c (non-zero-area leaf) would fire for rendered icons.
    // In happy-dom tests, bounds are always 0×0, so this path is never taken.
    document.body.innerHTML = `
      <style>.nav { cursor: pointer }</style>
      <div class="nav" id="nav">
        <a href="/" id="home">Home</a>
        <i class="icon" id="nav-icon"></i>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('nav-icon')), 'empty <i> leaf with 0×0 bounds and no aria attr — not interactive in test env (Layer 2c is production-only)').toBe(false);
  });

  it('empty <i> leaf with aria-label inside pointer parent IS interactive via Layer 2a', () => {
    // Layer 2c does not fire in tests, but Layer 2a (aria-label) does.
    document.body.innerHTML = `
      <style>.nav { cursor: pointer }</style>
      <div class="nav">
        <i class="icon" id="nav-icon" aria-label="Home"></i>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('nav-icon')), 'empty <i> with aria-label "Home" inside pointer parent — interactive via Layer 2a').toBe(true);
  });

});

// =============================================================================
// 6. Cursor reset (cursor:auto/default overrides parent pointer)
// =============================================================================

describe('Cursor reset (cursor:auto/default overrides parent pointer)', () => {

  it('element with cursor:auto inside pointer grandparent has computed auto and is NOT interactive', () => {
    // When the parent resets cursor to 'auto', the element's computed cursor is 'auto',
    // so the cursor:pointer block is never entered.
    document.body.innerHTML = `
      <style>.gp { cursor: pointer } #parent { cursor: auto }</style>
      <div class="gp" id="gp">
        <div id="parent">
          <span id="el">Content</span>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'element with computed cursor:auto (reset by parent) — cursor block never entered').toBe(false);
  });

  it('element with explicit cursor:default inside pointer parent has computed default and is NOT interactive', () => {
    document.body.innerHTML = `
      <style>.menu { cursor: pointer }</style>
      <div class="menu" id="menu">
        <div id="divider" style="cursor:default">&#x2500;&#x2500;&#x2500;&#x2500;</div>
        <div id="item">File</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('divider')), 'divider with cursor:default (explicit override) — cursor block not entered').toBe(false);
    expect(isInteractive(result, document.getElementById('item')), '"File" (len 4) inherits pointer from menu — interactive via Layer 2b').toBe(true);
  });

  it('transform on parent does NOT affect cursor inheritance — child still inherits pointer', () => {
    // CSS transform creates a new stacking context but does NOT interrupt cursor inheritance.
    document.body.innerHTML = `
      <style>.card { cursor: pointer; transform: scale(1) }</style>
      <div class="card" id="card">
        <div id="content">Content</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('content')), '"Content" (len 7) inherits pointer through transform stacking context — interactive via Layer 2b').toBe(true);
  });

  it('sibling with cursor:default does not affect other siblings that inherit pointer', () => {
    document.body.innerHTML = `
      <style>.menu { cursor: pointer }</style>
      <div class="menu">
        <div id="sep" style="cursor:default">---</div>
        <div id="action">Delete</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('sep')), 'separator with cursor:default is not interactive (cursor block not entered)').toBe(false);
    expect(isInteractive(result, document.getElementById('action')), '"Delete" (len 6) inherits pointer from menu, sibling cursor reset does not affect it').toBe(true);
  });

});

// =============================================================================
// 7. pointer-events:none hard exclusion
// =============================================================================

describe('pointer-events:none hard exclusion', () => {

  it('element with cursor:pointer and pointer-events:none is NOT interactive (Layer 0)', () => {
    document.body.innerHTML = `
      <style>.page-btn { cursor: pointer } .disabled { pointer-events: none }</style>
      <div>
        <span class="page-btn disabled" id="btn">&#x00BB;&#x00BB;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn')), 'disabled pagination button with pointer-events:none — Layer 0 hard exclusion').toBe(false);
  });

  it('element with inherited cursor:pointer and direct pointer-events:none is NOT interactive', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent" id="parent">
        <div id="inner" style="pointer-events:none">Click here</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('inner')), 'element with inherited pointer but own pointer-events:none — Layer 0 excludes immediately').toBe(false);
  });

  it('pointer-events:none applied via CSS rule on all descendants excludes them', () => {
    // pointer-events:auto is the CSS default for descendants, so pointer-events:none
    // on a parent does NOT automatically propagate to children via getComputedStyle.
    // A CSS rule that explicitly targets descendants (.block * { pointer-events:none })
    // correctly sets the computed value and triggers Layer 0.
    document.body.innerHTML = `
      <style>
        .parent { cursor: pointer }
        .block { pointer-events: none }
        .block * { pointer-events: none }
      </style>
      <div class="parent">
        <div class="block">
          <span id="leaf">Text here</span>
        </div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('leaf')), 'leaf has pointer-events:none via descendant rule — Layer 0 excludes it').toBe(false);
  });

  it('pointer-events:none does NOT affect sibling with cursor:pointer', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="disabled" style="pointer-events:none">Inactive</div>
        <div id="active">Active</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('disabled')), 'disabled sibling with pointer-events:none is not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('active')), '"Active" (len 6) sibling without pointer-events:none — interactive via Layer 2b').toBe(true);
  });

  it('disabled date cell with pointer-events:none is NOT interactive even with pointer parent', () => {
    document.body.innerHTML = `
      <style>.calendar { cursor: pointer } .disabled { pointer-events: none }</style>
      <div class="calendar">
        <div id="day-17" class="disabled">17</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('day-17')), 'disabled calendar cell with pointer-events:none — hard excluded by Layer 0').toBe(false);
  });

  it('element with pointer-events:none and aria-label is still NOT interactive (Layer 0 precedes Layer 2a)', () => {
    document.body.innerHTML = `
      <style>.parent { cursor: pointer }</style>
      <div class="parent">
        <div id="el" style="pointer-events:none" aria-label="Cannot click">Info</div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'pointer-events:none overrides even aria-label — Layer 0 fires before Layer 2a').toBe(false);
  });

  it('pagination: active buttons are interactive, disabled button with pointer-events:none is not', () => {
    document.body.innerHTML = `
      <style>.page-btn { cursor: pointer } .page-btn.disabled { pointer-events: none }</style>
      <div id="pagination">
        <span class="page-btn" id="prev">&#x2190;</span>
        <span class="page-btn" id="pg1">1</span>
        <span class="page-btn" id="pg3">3</span>
        <span class="page-btn" id="next">&#x2192;</span>
        <span class="page-btn disabled" id="last">&#x00BB;&#x00BB;</span>
      </div>
    `;
    const result = scan();
    // Active pagination buttons own cursor:pointer (parent .pagination has no pointer) → Layer 1
    expect(isInteractive(result, document.getElementById('prev')), 'prev button owns cursor:pointer — interactive via Layer 1').toBe(true);
    expect(isInteractive(result, document.getElementById('pg1')), 'page 1 button owns cursor:pointer — interactive via Layer 1').toBe(true);
    expect(isInteractive(result, document.getElementById('last')), 'disabled button with pointer-events:none — NOT interactive').toBe(false);
  });

});

// =============================================================================
// 8. Common UI component patterns
// =============================================================================

describe('Common UI component patterns', () => {

  it('e-commerce product card: card container is interactive, img inside is not', () => {
    document.body.innerHTML = `
      <style>.product-card { cursor: pointer }</style>
      <div class="product-card" id="card">
        <img src="shoe.jpg" alt="Running Shoe" id="img">
        <div class="product-info" id="info">
          <h3 id="product-name">Nike Air Max</h3>
          <span id="product-price">$129.99</span>
        </div>
        <button id="add-btn">Add to Cart</button>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('card')), 'product card owns cursor:pointer (Layer 1)').toBe(true);
    expect(isInteractive(result, document.getElementById('img')), 'img has no text, no aria, 0×0 bounds — not interactive in tests').toBe(false);
    expect(isInteractive(result, document.getElementById('product-name')), '"Nike Air Max" (len 12) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('product-price')), '"$129.99" (len 7) — interactive via Layer 2b').toBe(true);
    // button is caught by INTERACTIVE_TAGS before cursor block
    expect(isInteractive(result, document.getElementById('add-btn')), 'button is interactive via INTERACTIVE_TAGS (not cursor block)').toBe(true);
  });

  it('toast notification: informational text is not interactive; close button with aria-label is', () => {
    document.body.innerHTML = `
      <style>.toast { cursor: pointer }</style>
      <div class="toast" id="toast">
        <p id="msg">Your changes have been saved.</p>
        <span id="close" aria-label="Dismiss">&#x2715;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('toast')), 'toast container owns cursor:pointer (Layer 1)').toBe(true);
    expect(isInteractive(result, document.getElementById('msg')), '"Your changes have been saved." (len > 2) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('close')), '"✕" (len 1) but aria-label "Dismiss" — interactive via Layer 2a').toBe(true);
  });

  it('icon-only font-awesome style buttons with aria-label are each interactive', () => {
    document.body.innerHTML = `
      <i class="fa fa-edit" id="edit" style="cursor:pointer" aria-label="Edit record"></i>
      <i class="fa fa-trash" id="trash" style="cursor:pointer" title="Delete record"></i>
    `;
    const result = scan();
    // Both own cursor:pointer (parent body has no pointer) → Layer 1
    expect(isInteractive(result, document.getElementById('edit')), 'fa-edit owns cursor:pointer (Layer 1); also has aria-label').toBe(true);
    expect(isInteractive(result, document.getElementById('trash')), 'fa-trash owns cursor:pointer (Layer 1); also has title').toBe(true);
  });

  it('icon without aria attributes inside pointer container is NOT interactive in test env', () => {
    document.body.innerHTML = `
      <div style="cursor:pointer" id="container">
        <i class="fa fa-star" id="star"></i>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('star')), 'fa-star inside pointer container: no aria, no text, 0×0 bounds → not interactive in tests').toBe(false);
  });

  it('file uploader browse link with cursor:pointer owns it (parent p has no pointer) — interactive', () => {
    document.body.innerHTML = `
      <div class="drop-zone">
        <p id="p">Drag files here or <span class="browse-link" id="browse" style="cursor:pointer" aria-label="Browse files">browse</span></p>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('browse')), 'browse link owns cursor:pointer (parent p has no pointer) — Layer 1').toBe(true);
    expect(isInteractive(result, document.getElementById('p')), 'p element has no cursor:pointer and no interactive semantics').toBe(false);
  });

  it('custom select widget with aria-label: container interactive via Layer 1 and overlay via Layer 2a', () => {
    document.body.innerHTML = `
      <style>.custom-select { cursor: pointer }</style>
      <div class="custom-select" id="select" aria-label="Language selector">
        <span id="val">English</span>
        <div class="overlay" id="overlay" aria-label="Open language selector"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('select')), 'custom-select owns cursor:pointer — Layer 1').toBe(true);
    expect(isInteractive(result, document.getElementById('val')), '"English" (len 7) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('overlay')), 'overlay with aria-label inside pointer parent — Layer 2a').toBe(true);
  });

  it('phone field: flag emoji span and overlay are interactive; pure structural wrapper is not', () => {
    document.body.innerHTML = `
      <style>.selectbox { cursor: pointer }</style>
      <div class="selectbox" id="selectbox">
        <span id="flag">\u{1F1FA}\u{1F1F8}</span>
        <input type="text" id="cc-input" aria-label="Country code" readonly value="+1">
        <div class="arrow-wrap" id="arrow-wrap">
          <b id="arrow-shape"></b>
        </div>
        <div class="overlay" id="overlay" aria-label="Open country selector"></div>
      </div>
      <input type="tel" id="phone" aria-label="Mobile number">
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('selectbox')), 'selectbox container owns cursor:pointer (Layer 1)').toBe(true);
    expect(isInteractive(result, document.getElementById('flag')), '"🇺🇸" (len 4) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('cc-input')), 'country code input is interactive via INTERACTIVE_TAGS').toBe(true);
    expect(isInteractive(result, document.getElementById('arrow-wrap')), 'arrow wrapper with only empty <b> child — not interactive').toBe(false);
    expect(isInteractive(result, document.getElementById('overlay')), 'overlay with aria-label — Layer 2a').toBe(true);
    expect(isInteractive(result, document.getElementById('phone')), 'phone input is interactive via INTERACTIVE_TAGS').toBe(true);
  });

  it('tag list container with pointer: container (Layer 1) and each tag span (Layer 2b) are all interactive', () => {
    document.body.innerHTML = `
      <style>.tag-list { cursor: pointer }</style>
      <div class="tag-list" id="tag-list">
        <span class="tag" id="js">JavaScript</span>
        <span class="tag" id="react">React</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('tag-list')), 'tag-list container owns cursor:pointer (Layer 1)').toBe(true);
    expect(isInteractive(result, document.getElementById('js')), '"JavaScript" (len 10) — interactive via Layer 2b').toBe(true);
    expect(isInteractive(result, document.getElementById('react')), '"React" (len 5) — interactive via Layer 2b').toBe(true);
  });

});

// =============================================================================
// 9. Elements interactive via other checks (not cursor:pointer)
// =============================================================================

describe('Elements interactive via other checks (not cursor:pointer)', () => {

  it('<button> is interactive via INTERACTIVE_TAGS regardless of cursor', () => {
    document.body.innerHTML = `<button id="btn">Add to Cart</button>`;
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn')), 'button is caught by INTERACTIVE_TAGS before cursor block').toBe(true);
  });

  it('<a href> is interactive via INTERACTIVE_TAGS regardless of cursor', () => {
    document.body.innerHTML = `<a href="/home" id="link">Home</a>`;
    const result = scan();
    expect(isInteractive(result, document.getElementById('link')), 'anchor is caught by INTERACTIVE_TAGS').toBe(true);
  });

  it('<input type="text"> is interactive via INTERACTIVE_TAGS', () => {
    document.body.innerHTML = `<input type="text" id="inp" placeholder="Name">`;
    const result = scan();
    expect(isInteractive(result, document.getElementById('inp')), 'text input is caught by INTERACTIVE_TAGS').toBe(true);
  });

  it('<select> is interactive via INTERACTIVE_TAGS', () => {
    document.body.innerHTML = `<select id="sel"><option>One</option></select>`;
    const result = scan();
    expect(isInteractive(result, document.getElementById('sel')), 'select is caught by INTERACTIVE_TAGS').toBe(true);
  });

  it('<textarea> is interactive via INTERACTIVE_TAGS', () => {
    document.body.innerHTML = `<textarea id="ta">Text</textarea>`;
    const result = scan();
    expect(isInteractive(result, document.getElementById('ta')), 'textarea is caught by INTERACTIVE_TAGS').toBe(true);
  });

  it('element with role="button" is interactive via INTERACTIVE_ROLES', () => {
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <span id="btn" role="button">Close</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn')), 'role="button" is caught by INTERACTIVE_ROLES (pre-cursor check)').toBe(true);
  });

  it('element with tabindex="0" is interactive via tabindex check', () => {
    document.body.innerHTML = `
      <div id="el" tabindex="0">Focusable</div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('el')), 'element with tabindex="0" is interactive via tabindex check').toBe(true);
  });

  it('contenteditable="true" is interactive via contenteditable check', () => {
    document.body.innerHTML = `
      <div id="editor" contenteditable="true" aria-label="Message">Hello</div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('editor')), 'contenteditable="true" is interactive via contenteditable check').toBe(true);
  });

  it('<button> inside cursor:pointer container: interactive via INTERACTIVE_TAGS, not cursor block', () => {
    document.body.innerHTML = `
      <style>.product-card { cursor: pointer }</style>
      <div class="product-card">
        <button id="add-btn">Add to Cart</button>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('add-btn')), 'button inside pointer card — caught by INTERACTIVE_TAGS before cursor block is reached').toBe(true);
  });

  it('<a> inside cursor:pointer navigation: interactive via INTERACTIVE_TAGS', () => {
    document.body.innerHTML = `
      <style>.nav { cursor: pointer }</style>
      <nav class="nav">
        <a href="/" id="home-link">Home</a>
        <a href="/about" id="about-link">About</a>
      </nav>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('home-link')), 'anchor in pointer nav — caught by INTERACTIVE_TAGS').toBe(true);
    expect(isInteractive(result, document.getElementById('about-link')), 'anchor in pointer nav — caught by INTERACTIVE_TAGS').toBe(true);
  });

  it('<html> and <body> are always skipped regardless of cursor', () => {
    // The function skips html and body at the very beginning.
    document.body.style.cursor = 'pointer';
    const result = scan();
    expect(isInteractive(result, document.body), 'body is always skipped by isInteractive()').toBe(false);
    expect(isInteractive(result, document.documentElement), 'html is always skipped by isInteractive()').toBe(false);
    document.body.style.cursor = '';
  });

  it('<details> and <summary> are interactive via INTERACTIVE_TAGS', () => {
    document.body.innerHTML = `
      <details id="det">
        <summary id="sum">Click to expand</summary>
        <p>Hidden content</p>
      </details>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('det')), 'details element is caught by INTERACTIVE_TAGS').toBe(true);
    expect(isInteractive(result, document.getElementById('sum')), 'summary element is caught by INTERACTIVE_TAGS').toBe(true);
  });

});
