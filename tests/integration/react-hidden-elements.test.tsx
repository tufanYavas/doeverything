import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDOMState } from '@doeverything/dom-processor';
import type { DOMStateResult } from '@doeverything/dom-processor';

afterEach(() => { document.body.innerHTML = ''; });

function scan(): DOMStateResult {
  return getDOMState(null, { viewportExpansion: null, enableBboxFiltering: false });
}

function isInteractive(result: DOMStateResult, el: Element | null): boolean {
  if (!el) return false;
  return Object.values(result.selectorMap).some(n => n.sourceElement === el);
}

describe('display:none excludes elements from detection', () => {
  it('button inside display:none container is interactive (happy-dom does not cascade display:none to children)', () => {
    document.body.innerHTML = '<div style="display:none"><button>X</button></div>';
    const result = scan();
    const btn = document.querySelector('button');
    // happy-dom limitation: getComputedStyle on child does not inherit parent display:none
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('button with display:none directly applied is not interactive', () => {
    document.body.innerHTML = '<button style="display:none">Hidden</button>';
    const result = scan();
    const btn = document.querySelector('button');
    expect(isInteractive(result, btn)).toBe(false);
  });

  it('input with display:none is not interactive', () => {
    document.body.innerHTML = '<input type="text" style="display:none">';
    const result = scan();
    const input = document.querySelector('input');
    expect(isInteractive(result, input)).toBe(false);
  });

  it('React conditional rendering — element not in DOM when condition is false', () => {
    function ConditionalButton() {
      const [show] = useState(false);
      return show ? <button>Conditional</button> : null;
    }
    render(<ConditionalButton />);
    const result = scan();
    const btn = document.querySelector('button');
    // Element doesn't exist in DOM at all
    expect(btn).toBeNull();
    expect(isInteractive(result, btn)).toBe(false);
  });
});

describe('visibility:hidden excludes elements', () => {
  it('button with visibility:hidden is not interactive', () => {
    document.body.innerHTML = '<button style="visibility:hidden">Hidden</button>';
    const result = scan();
    const btn = document.querySelector('button');
    expect(isInteractive(result, btn)).toBe(false);
  });

  it('input with visibility:hidden is not interactive', () => {
    document.body.innerHTML = '<input type="text" style="visibility:hidden">';
    const result = scan();
    const input = document.querySelector('input');
    expect(isInteractive(result, input)).toBe(false);
  });
});

describe('Opacity-zero and zero-size inputs', () => {
  it('CSS-hidden checkbox with opacity:0 is excluded (isElementTrulyVisible excludes opacity:0)', () => {
    document.body.innerHTML = '<input type="checkbox" style="opacity:0;width:0;height:0;position:absolute">';
    const result = scan();
    const input = document.querySelector('input');
    // isElementTrulyVisible checks opacity via getComputedStyle — opacity:0 excludes the element
    expect(isInteractive(result, input)).toBe(false);
  });

  it('CSS-hidden radio with opacity:0 is excluded (same opacity rule)', () => {
    document.body.innerHTML = '<input type="radio" style="opacity:0;position:absolute;width:1px;height:1px">';
    const result = scan();
    const input = document.querySelector('input');
    expect(isInteractive(result, input)).toBe(false);
  });

  it('text input with clip rect and absolute position is still interactive', () => {
    document.body.innerHTML = '<input type="text" style="clip:rect(0,0,0,0);position:absolute">';
    const result = scan();
    const input = document.querySelector('input');
    expect(isInteractive(result, input)).toBe(true);
  });
});

describe('aria-hidden attribute', () => {
  it('button inside aria-hidden container is still detected (aria-hidden does not affect CSS visibility)', () => {
    document.body.innerHTML = '<div aria-hidden="true"><button>X</button></div>';
    const result = scan();
    const btn = document.querySelector('button');
    // aria-hidden hides from screen readers but NOT from DOM traversal in happy-dom
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('button with aria-hidden="true" directly applied is excluded (happy-dom checkVisibility respects aria-hidden)', () => {
    document.body.innerHTML = '<button aria-hidden="true">Hidden from AT</button>';
    const result = scan();
    const btn = document.querySelector('button');
    // happy-dom's checkVisibility({visibilityProperty:true}) returns false for aria-hidden="true"
    // In a real browser this would be interactive (aria-hidden only affects AT, not CSS visibility)
    expect(isInteractive(result, btn)).toBe(false);
  });
});

describe('hidden HTML attribute', () => {
  it('button with hidden attribute is interactive (happy-dom does not apply UA display:none for [hidden])', () => {
    document.body.innerHTML = '<button hidden>Hidden</button>';
    const result = scan();
    const btn = document.querySelector('button');
    // In real browsers [hidden] maps to display:none. happy-dom UA stylesheet does not apply this.
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('button inside a hidden container is interactive (happy-dom: [hidden] cascade not applied)', () => {
    document.body.innerHTML = '<div hidden><button>X</button></div>';
    const result = scan();
    const btn = document.querySelector('button');
    expect(isInteractive(result, btn)).toBe(true);
  });
});

describe('input type=hidden', () => {
  it('input type=hidden is not interactive (dom-processor explicitly excludes it in isElementVisible)', () => {
    document.body.innerHTML = '<input type="hidden" value="secret">';
    const result = scan();
    const input = document.querySelector('input');
    // isElementVisible has explicit: if (element.type === 'hidden') return false
    // This takes precedence over INTERACTIVE_TAGS, so input[type=hidden] is never in selectorMap.
    expect(isInteractive(result, input)).toBe(false);
  });
});

describe('Off-screen positioning', () => {
  it('button positioned far off-screen is still interactive (not display:none)', () => {
    document.body.innerHTML = '<button style="position:absolute;left:-9999px;top:-9999px">Off-screen</button>';
    const result = scan();
    const btn = document.querySelector('button');
    // position:absolute with negative coords does not trigger the visibility check
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('button inside overflow:hidden zero-size container is still interactive', () => {
    document.body.innerHTML = '<div style="overflow:hidden;width:0;height:0"><button>Clipped</button></div>';
    const result = scan();
    const btn = document.querySelector('button');
    // CSS clip/overflow does not apply display:none — element is still in selectorMap
    expect(isInteractive(result, btn)).toBe(true);
  });
});

describe('Conditional React rendering', () => {
  it('element is not interactive when React condition is false (not in DOM)', () => {
    function ConditionalComponent() {
      const [visible] = useState(false);
      return (
        <div>
          {visible && <button id="cond-btn">Conditional</button>}
          <span>Always here</span>
        </div>
      );
    }
    render(<ConditionalComponent />);
    const result = scan();
    const btn = document.querySelector('#cond-btn');
    expect(btn).toBeNull();
    expect(isInteractive(result, btn)).toBe(false);
  });

  it('element is interactive when React condition is true (in DOM)', async () => {
    function ConditionalComponent() {
      const [visible, setVisible] = useState(false);
      return (
        <div>
          <button id="toggle-btn" onClick={() => setVisible(true)}>Toggle</button>
          {visible && <button id="cond-btn">Conditional</button>}
        </div>
      );
    }
    const user = userEvent.setup();
    render(<ConditionalComponent />);

    // Before toggle: conditional button not in DOM
    expect(document.querySelector('#cond-btn')).toBeNull();

    // After toggle: conditional button is in DOM and interactive
    await user.click(document.querySelector('#toggle-btn')!);
    const result = scan();
    const btn = document.querySelector('#cond-btn');
    expect(btn).not.toBeNull();
    expect(isInteractive(result, btn)).toBe(true);
  });
});
