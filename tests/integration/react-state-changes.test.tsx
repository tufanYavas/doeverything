/**
 * Integration tests: React components + dom-processor serializer
 *
 * These tests live outside both packages by design. They verify that
 * getDOMState() correctly handles DOM produced by React — dynamic state
 * changes, controlled inputs, conditional rendering — which can't be
 * replicated with static innerHTML strings.
 *
 * Cleanup between tests is handled by tests/unit/setup/dom.ts (afterEach cleanup).
 */

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// Dynamic state: dropdown open/close
// ---------------------------------------------------------------------------

describe('Dropdown: conditional rendering reflects in selectorMap', () => {
  function Dropdown() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(o => !o)}>
          Select option
        </button>
        {open && (
          <ul role="listbox">
            <li role="option"><button type="button">Option A</button></li>
            <li role="option"><button type="button">Option B</button></li>
            <li role="option"><button type="button">Option C</button></li>
          </ul>
        )}
      </div>
    );
  }

  it('closed: only trigger button is interactive', () => {
    const { container } = render(<Dropdown />);
    const result = scan();
    const trigger = container.querySelector('button[aria-expanded="false"]');
    expect(isInteractive(result, trigger)).toBe(true);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it('opened via click: trigger + all option buttons interactive', async () => {
    const user = userEvent.setup();
    const { container } = render(<Dropdown />);
    await user.click(container.querySelector('button')!);

    const result = scan();
    const options = container.querySelectorAll('[role="option"] button');
    expect(options).toHaveLength(3);
    options.forEach(opt => expect(isInteractive(result, opt)).toBe(true));
  });

  it('closed again after second click: option buttons gone from selectorMap', async () => {
    const user = userEvent.setup();
    const { container } = render(<Dropdown />);
    await user.click(container.querySelector('button')!); // open
    await user.click(container.querySelector('button')!); // close

    const result = scan();
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    const trigger = container.querySelector('button[aria-expanded="false"]');
    expect(isInteractive(result, trigger)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Controlled inputs
// ---------------------------------------------------------------------------

describe('Controlled inputs', () => {
  it('controlled text input is interactive', () => {
    function NameInput() {
      const [v, setV] = useState('');
      return (
        <input type="text" value={v} onChange={e => setV(e.target.value)} aria-label="Full name" />
      );
    }
    const { container } = render(<NameInput />);
    expect(isInteractive(scan(), container.querySelector('input'))).toBe(true);
  });

  it('controlled OTP — each digit cell individually interactive', () => {
    const DIGITS = 6;
    function OTPInput() {
      const [vals, setVals] = useState(Array<string>(DIGITS).fill(''));
      return (
        <div aria-label="One-time password">
          {vals.map((v, i) => (
            <input
              key={i}
              type="text"
              maxLength={1}
              inputMode="numeric"
              value={v}
              onChange={e => {
                const next = [...vals];
                next[i] = e.target.value.slice(-1);
                setVals(next);
              }}
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>
      );
    }
    const { container } = render(<OTPInput />);
    const result = scan();
    const cells = container.querySelectorAll('input[maxLength="1"]');
    expect(cells).toHaveLength(DIGITS);
    cells.forEach(cell => expect(isInteractive(result, cell)).toBe(true));
  });

  it('combobox: interactive in both closed and open states', async () => {
    const user = userEvent.setup();
    function Combobox() {
      const [open, setOpen] = useState(false);
      const [query, setQuery] = useState('');
      return (
        <div>
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onBlur={() => setOpen(false)}
            placeholder="Search…"
            aria-label="Search"
          />
          {open && query && (
            <ul role="listbox">
              {['Apple', 'Banana', 'Cherry']
                .filter(o => o.toLowerCase().includes(query.toLowerCase()))
                .map(o => <li key={o} role="option" aria-selected={false}>{o}</li>)}
            </ul>
          )}
        </div>
      );
    }
    const { container } = render(<Combobox />);
    const input = container.querySelector('[role="combobox"]')!;

    // Closed state
    expect(isInteractive(scan(), input)).toBe(true);

    // Open state after typing
    await user.type(input, 'a');
    const result = scan();
    expect(isInteractive(result, input)).toBe(true);
    container.querySelectorAll('[role="option"]').forEach(opt => {
      expect(isInteractive(result, opt)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// CSS-hidden native inputs inside React components
// ---------------------------------------------------------------------------

describe('CSS-hidden native inputs in React', () => {
  it('toggle switch: hidden checkbox inside label is interactive', () => {
    function ToggleSwitch({ id, label }: { id: string; label: string }) {
      const [on, setOn] = useState(false);
      return (
        <label htmlFor={id}>
          <input
            type="checkbox"
            id={id}
            checked={on}
            onChange={() => setOn(v => !v)}
            style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
          />
          <span />
          {label}
        </label>
      );
    }
    const { container } = render(
      <div>
        <ToggleSwitch id="toggle-a" label="Dark mode" />
        <ToggleSwitch id="toggle-b" label="Notifications" />
      </div>
    );
    const result = scan();
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      expect(isInteractive(result, cb)).toBe(true);
    });
  });

  it('star rating: hidden radio inputs inside labels are all interactive', () => {
    function StarRating() {
      const [rating, setRating] = useState(0);
      return (
        <fieldset>
          {[1, 2, 3, 4, 5].map(n => (
            <label key={n} aria-label={`${n} star`}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
              />
              ★
            </label>
          ))}
        </fieldset>
      );
    }
    const { container } = render(<StarRating />);
    const result = scan();
    container.querySelectorAll('input[type="radio"]').forEach(r => {
      expect(isInteractive(result, r)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Complete form
// ---------------------------------------------------------------------------

describe('React form with all common field types', () => {
  it('every field is interactive', () => {
    function ProfileForm() {
      const [name, setName] = useState('');
      return (
        <form aria-label="Profile">
          <input type="text" value={name} onChange={e => setName(e.target.value)} aria-label="Name" />
          <input type="email" aria-label="Email" />
          <input type="tel" aria-label="Phone" />
          <select aria-label="Country">
            <option value="tr">Turkey</option>
          </select>
          <textarea aria-label="Bio" />
          <label>
            <input type="checkbox" aria-label="Terms" />
            Accept
          </label>
          <label>
            <input type="radio" name="plan" value="free" aria-label="Free" />
            Free
          </label>
          <label>
            <input type="radio" name="plan" value="pro" aria-label="Pro" />
            Pro
          </label>
          <button type="submit">Save</button>
        </form>
      );
    }
    const { container } = render(<ProfileForm />);
    const result = scan();

    const selectors = [
      'input[type="text"]', 'input[type="email"]', 'input[type="tel"]',
      'select', 'textarea', 'input[type="checkbox"]', 'button[type="submit"]',
    ];
    selectors.forEach(sel => {
      expect(isInteractive(result, container.querySelector(sel)), sel).toBe(true);
    });
    container.querySelectorAll('input[type="radio"]').forEach(r => {
      expect(isInteractive(result, r)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Rich text editor
// ---------------------------------------------------------------------------

describe('contenteditable in React', () => {
  it('contentEditable div is interactive', () => {
    function Editor() {
      return (
        <div contentEditable role="textbox" aria-multiline="true" aria-label="Editor" suppressContentEditableWarning>
          Write here…
        </div>
      );
    }
    const { container } = render(<Editor />);
    expect(isInteractive(scan(), container.querySelector('[contenteditable]'))).toBe(true);
  });
});
