/**
 * Integration tests: React + Shadow DOM / Web Components + dom-processor
 *
 * These tests verify that getDOMState() correctly handles Web Components and
 * Shadow DOM, which are increasingly common on modern websites.
 *
 * Key facts:
 * - dom-processor traverses open shadowRoots via element.shadowRoots
 * - Closed shadow roots return null for element.shadowRoot, so they are NOT traversed
 * - In happy-dom, shadow DOM support may be partial
 * - bounds are always 0x0 in happy-dom, so icon/iframe checks never fire
 */

import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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
// Shadow host component helper
// ---------------------------------------------------------------------------

interface ShadowHostProps {
  children: (root: ShadowRoot) => void;
  mode?: ShadowRootMode;
}

function ShadowHost({ children, mode = 'open' }: ShadowHostProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.shadowRoot) {
      const shadow = ref.current.attachShadow({ mode });
      children(shadow);
    }
  });
  return <div ref={ref} id="host" />;
}

// ---------------------------------------------------------------------------
// Open shadow DOM: elements are traversed
// ---------------------------------------------------------------------------

describe('Open shadow DOM: elements are traversed', () => {
  it('button inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const btn = document.createElement('button');
          btn.id = 'shadow-btn';
          btn.textContent = 'Click';
          root.appendChild(btn);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowBtn = host?.shadowRoot?.querySelector('#shadow-btn') ?? null;
    const result = scan();

    // Button inside open shadow root should be traversed and interactive
    // Note: if happy-dom does not support shadowRoot traversal, this may be false
    expect(isInteractive(result, shadowBtn)).toBe(true);
  });

  it('text input inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const input = document.createElement('input');
          input.type = 'text';
          input.id = 'shadow-input';
          root.appendChild(input);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowInput = host?.shadowRoot?.querySelector('#shadow-input') ?? null;
    const result = scan();

    expect(isInteractive(result, shadowInput)).toBe(true);
  });

  it('anchor tag inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const a = document.createElement('a');
          a.href = '#';
          a.id = 'shadow-link';
          a.textContent = 'Link';
          root.appendChild(a);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowLink = host?.shadowRoot?.querySelector('#shadow-link') ?? null;
    const result = scan();

    // All <a> tags are interactive (even without href, but this one has href)
    expect(isInteractive(result, shadowLink)).toBe(true);
  });

  it('plain div inside open shadow root is NOT interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const div = document.createElement('div');
          div.id = 'shadow-div';
          div.textContent = 'Text';
          root.appendChild(div);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowDiv = host?.shadowRoot?.querySelector('#shadow-div') ?? null;
    const result = scan();

    // Plain div with no interactive attrs is NOT interactive
    expect(isInteractive(result, shadowDiv)).toBe(false);
  });

  it('select element inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const sel = document.createElement('select');
          sel.id = 'shadow-select';
          const opt = document.createElement('option');
          opt.value = 'a';
          opt.textContent = 'Option A';
          sel.appendChild(opt);
          root.appendChild(sel);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowSelect = host?.shadowRoot?.querySelector('#shadow-select') ?? null;
    const result = scan();

    expect(isInteractive(result, shadowSelect)).toBe(true);
  });

  it('textarea inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const ta = document.createElement('textarea');
          ta.id = 'shadow-textarea';
          root.appendChild(ta);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowTa = host?.shadowRoot?.querySelector('#shadow-textarea') ?? null;
    const result = scan();

    expect(isInteractive(result, shadowTa)).toBe(true);
  });

  it('div with tabindex inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const div = document.createElement('div');
          div.id = 'shadow-tabindex-div';
          div.setAttribute('tabindex', '0');
          div.textContent = 'Focusable';
          root.appendChild(div);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowDiv = host?.shadowRoot?.querySelector('#shadow-tabindex-div') ?? null;
    const result = scan();

    // tabindex makes it interactive (any tabindex value triggers interactivity)
    expect(isInteractive(result, shadowDiv)).toBe(true);
  });

  it('div with role="button" inside open shadow root is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const div = document.createElement('div');
          div.id = 'shadow-role-btn';
          div.setAttribute('role', 'button');
          div.textContent = 'Fake button';
          root.appendChild(div);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const shadowDiv = host?.shadowRoot?.querySelector('#shadow-role-btn') ?? null;
    const result = scan();

    // role="button" is in INTERACTIVE_ROLES
    expect(isInteractive(result, shadowDiv)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Closed shadow DOM: elements are NOT traversed
// ---------------------------------------------------------------------------

describe('Closed shadow DOM: elements are NOT traversed', () => {
  it('host element without interactive attrs is NOT interactive even with closed shadow', () => {
    // We can only verify the host itself — closed shadow internals are inaccessible
    render(
      <div id="closed-host" data-testid="closed-host">
        {/* Closed shadow attached imperatively below */}
      </div>
    );

    const host = document.getElementById('closed-host');
    if (host) {
      // Attach closed shadow — returns a ShadowRoot reference but
      // element.shadowRoot will be null afterward
      host.attachShadow({ mode: 'closed' });
    }

    const result = scan();

    // The host div has no interactive attrs — not interactive
    expect(isInteractive(result, host ?? null)).toBe(false);
  });

  it('host with role="button" IS interactive regardless of closed shadow', () => {
    render(<div id="closed-host-btn" role="button">Host</div>);

    const host = document.getElementById('closed-host-btn');
    if (host) {
      host.attachShadow({ mode: 'closed' });
    }

    const result = scan();

    // The host has role="button" → interactive
    expect(isInteractive(result, host ?? null)).toBe(true);
  });

  it('closed shadow root: element.shadowRoot returns null so internals are not accessible', () => {
    // This test documents the behavior: closed shadow roots cannot be read
    render(<div id="closed-inner-host" />);

    const host = document.getElementById('closed-inner-host');
    if (host) {
      const closedRoot = host.attachShadow({ mode: 'closed' });
      const btn = document.createElement('button');
      btn.id = 'closed-shadow-btn';
      btn.textContent = 'Inaccessible';
      closedRoot.appendChild(btn);
    }

    // From outside: element.shadowRoot is null for closed shadows
    expect(host?.shadowRoot).toBeNull();

    // querySelector on the host does not reach into closed shadow
    const shadowBtn = host?.querySelector('#closed-shadow-btn') ?? null;
    expect(shadowBtn).toBeNull();

    // Nothing to assert on isInteractive since we can't get a reference to the element
  });
});

// ---------------------------------------------------------------------------
// Web component patterns
// ---------------------------------------------------------------------------

describe('Web component patterns', () => {
  it('custom element host with open shadow containing a button: button is interactive', () => {
    // Simulate a web component host div with data-component attr and open shadow
    render(
      <ShadowHost mode="open">
        {root => {
          const btn = document.createElement('button');
          btn.id = 'wc-btn';
          btn.textContent = 'Web Component Action';
          root.appendChild(btn);
        }}
      </ShadowHost>
    );

    // Add data-component attr to the host to simulate a web component
    const host = document.getElementById('host');
    host?.setAttribute('data-component', 'my-button');

    const wcBtn = host?.shadowRoot?.querySelector('#wc-btn') ?? null;
    const result = scan();

    expect(isInteractive(result, wcBtn)).toBe(true);
  });

  it('web component host div with role="button" is interactive (no shadow DOM)', () => {
    render(
      <div
        id="wc-host-role"
        data-component="my-widget"
        role="button"
      >
        Widget
      </div>
    );

    const host = document.getElementById('wc-host-role');
    const result = scan();

    expect(isInteractive(result, host ?? null)).toBe(true);
  });

  it('web component host div with tabindex is interactive (no shadow DOM)', () => {
    render(
      <div
        id="wc-host-tabindex"
        data-component="my-widget"
        tabIndex={0}
      >
        Focusable Widget
      </div>
    );

    const host = document.getElementById('wc-host-tabindex');
    const result = scan();

    expect(isInteractive(result, host ?? null)).toBe(true);
  });

  it('plain web component host div without shadow or interactive attrs is NOT interactive', () => {
    render(
      <div id="wc-host-plain" data-component="my-display">
        Display Only
      </div>
    );

    const host = document.getElementById('wc-host-plain');
    const result = scan();

    expect(isInteractive(result, host ?? null)).toBe(false);
  });

  it('nested shadow DOM: outer open shadow with inner element containing button', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const wrapper = document.createElement('div');
          wrapper.id = 'shadow-wrapper';

          const btn = document.createElement('button');
          btn.id = 'nested-btn';
          btn.textContent = 'Nested';
          wrapper.appendChild(btn);
          root.appendChild(wrapper);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const nestedBtn = host?.shadowRoot?.querySelector('#nested-btn') ?? null;
    const result = scan();

    expect(isInteractive(result, nestedBtn)).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// Slotted content
// ---------------------------------------------------------------------------

describe('Slotted content', () => {
  it('slotted button in light DOM is interactive (lives in document, not shadow)', () => {
    // Slotted content lives in the LIGHT DOM (the regular document).
    // The shadow host projects it visually, but the element is still
    // a child of the shadow host in the document tree.
    render(
      <ShadowHost mode="open">
        {root => {
          // Create a slot in the shadow root
          const slot = document.createElement('slot');
          slot.name = 'action';
          root.appendChild(slot);
        }}
      </ShadowHost>
    );

    // Append slotted content to the host in light DOM
    const host = document.getElementById('host');
    if (host) {
      const btn = document.createElement('button');
      btn.slot = 'action';
      btn.id = 'slotted-btn';
      btn.textContent = 'Slotted Button';
      host.appendChild(btn);
    }

    const slottedBtn = document.getElementById('slotted-btn');
    const result = scan();

    // Slotted button is in the light DOM — always detected as interactive
    expect(isInteractive(result, slottedBtn)).toBe(true);
  });

  it('slotted input in light DOM is interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const slot = document.createElement('slot');
          slot.name = 'field';
          root.appendChild(slot);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    if (host) {
      const input = document.createElement('input');
      input.type = 'text';
      input.slot = 'field';
      input.id = 'slotted-input';
      host.appendChild(input);
    }

    const slottedInput = document.getElementById('slotted-input');
    const result = scan();

    expect(isInteractive(result, slottedInput)).toBe(true);
  });

  it('slotted plain div in light DOM is NOT interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const slot = document.createElement('slot');
          slot.name = 'content';
          root.appendChild(slot);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    if (host) {
      const div = document.createElement('div');
      div.slot = 'content';
      div.id = 'slotted-div';
      div.textContent = 'Static content';
      host.appendChild(div);
    }

    const slottedDiv = document.getElementById('slotted-div');
    const result = scan();

    // Plain div without interactive attrs is NOT interactive
    expect(isInteractive(result, slottedDiv)).toBe(false);
  });

  it('multiple slotted buttons all appear as interactive', () => {
    render(
      <ShadowHost mode="open">
        {root => {
          const slot = document.createElement('slot');
          root.appendChild(slot);
        }}
      </ShadowHost>
    );

    const host = document.getElementById('host');
    const btnIds = ['slotted-a', 'slotted-b', 'slotted-c'];
    if (host) {
      btnIds.forEach(id => {
        const btn = document.createElement('button');
        btn.id = id;
        btn.textContent = id;
        host.appendChild(btn);
      });
    }

    const result = scan();

    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      expect(isInteractive(result, btn)).toBe(true);
    });
  });
});
