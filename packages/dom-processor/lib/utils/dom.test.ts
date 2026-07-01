import { querySelector, querySelectorAll, simulateTyping } from './dom.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('querySelector (polling)', () => {
  it('resolves an element that is already present', async () => {
    document.body.innerHTML = '<button id="go">Go</button>';
    const el = await querySelector<HTMLButtonElement>('#go', 1000, { interval: 10 });
    expect(el?.id).toBe('go');
  });

  it('resolves an element that appears after a delay', async () => {
    const p = querySelector<HTMLDivElement>('#late', 1000, { interval: 10 });
    setTimeout(() => {
      document.body.innerHTML = '<div id="late"></div>';
    }, 30);
    expect((await p)?.id).toBe('late');
  });

  it('resolves null after the timeout when nothing matches', async () => {
    const el = await querySelector('#never', 40, { interval: 10 });
    expect(el).toBeNull();
  });
});

describe('querySelectorAll (polling)', () => {
  it('resolves a non-empty NodeList', async () => {
    document.body.innerHTML = '<a class="x"></a><a class="x"></a>';
    const els = await querySelectorAll<HTMLAnchorElement>('.x', 1000, { interval: 10 });
    expect(els?.length).toBe(2);
  });

  it('resolves null when none match before timeout', async () => {
    expect(await querySelectorAll('.none', 40, { interval: 10 })).toBeNull();
  });
});

describe('simulateTyping', () => {
  it('sets an input value and fires input/change', () => {
    document.body.innerHTML = '<input id="f" />';
    const input = document.getElementById('f') as HTMLInputElement;
    const onInput = vi.fn();
    const onChange = vi.fn();
    input.addEventListener('input', onInput);
    input.addEventListener('change', onChange);

    simulateTyping(input, 'hello');

    expect(input.value).toBe('hello');
    expect(onInput).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('sets textContent for a contenteditable element', () => {
    document.body.innerHTML = '<div id="ce" contenteditable="true"></div>';
    const ce = document.getElementById('ce') as HTMLElement;
    const onInput = vi.fn();
    ce.addEventListener('input', onInput);

    simulateTyping(ce, 'typed text');

    expect(ce.textContent).toBe('typed text');
    expect(onInput).toHaveBeenCalled();
  });

  it('no-ops on a null element', () => {
    expect(() => simulateTyping(null as unknown as HTMLElement, 'x')).not.toThrow();
  });
});
