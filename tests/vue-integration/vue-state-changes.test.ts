/**
 * Integration tests: Vue components + dom-processor serializer
 *
 * Verifies that getDOMState() correctly handles DOM produced by Vue 3 —
 * reactive state changes, v-if/v-show conditional rendering, event bindings —
 * which can't be replicated with static innerHTML strings.
 */

import { defineComponent, ref } from 'vue';
import { render } from '@testing-library/vue';
import { afterEach, describe, expect, it } from 'vitest';
import { getDOMState } from '@doeverything/dom-processor';
import type { DOMStateResult } from '@doeverything/dom-processor';

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
// Components used across tests
// ---------------------------------------------------------------------------

const ButtonBarComponent = defineComponent({
  template: `
    <button id="save">Save</button>
    <button id="cancel">Cancel</button>
  `,
});

const LoginFormComponent = defineComponent({
  setup() {
    const showError = ref(false);
    return { showError };
  },
  template: `
    <input id="email" type="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Password" />
    <span id="error" v-if="showError">Invalid credentials</span>
    <button id="submit" type="submit">Log in</button>
  `,
});

const DropdownComponent = defineComponent({
  setup() {
    const open = ref(false);
    return { open };
  },
  template: `
    <button id="toggle" @click="open = !open">Options</button>
    <ul v-if="open">
      <li><a id="opt1" href="#">Edit</a></li>
      <li><a id="opt2" href="#">Delete</a></li>
    </ul>
  `,
});

const ProductCardComponent = defineComponent({
  template: `
    <div class="card" style="cursor: pointer">
      <div id="image-wrapper" class="card__image"></div>
      <div class="card__body">
        <button id="buy">Buy now</button>
      </div>
    </div>
  `,
});

const VShowComponent = defineComponent({
  setup() {
    const visible = ref(false);
    return { visible };
  },
  template: `
    <button id="toggle" @click="visible = !visible">Toggle panel</button>
    <div id="panel" v-show="visible">
      <button id="action">Do something</button>
    </div>
  `,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dom-processor: Vue-rendered DOM', () => {
  describe('basic interactive elements', () => {
    it('detects buttons rendered by Vue as interactive', () => {
      render(ButtonBarComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('save'))).toBe(true);
      expect(isInteractive(result, document.getElementById('cancel'))).toBe(true);
    });

    it('detects form inputs and submit button as interactive', () => {
      render(LoginFormComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('email'))).toBe(true);
      expect(isInteractive(result, document.getElementById('password'))).toBe(true);
      expect(isInteractive(result, document.getElementById('submit'))).toBe(true);
    });

    it('does NOT mark a static error span as interactive', async () => {
      const { getByText, rerender } = render(LoginFormComponent);
      // Trigger showError state
      await rerender({ showError: true });
      const result = scan();
      expect(isInteractive(result, document.getElementById('error'))).toBe(false);
    });
  });

  describe('conditional rendering (v-if)', () => {
    it('does NOT include hidden menu items before dropdown opens', () => {
      render(DropdownComponent);
      const result = scan();
      expect(document.getElementById('opt1')).toBeNull();
      expect(isInteractive(result, document.getElementById('toggle'))).toBe(true);
    });

    it('detects menu links after Vue renders them via v-if', async () => {
      const { getByRole } = render(DropdownComponent);
      await getByRole('button', { name: 'Options' }).click();
      const result = scan();
      expect(isInteractive(result, document.getElementById('opt1'))).toBe(true);
      expect(isInteractive(result, document.getElementById('opt2'))).toBe(true);
    });
  });

  describe('v-show visibility (element stays in DOM, display toggled)', () => {
    it('detects an element inside a v-show=false panel as present but hidden', async () => {
      render(VShowComponent);
      const result = scan();
      // Panel is hidden (display:none) — bbox filtering off, so it may appear
      // The toggle button is always interactive
      expect(isInteractive(result, document.getElementById('toggle'))).toBe(true);
    });

    it('detects panel content as interactive after v-show reveals it', async () => {
      const { getByRole } = render(VShowComponent);
      await getByRole('button', { name: 'Toggle panel' }).click();
      const result = scan();
      expect(isInteractive(result, document.getElementById('action'))).toBe(true);
    });
  });

  describe('cursor:pointer inheritance in Vue component trees', () => {
    it('marks the button inside a cursor:pointer card as interactive', () => {
      render(ProductCardComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('buy'))).toBe(true);
    });

    it('does NOT mark an empty image wrapper div inside a cursor:pointer card as interactive', () => {
      // Empty div: no text, no aria, no children → no independent signal → suppressed.
      // (Leaf + non-zero bounds would pass, but happy-dom always returns 0×0.)
      render(ProductCardComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('image-wrapper'))).toBe(false);
    });
  });
});
