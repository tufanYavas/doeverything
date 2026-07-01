import { isElementTrulyVisible } from './visibility.js';
import { afterEach, describe, expect, it } from 'vitest';

function add(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isElementTrulyVisible', () => {
  it('treats a plain attached element as visible', () => {
    expect(isElementTrulyVisible(add('<div>hi</div>'))).toBe(true);
  });

  it('is false for display:none', () => {
    expect(isElementTrulyVisible(add('<div style="display:none">x</div>'))).toBe(false);
  });

  it('is false for visibility:hidden', () => {
    expect(isElementTrulyVisible(add('<div style="visibility:hidden">x</div>'))).toBe(false);
  });

  it('is false for opacity:0', () => {
    expect(isElementTrulyVisible(add('<div style="opacity:0">x</div>'))).toBe(false);
  });

  it('is visible for a zero-size but painted box (Python does not filter on size)', () => {
    expect(isElementTrulyVisible(add('<span></span>'))).toBe(true);
  });

  it('returns false for non-element nodes', () => {
    const textNode = document.createTextNode('hi');
    expect(isElementTrulyVisible(textNode as unknown as Element)).toBe(false);
  });
});
