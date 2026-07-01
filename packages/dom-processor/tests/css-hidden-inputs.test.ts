/**
 * Tests for CSS-hidden checkbox/radio detection in the DOM serializer.
 *
 * Design systems frequently hide the native <input> (checkbox or radio) and
 * render a styled custom control via a sibling or parent <label> using
 * ::before/::after pseudo-elements. The serializer must detect these and
 * surface the native input as interactive, while ignoring truly invisible
 * inputs (honeypot/bot-trap fields).
 *
 * Label association patterns tested:
 *   A) Parent label wraps the hidden input
 *   B) Input followed by adjacent label (CSS `input + label`)
 *   C) Label with `for=id` anywhere among siblings (any distance)
 *   D) Input preceded by adjacent label (CSS `label + input`)
 *
 * Input types: checkbox and radio (toggles, switches, ratings, pickers).
 * Hiding methods: opacity:0 with collapsed size, sr-only, visibility:hidden.
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

// ─────────────────────────────────────────────────────────────────────────────
// CHECKBOX — should be surfaced (visible label exists)
// ─────────────────────────────────────────────────────────────────────────────

describe('Checkbox: hidden input with visible label → interactive', () => {

  it('Pattern B — adjacent next label (no for attr, pure CSS proximity)', () => {
    document.body.innerHTML = `
      <style>
        .custom-cb { opacity: 0; width: 0; height: 0; position: absolute; }
        .custom-cb + label { display: inline-flex; align-items: center; cursor: pointer; }
        .custom-cb + label::before {
          content: ''; display: inline-block;
          width: 18px; height: 18px; border: 2px solid #999;
          border-radius: 3px; margin-right: 8px;
        }
        .custom-cb:checked + label::before { background: #1a73e8; border-color: #1a73e8; }
      </style>
      <div>
        <input type="checkbox" class="custom-cb" id="accept">
        <label>Accept Terms and Conditions</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('accept'))).toBe(true);
  });

  it('Pattern B — adjacent next label with matching for attr', () => {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="newsletter" style="opacity:0; width:0; height:0; position:absolute">
        <label for="newsletter" style="cursor:pointer; display:inline-block">
          Subscribe to newsletter
        </label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('newsletter'))).toBe(true);
  });

  it('Pattern A — parent label wraps hidden input (toggle switch)', () => {
    document.body.innerHTML = `
      <style>
        .switch { display: inline-flex; align-items: center; cursor: pointer; }
        .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .thumb { width: 40px; height: 24px; background: #ccc; border-radius: 12px; }
        .switch input:checked + .thumb { background: #4ade80; }
      </style>
      <label class="switch">
        <input type="checkbox" id="dark-mode">
        <span class="thumb"></span>
      </label>
    `;
    expect(isInteractive(scan(), document.getElementById('dark-mode'))).toBe(true);
  });

  it('Pattern A — parent label wraps hidden input (feature toggle with text)', () => {
    document.body.innerHTML = `
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer">
        <input type="checkbox" id="notifications" style="opacity:0; width:1px; height:1px; position:absolute">
        <span style="width:32px; height:20px; background:#e2e8f0; border-radius:10px"></span>
        <span>Enable notifications</span>
      </label>
    `;
    expect(isInteractive(scan(), document.getElementById('notifications'))).toBe(true);
  });

  it('Pattern C — non-adjacent sibling label (help text between input and label)', () => {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="terms" style="opacity:0; width:0; height:0; position:absolute">
        <span style="font-size:12px; color:#666">Read our <a href="#">Privacy Policy</a> first.</span>
        <label for="terms" style="cursor:pointer">I accept</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('terms'))).toBe(true);
  });

  it('Pattern D — adjacent previous label (CSS `label + input` ordering)', () => {
    document.body.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px">
        <label for="compact" style="cursor:pointer">Compact view</label>
        <input type="checkbox" id="compact" style="opacity:0; width:0; height:0; position:absolute">
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('compact'))).toBe(true);
  });

  it('Pattern C — label before input at a distance, via for attr', () => {
    document.body.innerHTML = `
      <div>
        <label for="gdpr" style="font-weight:600; cursor:pointer">GDPR consent</label>
        <p style="font-size:13px; margin:4px 0">We use your data to improve our service.</p>
        <input type="checkbox" id="gdpr" style="opacity:0; width:0; height:0; position:absolute">
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('gdpr'))).toBe(true);
  });

  it('sr-only hidden input (absolute 1px × 1px + opacity:0)', () => {
    document.body.innerHTML = `
      <style>
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; opacity: 0; }
        .checkbox-card { display: inline-block; padding: 12px 20px; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; }
        .sr-only:checked + .checkbox-card { border-color: #6366f1; background: #eef2ff; }
      </style>
      <div>
        <input type="checkbox" id="plan-basic" class="sr-only">
        <label for="plan-basic" class="checkbox-card">Basic plan</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('plan-basic'))).toBe(true);
  });

  it('visibility:hidden input with adjacent label', () => {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="viz" style="visibility:hidden; position:absolute; width:0; height:0">
        <label for="viz" style="cursor:pointer">Visible label</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('viz'))).toBe(true);
  });

  it('multiple checkboxes with their own labels in a group', () => {
    document.body.innerHTML = `
      <style>
        .filter-cb { opacity:0; width:0; height:0; position:absolute; }
        .filter-cb + label { display:block; padding:6px 0; cursor:pointer; }
        .filter-cb + label::before {
          content:''; display:inline-block; width:14px; height:14px;
          border:1.5px solid #94a3b8; border-radius:2px; margin-right:6px; vertical-align:middle;
        }
        .filter-cb:checked + label::before { background:#6366f1; border-color:#6366f1; }
      </style>
      <fieldset>
        <input type="checkbox" class="filter-cb" id="f-red">
        <label for="f-red">Red</label>
        <input type="checkbox" class="filter-cb" id="f-green">
        <label for="f-green">Green</label>
        <input type="checkbox" class="filter-cb" id="f-blue">
        <label for="f-blue">Blue</label>
      </fieldset>
    `;
    const result = scan();
    ['f-red', 'f-green', 'f-blue'].forEach(id => {
      expect(isInteractive(result, document.getElementById(id))).toBe(true);
    });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// RADIO — should be surfaced (visible label exists)
// ─────────────────────────────────────────────────────────────────────────────

describe('Radio: hidden input with visible label → interactive', () => {

  it('Plan/tier selector — hidden radios with styled card labels', () => {
    document.body.innerHTML = `
      <style>
        .plan-radio { opacity:0; position:absolute; width:0; height:0; }
        .plan-card { display:inline-block; padding:16px 24px; border:2px solid #e2e8f0; border-radius:8px; cursor:pointer; }
        .plan-radio:checked + .plan-card { border-color:#6366f1; background:#eef2ff; }
      </style>
      <div>
        <input type="radio" id="plan-free" name="plan" class="plan-radio">
        <label for="plan-free" class="plan-card">Free — $0/mo</label>
        <input type="radio" id="plan-pro" name="plan" class="plan-radio">
        <label for="plan-pro" class="plan-card">Pro — $29/mo</label>
        <input type="radio" id="plan-ent" name="plan" class="plan-radio">
        <label for="plan-ent" class="plan-card">Enterprise — custom</label>
      </div>
    `;
    const result = scan();
    ['plan-free', 'plan-pro', 'plan-ent'].forEach(id => {
      expect(isInteractive(result, document.getElementById(id))).toBe(true);
    });
  });

  it('Star rating — hidden radios, symbol labels', () => {
    document.body.innerHTML = `
      <style>
        .star-input { opacity:0; position:absolute; width:0; height:0; }
        .star-label { display:inline-block; font-size:24px; cursor:pointer; color:#cbd5e1; }
      </style>
      <div style="direction:rtl; display:inline-flex">
        <input type="radio" id="s5" name="rating" value="5" class="star-input">
        <label for="s5" class="star-label">★</label>
        <input type="radio" id="s4" name="rating" value="4" class="star-input">
        <label for="s4" class="star-label">★</label>
        <input type="radio" id="s3" name="rating" value="3" class="star-input">
        <label for="s3" class="star-label">★</label>
      </div>
    `;
    const result = scan();
    ['s5', 's4', 's3'].forEach(id => {
      expect(isInteractive(result, document.getElementById(id))).toBe(true);
    });
  });

  it('Color swatch picker — hidden radios, colored-square labels', () => {
    document.body.innerHTML = `
      <style>
        .color-radio { opacity:0; position:absolute; width:0; height:0; }
        .swatch { display:inline-block; width:28px; height:28px; border-radius:50%; cursor:pointer; border:2px solid transparent; }
        .color-radio:checked + .swatch { border-color:#000; }
      </style>
      <div style="display:flex; gap:8px">
        <input type="radio" id="color-red"   name="color" class="color-radio">
        <label for="color-red"   class="swatch" style="background:#ef4444"></label>
        <input type="radio" id="color-blue"  name="color" class="color-radio">
        <label for="color-blue"  class="swatch" style="background:#3b82f6"></label>
        <input type="radio" id="color-black" name="color" class="color-radio">
        <label for="color-black" class="swatch" style="background:#1f2937"></label>
      </div>
    `;
    const result = scan();
    ['color-red', 'color-blue', 'color-black'].forEach(id => {
      expect(isInteractive(result, document.getElementById(id))).toBe(true);
    });
  });

  it('Size picker — hidden radios, text-button labels', () => {
    document.body.innerHTML = `
      <style>
        .size-radio { opacity:0; position:absolute; width:0; height:0; }
        .size-btn { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border:1.5px solid #e2e8f0; border-radius:6px; cursor:pointer; }
        .size-radio:checked + .size-btn { border-color:#1f2937; font-weight:700; }
      </style>
      <div style="display:flex; gap:6px">
        <input type="radio" id="sz-s" name="size" class="size-radio"><label for="sz-s" class="size-btn">S</label>
        <input type="radio" id="sz-m" name="size" class="size-radio"><label for="sz-m" class="size-btn">M</label>
        <input type="radio" id="sz-l" name="size" class="size-radio"><label for="sz-l" class="size-btn">L</label>
        <input type="radio" id="sz-xl" name="size" class="size-radio"><label for="sz-xl" class="size-btn">XL</label>
      </div>
    `;
    const result = scan();
    ['sz-s', 'sz-m', 'sz-l', 'sz-xl'].forEach(id => {
      expect(isInteractive(result, document.getElementById(id))).toBe(true);
    });
  });

  it('Radio inside parent label (no for attr needed)', () => {
    document.body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:8px; border:1px solid #e2e8f0; border-radius:6px">
          <input type="radio" id="opt-a" name="option" style="opacity:0; width:0; height:0; position:absolute">
          <span style="width:16px; height:16px; border:2px solid #94a3b8; border-radius:50%"></span>
          <span>Option A</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:8px; border:1px solid #e2e8f0; border-radius:6px">
          <input type="radio" id="opt-b" name="option" style="opacity:0; width:0; height:0; position:absolute">
          <span style="width:16px; height:16px; border:2px solid #94a3b8; border-radius:50%"></span>
          <span>Option B</span>
        </label>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('opt-a'))).toBe(true);
    expect(isInteractive(result, document.getElementById('opt-b'))).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// HONEYPOT / truly invisible — must NOT be surfaced
// ─────────────────────────────────────────────────────────────────────────────

describe('Truly invisible inputs — must NOT be surfaced', () => {

  it('hidden checkbox with no label (bot-trap field)', () => {
    document.body.innerHTML = `
      <form>
        <label for="name">Name</label>
        <input type="text" id="name" placeholder="Your name">
        <input type="checkbox" id="trap" name="contact_me_by_fax_only"
               tabindex="-1" style="opacity:0; position:absolute; left:-9999px; top:-9999px">
        <button type="submit">Send</button>
      </form>
    `;
    expect(isInteractive(scan(), document.getElementById('trap'))).toBe(false);
  });

  it('hidden checkbox with adjacent label that is also hidden', () => {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="hidden-cb" style="opacity:0; width:0; height:0">
        <label for="hidden-cb" style="opacity:0; pointer-events:none">Hidden label</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('hidden-cb'))).toBe(false);
  });

  it("adjacent label's for= points to a different element — no association", () => {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="cb-a" style="opacity:0; width:0; height:0; position:absolute">
        <label for="cb-b" style="cursor:pointer">Label for cb-b</label>
        <input type="checkbox" id="cb-b">
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('cb-a'))).toBe(false);
  });

  it('hidden checkbox with visible label in a separate DOM branch (not a sibling)', () => {
    document.body.innerHTML = `
      <div id="branch-a">
        <input type="checkbox" id="remote-cb" style="opacity:0; width:0; height:0">
      </div>
      <div id="branch-b">
        <label for="remote-cb" style="cursor:pointer">Label in another branch</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('remote-cb'))).toBe(false);
  });

  it('hidden radio with no label', () => {
    document.body.innerHTML = `
      <input type="radio" id="ghost" name="g" style="opacity:0; position:absolute; width:0; height:0">
    `;
    expect(isInteractive(scan(), document.getElementById('ghost'))).toBe(false);
  });

  it('hidden text input with visible label — fix does not apply (checkbox/radio only)', () => {
    document.body.innerHTML = `
      <div>
        <input type="text" id="autofill" style="opacity:0; width:0; height:0; position:absolute">
        <label for="autofill" style="cursor:pointer">Username</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('autofill'))).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — standard visible elements must still work
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression — standard visible form elements', () => {

  it('visible checkbox with label', () => {
    document.body.innerHTML = `
      <div>
        <input type="checkbox" id="remember">
        <label for="remember">Remember me</label>
      </div>
    `;
    expect(isInteractive(scan(), document.getElementById('remember'))).toBe(true);
  });

  it('visible radio group', () => {
    document.body.innerHTML = `
      <div>
        <input type="radio" id="yes" name="q"><label for="yes">Yes</label>
        <input type="radio" id="no"  name="q"><label for="no">No</label>
      </div>
    `;
    const result = scan();
    expect(isInteractive(result, document.getElementById('yes'))).toBe(true);
    expect(isInteractive(result, document.getElementById('no'))).toBe(true);
  });

  it('visible text input', () => {
    document.body.innerHTML = `
      <label for="email">Email</label>
      <input type="text" id="email" placeholder="you@example.com">
    `;
    expect(isInteractive(scan(), document.getElementById('email'))).toBe(true);
  });

  it('visible submit button', () => {
    document.body.innerHTML = `<button type="submit" id="btn">Submit</button>`;
    expect(isInteractive(scan(), document.getElementById('btn'))).toBe(true);
  });

});
