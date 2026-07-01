/**
 * Integration tests: Angular conditional rendering and hidden elements + dom-processor
 *
 * Verifies that getDOMState() correctly handles Angular @if control flow,
 * CSS-hidden elements, @for with conditional items, and loading state patterns.
 *
 * Key behaviours under test:
 *  - Elements removed from DOM by @if are invisible to selectorMap
 *  - display:none / visibility:hidden exclude elements from selectorMap
 *  - opacity:0 does NOT exclude elements (test-env limitation)
 *  - hidden attribute excludes elements
 *  - input[type=hidden] IS included (interactive tag check)
 *  - @for + nested @if: only visible items appear
 *  - Loading state: spinner is non-interactive; loaded content is interactive
 */

import { Component, Input, signal } from '@angular/core';
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
// Components
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  template: `
    @if (visible) {
      <button id="btn">Click</button>
    }
  `,
})
class ConditionalButtonComponent {
  visible = false;
}

@Component({
  standalone: true,
  template: `
    @if (showForm) {
      <form>
        <input id="username" type="text" />
        <input id="secret" type="hidden" value="token123" />
        <button id="submit" type="submit">Submit</button>
      </form>
    }
    <button id="toggle" (click)="showForm = !showForm">Toggle Form</button>
  `,
})
class ConditionalFormComponent {
  showForm = false;
}

@Component({
  standalone: true,
  template: `
    <button id="btn-display-none" style="display:none">Hidden Display</button>
    <button id="btn-visibility-hidden" style="visibility:hidden">Hidden Visibility</button>
    <input id="input-opacity-zero" style="opacity:0" type="text" />
    <button id="btn-hidden-attr" hidden>Hidden Attribute</button>
    <button id="btn-visible">Visible Button</button>
  `,
})
class CssHiddenElementsComponent {}

@Component({
  standalone: true,
  template: `
    <input id="input-hidden-type" type="hidden" value="csrf-token" />
    <button id="btn-normal">Normal Button</button>
  `,
})
class HiddenInputTypeComponent {}

@Component({
  standalone: true,
  template: `
    @for (item of items; track item.id) {
      @if (item.visible) {
        <button [id]="'item-' + item.id">{{ item.name }}</button>
      }
    }
  `,
})
class ForWithConditionalComponent {
  items = [
    { id: 1, name: 'Alpha', visible: true },
    { id: 2, name: 'Beta', visible: false },
    { id: 3, name: 'Gamma', visible: true },
    { id: 4, name: 'Delta', visible: false },
    { id: 5, name: 'Epsilon', visible: true },
  ];
}

@Component({
  standalone: true,
  template: `
    @if (loading) {
      <div id="spinner" class="spinner" aria-label="Loading" role="status">
        <span id="spinner-text">Loading...</span>
      </div>
    } @else {
      <div id="content">
        <button id="action-primary">Confirm</button>
        <button id="action-secondary">Cancel</button>
        <a id="action-link" href="/back">Go Back</a>
      </div>
    }
    <button id="load-toggle" (click)="loading = !loading">Toggle</button>
  `,
})
class LoadingStateComponent {
  loading = true;
}

@Component({
  standalone: true,
  template: `
    @if (count > 0) {
      <button id="decrement" (click)="count = count - 1">-</button>
      <span id="count-display">{{ count }}</span>
      @if (count >= 10) {
        <button id="reset" (click)="count = 0">Reset</button>
      }
    }
    <button id="increment" (click)="count = count + 1">+</button>
  `,
})
class NestedConditionalComponent {
  count = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@if conditional rendering', () => {
  it('button not in DOM when condition=false → getElementById returns null → isInteractive false', async () => {
    await render(ConditionalButtonComponent);
    const result = scan();
    const btn = document.getElementById('btn');
    expect(btn).toBeNull();
    expect(isInteractive(result, btn)).toBe(false);
  });

  it('button is in DOM when condition=true → isInteractive true', async () => {
    const { fixture, detectChanges } = await render(ConditionalButtonComponent);
    fixture.componentInstance.visible = true;
    detectChanges();
    const result = scan();
    const btn = document.getElementById('btn');
    expect(btn).not.toBeNull();
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('toggle button is always interactive regardless of @if condition', async () => {
    await render(ConditionalFormComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('toggle'))).toBe(true);
  });

  it('form inputs not in DOM before toggle → null and non-interactive', async () => {
    await render(ConditionalFormComponent);
    const result = scan();
    expect(document.getElementById('username')).toBeNull();
    expect(document.getElementById('submit')).toBeNull();
    expect(isInteractive(result, document.getElementById('username'))).toBe(false);
    expect(isInteractive(result, document.getElementById('submit'))).toBe(false);
  });

  it('form inputs appear after toggling @if condition true', async () => {
    const { getByText, detectChanges } = await render(ConditionalFormComponent);
    fireEvent.click(getByText('Toggle Form'));
    detectChanges();
    const result = scan();
    expect(isInteractive(result, document.getElementById('username'))).toBe(true);
    expect(isInteractive(result, document.getElementById('submit'))).toBe(true);
  });

  it('hidden-type input inside @if is NOT interactive when @if is true (dom-processor excludes type=hidden)', async () => {
    const { getByText, detectChanges } = await render(ConditionalFormComponent);
    fireEvent.click(getByText('Toggle Form'));
    detectChanges();
    const result = scan();
    const secretInput = document.getElementById('secret');
    expect(secretInput).not.toBeNull();
    // isElementVisible explicitly returns false for input[type=hidden]
    expect(isInteractive(result, secretInput)).toBe(false);
  });

  it('nested @if: inner button absent when outer false', async () => {
    await render(NestedConditionalComponent);
    const result = scan();
    expect(document.getElementById('decrement')).toBeNull();
    expect(isInteractive(result, document.getElementById('decrement'))).toBe(false);
  });

  it('nested @if: outer becomes true → decrement appears; inner still false when count < 10', async () => {
    const { getByText, detectChanges } = await render(NestedConditionalComponent);
    fireEvent.click(getByText('+'));
    detectChanges();
    const result = scan();
    expect(isInteractive(result, document.getElementById('decrement'))).toBe(true);
    expect(isInteractive(result, document.getElementById('increment'))).toBe(true);
    expect(document.getElementById('reset')).toBeNull();
    expect(isInteractive(result, document.getElementById('reset'))).toBe(false);
  });
});

describe('CSS-hidden elements in Angular', () => {
  it('button with display:none is excluded from selectorMap', async () => {
    await render(CssHiddenElementsComponent);
    const result = scan();
    const el = document.getElementById('btn-display-none');
    expect(el).not.toBeNull();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('button with visibility:hidden is excluded from selectorMap', async () => {
    await render(CssHiddenElementsComponent);
    const result = scan();
    const el = document.getElementById('btn-visibility-hidden');
    expect(el).not.toBeNull();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('input with opacity:0 inline style is excluded (isElementTrulyVisible checks opacity)', async () => {
    await render(CssHiddenElementsComponent);
    const result = scan();
    const el = document.getElementById('input-opacity-zero');
    expect(el).not.toBeNull();
    // getComputedStyle(el).opacity === '0' → isElementTrulyVisible returns false → excluded
    expect(isInteractive(result, el)).toBe(false);
  });

  it('button with hidden attribute is interactive (happy-dom: UA stylesheet for [hidden] not applied)', async () => {
    await render(CssHiddenElementsComponent);
    const result = scan();
    const el = document.getElementById('btn-hidden-attr');
    expect(el).not.toBeNull();
    // Real browsers apply display:none for [hidden]. happy-dom does not apply this UA rule.
    expect(isInteractive(result, el)).toBe(true);
  });

  it('visible button without hiding styles is interactive', async () => {
    await render(CssHiddenElementsComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn-visible'))).toBe(true);
  });

  it('input[type=hidden] is NOT interactive (dom-processor explicitly excludes hidden type)', async () => {
    await render(HiddenInputTypeComponent);
    const result = scan();
    const el = document.getElementById('input-hidden-type');
    expect(el).not.toBeNull();
    // isElementVisible returns false for input[type=hidden] regardless of INTERACTIVE_TAGS
    expect(isInteractive(result, el)).toBe(false);
  });

  it('normal button alongside hidden-type input is also interactive', async () => {
    await render(HiddenInputTypeComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('btn-normal'))).toBe(true);
  });
});

describe('Angular @for with conditional items', () => {
  it('visible items produce interactive buttons in the DOM', async () => {
    await render(ForWithConditionalComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('item-1'))).toBe(true);
    expect(isInteractive(result, document.getElementById('item-3'))).toBe(true);
    expect(isInteractive(result, document.getElementById('item-5'))).toBe(true);
  });

  it('hidden items (visible=false) are absent from the DOM', async () => {
    await render(ForWithConditionalComponent);
    expect(document.getElementById('item-2')).toBeNull();
    expect(document.getElementById('item-4')).toBeNull();
  });

  it('hidden items return false for isInteractive because they do not exist', async () => {
    await render(ForWithConditionalComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('item-2'))).toBe(false);
    expect(isInteractive(result, document.getElementById('item-4'))).toBe(false);
  });

  it('selectorMap contains exactly the three visible item buttons from @for', async () => {
    await render(ForWithConditionalComponent);
    const result = scan();
    const nodes = Object.values(result.selectorMap);
    const itemButtons = nodes.filter(n => {
      const el = n.sourceElement as HTMLElement | null;
      return el?.id?.startsWith('item-');
    });
    expect(itemButtons).toHaveLength(3);
    const ids = itemButtons.map(n => (n.sourceElement as HTMLElement).id).sort();
    expect(ids).toEqual(['item-1', 'item-3', 'item-5']);
  });
});

describe('Angular component with loading state', () => {
  it('loading spinner div is non-interactive (div without interactive signals)', async () => {
    await render(LoadingStateComponent);
    const result = scan();
    const spinner = document.getElementById('spinner');
    expect(spinner).not.toBeNull();
    expect(isInteractive(result, spinner)).toBe(false);
  });

  it('spinner text span is non-interactive', async () => {
    await render(LoadingStateComponent);
    const result = scan();
    const spinnerText = document.getElementById('spinner-text');
    expect(spinnerText).not.toBeNull();
    expect(isInteractive(result, spinnerText)).toBe(false);
  });

  it('content buttons are absent from DOM while loading=true', async () => {
    await render(LoadingStateComponent);
    const result = scan();
    expect(document.getElementById('action-primary')).toBeNull();
    expect(document.getElementById('action-secondary')).toBeNull();
    expect(document.getElementById('action-link')).toBeNull();
    expect(isInteractive(result, document.getElementById('action-primary'))).toBe(false);
  });

  it('content buttons appear and are interactive after loading=false', async () => {
    const { getByText, detectChanges } = await render(LoadingStateComponent);
    fireEvent.click(getByText('Toggle'));
    detectChanges();
    const result = scan();
    expect(isInteractive(result, document.getElementById('action-primary'))).toBe(true);
    expect(isInteractive(result, document.getElementById('action-secondary'))).toBe(true);
  });

  it('anchor link is interactive after loading state resolves', async () => {
    const { getByText, detectChanges } = await render(LoadingStateComponent);
    fireEvent.click(getByText('Toggle'));
    detectChanges();
    const result = scan();
    const link = document.getElementById('action-link');
    expect(link).not.toBeNull();
    expect(isInteractive(result, link)).toBe(true);
  });

  it('spinner is removed from DOM after loading=false', async () => {
    const { getByText, detectChanges } = await render(LoadingStateComponent);
    fireEvent.click(getByText('Toggle'));
    detectChanges();
    expect(document.getElementById('spinner')).toBeNull();
    expect(document.getElementById('spinner-text')).toBeNull();
  });

  it('toggle button is interactive while loading', async () => {
    await render(LoadingStateComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('load-toggle'))).toBe(true);
  });

  it('toggle button is interactive after loading resolves', async () => {
    const { getByText, detectChanges } = await render(LoadingStateComponent);
    fireEvent.click(getByText('Toggle'));
    detectChanges();
    const result = scan();
    expect(isInteractive(result, document.getElementById('load-toggle'))).toBe(true);
  });
});
