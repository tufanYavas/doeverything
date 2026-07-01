/**
 * End-to-end tests for complex and composite form element patterns.
 *
 * Covers the full getDOMState() pipeline against HTML patterns that commonly
 * appear in modern web apps but can trip up DOM serializers:
 *   - Overlays that intercept clicks via z-index
 *   - Composite multi-part widgets (phone field, OTP, date picker)
 *   - Rich text editors (contenteditable)
 *   - ARIA-augmented custom controls (combobox, tabs, accordion)
 *
 * All tests use static HTML (document.body.innerHTML). React-rendered
 * variants live in tests/integration/dom-processor-react.test.tsx.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDOMState } from '../lib/index.js';
import type { DOMStateResult } from '../lib/index.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function scan(): DOMStateResult {
  return getDOMState(null, { viewportExpansion: null, enableBboxFiltering: false });
}

function isInteractive(result: DOMStateResult, el: Element | null): boolean {
  if (!el) return false;
  return Object.values(result.selectorMap).some(n => n.sourceElement === el);
}

// ---------------------------------------------------------------------------
// Custom select with z-index overlay
// ---------------------------------------------------------------------------

describe('Custom select with click-intercepting overlay', () => {
  it('overlay div with aria-label and inherited cursor:pointer is interactive', () => {
    // Overlays that serve as click interceptors should carry aria-label for
    // two reasons: AI detectability AND accessibility. The parent-cursor
    // heuristic requires an independent semantic signal (accessible name,
    // substantial text, or non-zero bounds) to keep inherited-pointer elements.
    document.body.innerHTML = `
      <style>
        .selectbox { position: relative; cursor: pointer; display: inline-flex; width: 120px; height: 36px; }
        .selectbox-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 2; }
        .select-input { cursor: pointer; appearance: none; border: none; flex: 1; }
      </style>
      <div class="selectbox">
        <input type="text" class="select-input" readonly value="+90" />
        <div class="selectbox-overlay" aria-label="Open selector"></div>
      </div>
    `;
    const result = scan();
    const overlay = document.querySelector('.selectbox-overlay');
    expect(isInteractive(result, overlay)).toBe(true);
  });

  it('composite phone field: country code overlay + phone number input', () => {
    document.body.innerHTML = `
      <style>
        .phone-field { display: flex; gap: 8px; }
        .selectbox { position: relative; cursor: pointer; width: 80px; height: 36px; }
        .selectbox-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 2; }
        .select-input { cursor: pointer; appearance: none; border: none; width: 100%; }
      </style>
      <div class="phone-field">
        <div class="selectbox" id="country-selector">
          <input type="text" class="select-input" readonly value="+90" aria-label="Country code" />
          <div class="selectbox-overlay" aria-label="Change country code"></div>
        </div>
        <input type="tel" id="phone-number" placeholder="5XX XXX XX XX" aria-label="Phone number" />
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.querySelector('.selectbox-overlay'))).toBe(true);
    expect(isInteractive(result, document.getElementById('phone-number'))).toBe(true);
  });

  it('clickable container div without overlay', () => {
    document.body.innerHTML = `
      <div class="custom-select" style="cursor: pointer;" role="listbox" tabindex="0" aria-label="Select size">
        <span>Medium</span>
      </div>
    `;
    expect(isInteractive(scan(), document.querySelector('.custom-select'))).toBe(true);
  });

  it('overlay does not suppress the underlying interactive input', () => {
    document.body.innerHTML = `
      <style>
        .wrap { position: relative; cursor: pointer; }
        .wrap-overlay { position: absolute; inset: 0; z-index: 3; }
        .wrap-input { cursor: pointer; border: none; width: 100%; }
      </style>
      <div class="wrap">
        <input type="text" class="wrap-input" readonly value="Option A" />
        <div class="wrap-overlay" aria-label="Open options"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.querySelector('.wrap-overlay'))).toBe(true);
    expect(isInteractive(result, document.querySelector('.wrap-input'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Native form elements
// ---------------------------------------------------------------------------

describe('Native form elements', () => {
  it('<select>', () => {
    document.body.innerHTML = `
      <select name="country" id="country" aria-label="Country">
        <option value="">Choose a country</option>
        <option value="tr">Turkey</option>
        <option value="de">Germany</option>
      </select>
    `;
    expect(isInteractive(scan(), document.getElementById('country'))).toBe(true);
  });

  it('<textarea>', () => {
    document.body.innerHTML = `
      <label for="bio">Bio</label>
      <textarea id="bio" name="bio" rows="4" placeholder="Tell us about yourself"></textarea>
    `;
    expect(isInteractive(scan(), document.getElementById('bio'))).toBe(true);
  });

  it('<input type="date">', () => {
    document.body.innerHTML = `<input type="date" id="bday" aria-label="Birthday" />`;
    expect(isInteractive(scan(), document.getElementById('bday'))).toBe(true);
  });

  it('<input type="range"> slider', () => {
    document.body.innerHTML = `
      <label for="vol">Volume</label>
      <input type="range" id="vol" min="0" max="100" value="50" />
    `;
    expect(isInteractive(scan(), document.getElementById('vol'))).toBe(true);
  });

  it('<input type="number"> with custom Â± buttons', () => {
    document.body.innerHTML = `
      <div>
        <button type="button" aria-label="Decrease">âˆ’</button>
        <input type="number" id="qty" min="1" max="99" value="1" aria-label="Quantity" />
        <button type="button" aria-label="Increase">+</button>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.querySelector('[aria-label="Decrease"]'))).toBe(true);
    expect(isInteractive(result, document.querySelector('[aria-label="Increase"]'))).toBe(true);
    expect(isInteractive(result, document.getElementById('qty'))).toBe(true);
  });

  it('<input type="search"> with submit button', () => {
    document.body.innerHTML = `
      <form role="search">
        <input type="search" id="q" placeholder="Searchâ€¦" aria-label="Search" />
        <button type="submit">Go</button>
      </form>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('q'))).toBe(true);
    expect(isInteractive(result, document.querySelector('[type="submit"]'))).toBe(true);
  });

  it('<input type="file"> always interactive even when display:none', () => {
    document.body.innerHTML = `
      <input type="file" id="avatar" accept="image/*" style="display:none" />
      <label for="avatar" style="cursor:pointer">Upload</label>
    `;
    expect(isInteractive(scan(), document.getElementById('avatar'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ARIA / composite controls
// ---------------------------------------------------------------------------

describe('ARIA / composite controls', () => {
  it('contenteditable="true" rich-text editor', () => {
    document.body.innerHTML = `
      <div contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message">
        Hello world
      </div>
    `;
    expect(isInteractive(scan(), document.querySelector('[contenteditable="true"]'))).toBe(true);
  });

  it('contenteditable="" (empty string) editor', () => {
    document.body.innerHTML = `<div contenteditable="" aria-label="Edit">Edit me</div>`;
    expect(isInteractive(scan(), document.querySelector('[contenteditable]'))).toBe(true);
  });

  it('combobox with open listbox â€” input + options all interactive', () => {
    document.body.innerHTML = `
      <div>
        <input type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="opts" />
        <ul id="opts" role="listbox">
          <li role="option" aria-selected="false">Turkey</li>
          <li role="option" aria-selected="false">Germany</li>
          <li role="option" aria-selected="true">France</li>
        </ul>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.querySelector('[role="combobox"]'))).toBe(true);
    document.querySelectorAll('[role="option"]').forEach(opt => {
      expect(isInteractive(result, opt)).toBe(true);
    });
  });

  it('OTP â€” all 6 digit cells individually interactive', () => {
    document.body.innerHTML = `
      <div aria-label="One-time password">
        ${[1,2,3,4,5,6].map(n =>
          `<input type="text" maxlength="1" inputmode="numeric" aria-label="Digit ${n}" class="otp-cell" />`
        ).join('')}
      </div>
    `;
    const result = scan();
    const cells = document.querySelectorAll('.otp-cell');
    expect(cells).toHaveLength(6);
    cells.forEach(cell => expect(isInteractive(result, cell)).toBe(true));
  });

  it('multi-select tag input: chips with remove buttons + text field', () => {
    document.body.innerHTML = `
      <div aria-label="Skills">
        <span>React <button type="button" aria-label="Remove React">Ã—</button></span>
        <span>TypeScript <button type="button" aria-label="Remove TypeScript">Ã—</button></span>
        <input type="text" aria-label="Add skill" placeholder="Addâ€¦" />
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.querySelector('[aria-label="Remove React"]'))).toBe(true);
    expect(isInteractive(result, document.querySelector('[aria-label="Remove TypeScript"]'))).toBe(true);
    expect(isInteractive(result, document.querySelector('input[type="text"]'))).toBe(true);
  });

  it('custom date picker: readonly input + calendar button', () => {
    document.body.innerHTML = `
      <div>
        <input type="text" id="date-field" placeholder="DD/MM/YYYY" readonly aria-label="Date" />
        <button type="button" aria-label="Open calendar" aria-haspopup="dialog">&#128197;</button>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('date-field'))).toBe(true);
    expect(isInteractive(result, document.querySelector('[aria-label="Open calendar"]'))).toBe(true);
  });

  it('accordion â€” header buttons interactive even when panels are hidden', () => {
    document.body.innerHTML = `
      <div>
        <button aria-expanded="false" aria-controls="p1">FAQ 1</button>
        <div id="p1" role="region" style="display:none"><p>Answer 1</p></div>
        <button aria-expanded="true" aria-controls="p2">FAQ 2</button>
        <div id="p2" role="region"><p>Answer 2</p></div>
      </div>
    `;
    const result = scan();
    document.querySelectorAll('button[aria-controls]').forEach(h => {
      expect(isInteractive(result, h)).toBe(true);
    });
  });

  it('tabs â€” all tab buttons interactive regardless of selected state', () => {
    document.body.innerHTML = `
      <div role="tablist">
        <button role="tab" aria-selected="true"  aria-controls="t-general">General</button>
        <button role="tab" aria-selected="false" aria-controls="t-security">Security</button>
        <button role="tab" aria-selected="false" aria-controls="t-billing">Billing</button>
      </div>
      <div id="t-general"  role="tabpanel">Content</div>
      <div id="t-security" role="tabpanel" style="display:none">Content</div>
      <div id="t-billing"  role="tabpanel" style="display:none">Content</div>
    `;
    const result = scan();
    document.querySelectorAll('[role="tab"]').forEach(tab => {
      expect(isInteractive(result, tab)).toBe(true);
    });
  });

  it('modal dialog â€” all form fields inside are interactive', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">Edit profile</h2>
        <input type="text" id="fname" aria-label="First name" />
        <input type="email" id="email" aria-label="Email" />
        <button aria-label="Close">Ã—</button>
        <button type="submit">Save</button>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('fname'))).toBe(true);
    expect(isInteractive(result, document.getElementById('email'))).toBe(true);
    expect(isInteractive(result, document.querySelector('[aria-label="Close"]'))).toBe(true);
    expect(isInteractive(result, document.querySelector('[type="submit"]'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cursor:pointer inheritance flood prevention
//
// A common pattern: `.widget { cursor: pointer }` causes ALL descendants
// (decorative <span>, <b>, wrapper <div>) to inherit cursor:pointer and be
// falsely flagged as interactive. These tests verify that only semantically
// meaningful elements are indexed.
// ---------------------------------------------------------------------------

describe('cursor:pointer inheritance flood prevention', () => {
  it('<b> inside cursor:pointer parent is NOT interactive', () => {
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box" id="box">
        <b id="arrow"></b>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('arrow'))).toBe(false);
  });

  it('<span> with a single glyph inside cursor:pointer parent is NOT interactive', () => {
    // Single-character decorative glyphs (▼, ›, arrow chars) have length 1 in JS.
    // The substantial-text threshold (> 2 chars) filters them out correctly.
    // Multi-char text (real words, flag emojis ≥ 4 chars) IS kept — it may be
    // a visible label that the AI should be able to interact with.
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <span class="arrow" id="arrow">&#x25BC;</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('arrow'))).toBe(false);
  });

  it('structural wrapper div whose only child is <b> is NOT interactive', () => {
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <div class="arrow-wrap" id="wrap"><b></b></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('wrap'))).toBe(false);
  });

  it('outer cursor:pointer container IS interactive', () => {
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box" id="box"><b></b></div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('box'))).toBe(true);
  });

  it('overlay with aria-label inside cursor:pointer parent IS interactive', () => {
    // Overlays that intercept clicks should carry aria-label — this both satisfies
    // the "accessible name" escape hatch in our inherited-cursor detection and
    // improves real accessibility. An overlay without aria-label would only be
    // detected via non-zero bounds (production-only; 0×0 in test environment).
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <div class="overlay" id="overlay" aria-label="Open selector"></div>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('overlay'))).toBe(true);
  });

  it('<span role="button"> inside cursor:pointer parent IS interactive', () => {
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <span role="button" id="btn">Close</span>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn'))).toBe(true);
  });

  it('<b aria-label="Close"> IS interactive (explicit semantic attribute)', () => {
    document.body.innerHTML = `
      <style>.box { cursor: pointer }</style>
      <div class="box">
        <b aria-label="Close" id="arrow">&#x2715;</b>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('arrow'))).toBe(true);
  });

  it('Phone field: structural noise is suppressed, semantic elements kept', () => {
    // CRM phone field pattern where .selectbox sets cursor:pointer
    // and all descendants inherit it.
    //
    // With the parent-cursor heuristic:
    //   INTERACTIVE:
    //     - .selectbox (parent does NOT have cursor:pointer → owns cursor)
    //     - .leading_icon span (flag emoji 🇺🇸 is 4 JS chars > 2 → substantial text)
    //     - input[aria-label="Country code"] (native INTERACTIVE_TAG)
    //     - .selectbox_overlay with aria-label (accessible name escape hatch)
    //     - input[type=tel] (native INTERACTIVE_TAG)
    //   NOT INTERACTIVE:
    //     - .selectbox_arrow (has children, no text, no aria → structural wrapper)
    //     - <b> inside arrow (leaf, but 0×0 bounds in test env — in real Chrome it
    //       would also be excluded if we add a narrow high-confidence tag list;
    //       the remaining false-positive is acknowledged as inherent limitation)
    document.body.innerHTML = `
      <style>
        .selectbox { cursor: pointer }
      </style>
      <div class="phone-field">
        <div class="selectbox" id="selectbox">
          <span class="leading_icon" id="flag">&#127482;&#127480;</span>
          <input type="text" id="cc-input" aria-label="Country code" readonly value="+1" />
          <div class="selectbox_arrow" id="arrow-wrap">
            <b id="arrow-shape"></b>
          </div>
          <div class="selectbox_overlay" id="overlay" aria-label="Open country selector"></div>
        </div>
        <input type="tel" id="phone" aria-label="Mobile number" />
      </div>
    `;
    const result = scan();

    // Pure structural noise — must NOT be interactive
    expect(isInteractive(result, document.getElementById('arrow-wrap')), 'arrow wrapper div').toBe(false);

    // Semantically meaningful elements — MUST be interactive
    expect(isInteractive(result, document.getElementById('flag')), 'flag span (emoji text)').toBe(true);
    expect(isInteractive(result, document.getElementById('selectbox')), 'selectbox container').toBe(true);
    expect(isInteractive(result, document.getElementById('cc-input')), 'country code input').toBe(true);
    expect(isInteractive(result, document.getElementById('overlay')), 'overlay with aria-label').toBe(true);
    expect(isInteractive(result, document.getElementById('phone')), 'phone input').toBe(true);
  });
});

