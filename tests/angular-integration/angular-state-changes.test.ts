/**
 * Integration tests: Angular components + dom-processor serializer
 *
 * Verifies that getDOMState() correctly handles DOM produced by Angular —
 * standalone components, conditional rendering (@if), dynamic class bindings —
 * which can't be replicated with static innerHTML strings.
 */

import { Component } from '@angular/core';
import { fireEvent, render } from '@testing-library/angular';
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
// Standalone components — uses Angular 17+ built-in control flow (@if, @for)
// to avoid NgModule import issues in vitest + happy-dom.
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  template: `
    <button id="save">Save</button>
    <button id="cancel">Cancel</button>
  `,
})
class ButtonBarComponent {}

@Component({
  standalone: true,
  template: `
    <input id="email" type="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Password" />
    <button id="submit" type="submit">Log in</button>
  `,
})
class LoginFormComponent {}

@Component({
  standalone: true,
  template: `
    <button id="toggle" (click)="open = !open">Options</button>
    @if (open) {
      <ul>
        <li><a id="opt1" href="#">Edit</a></li>
        <li><a id="opt2" href="#">Delete</a></li>
      </ul>
    }
  `,
})
class DropdownComponent {
  open = false;
}

@Component({
  standalone: true,
  template: `
    <div class="card" style="cursor: pointer">
      <div id="image-wrapper" class="card__image"></div>
      <div class="card__body">
        <button id="buy">Buy now</button>
      </div>
    </div>
  `,
})
class ProductCardComponent {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dom-processor: Angular-rendered DOM', () => {
  describe('basic interactive elements', () => {
    it('detects buttons rendered by Angular as interactive', async () => {
      await render(ButtonBarComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('save'))).toBe(true);
      expect(isInteractive(result, document.getElementById('cancel'))).toBe(true);
    });

    it('detects form inputs and submit button as interactive', async () => {
      await render(LoginFormComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('email'))).toBe(true);
      expect(isInteractive(result, document.getElementById('password'))).toBe(true);
      expect(isInteractive(result, document.getElementById('submit'))).toBe(true);
    });
  });

  describe('conditional rendering (@if)', () => {
    it('does NOT include hidden menu items before dropdown opens', async () => {
      await render(DropdownComponent);
      const result = scan();
      expect(document.getElementById('opt1')).toBeNull();
      expect(isInteractive(result, document.getElementById('toggle'))).toBe(true);
    });

    it('detects menu links after Angular renders them via @if', async () => {
      const { getByRole, detectChanges } = await render(DropdownComponent);
      fireEvent.click(getByRole('button', { name: 'Options' }));
      detectChanges();
      const result = scan();
      expect(isInteractive(result, document.getElementById('opt1'))).toBe(true);
      expect(isInteractive(result, document.getElementById('opt2'))).toBe(true);
    });
  });

  describe('cursor:pointer inheritance in Angular component trees', () => {
    it('marks the button inside a cursor:pointer card as interactive', async () => {
      await render(ProductCardComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('buy'))).toBe(true);
    });

    it('does NOT mark an empty image wrapper div inside a cursor:pointer card as interactive', async () => {
      // Empty div: no text, no aria, no children → no independent signal → suppressed.
      await render(ProductCardComponent);
      const result = scan();
      expect(isInteractive(result, document.getElementById('image-wrapper'))).toBe(false);
    });
  });
});
