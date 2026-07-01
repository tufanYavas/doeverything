/**
 * Integration tests: React UI patterns from component libraries
 *
 * Tests dom-processor with common UI component patterns found in React apps
 * using component libraries like Radix UI, Material UI, Headless UI, Ant Design, etc.
 * We simulate the DOM structure those libraries produce, not the actual library APIs.
 */

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

// ---------------------------------------------------------------------------
// Custom select / combobox (Radix UI Select pattern)
// ---------------------------------------------------------------------------

describe('Custom select / combobox (Radix UI Select pattern)', () => {
  function SelectClosed() {
    return (
      <div>
        <button
          id="trigger"
          role="combobox"
          aria-expanded="false"
          aria-haspopup="listbox"
          type="button"
        >
          Select an option
        </button>
      </div>
    );
  }

  function SelectOpen() {
    return (
      <div>
        <button
          id="trigger"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          type="button"
        >
          Select an option
        </button>
        <div role="listbox">
          <div id="opt1" role="option" aria-selected="false">Option 1</div>
          <div id="opt2" role="option" aria-selected="true">Option 2</div>
          <div id="opt3" role="option" aria-selected="false">Option 3</div>
        </div>
      </div>
    );
  }

  it('closed: trigger button is interactive', () => {
    render(<SelectClosed />);
    const result = scan();
    const trigger = document.getElementById('trigger');
    expect(isInteractive(result, trigger)).toBe(true);
  });

  it('closed: options do not exist in the DOM', () => {
    render(<SelectClosed />);
    expect(document.getElementById('opt1')).toBeNull();
  });

  it('open: trigger button is interactive', () => {
    render(<SelectOpen />);
    const result = scan();
    const trigger = document.getElementById('trigger');
    expect(isInteractive(result, trigger)).toBe(true);
  });

  it('open: option divs with role="option" are interactive', () => {
    render(<SelectOpen />);
    const result = scan();
    const opt1 = document.getElementById('opt1');
    const opt2 = document.getElementById('opt2');
    const opt3 = document.getElementById('opt3');
    expect(isInteractive(result, opt1)).toBe(true);
    expect(isInteractive(result, opt2)).toBe(true);
    expect(isInteractive(result, opt3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Modal dialog (Radix UI Dialog pattern)
// ---------------------------------------------------------------------------

describe('Modal dialog (Radix UI Dialog pattern)', () => {
  function Modal() {
    return (
      <div id="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
        <h2 id="title">Confirm</h2>
        <button id="confirm">OK</button>
        <button id="cancel">Cancel</button>
      </div>
    );
  }

  it('dialog div (role="dialog") is NOT interactive', () => {
    render(<Modal />);
    const result = scan();
    const dialog = document.getElementById('dialog');
    expect(isInteractive(result, dialog)).toBe(false);
  });

  it('confirm button inside dialog is interactive', () => {
    render(<Modal />);
    const result = scan();
    const confirm = document.getElementById('confirm');
    expect(isInteractive(result, confirm)).toBe(true);
  });

  it('cancel button inside dialog is interactive', () => {
    render(<Modal />);
    const result = scan();
    const cancel = document.getElementById('cancel');
    expect(isInteractive(result, cancel)).toBe(true);
  });

  it('title h2 inside dialog is NOT interactive', () => {
    render(<Modal />);
    const result = scan();
    const title = document.getElementById('title');
    expect(isInteractive(result, title)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Navigation menu (dropdown nav pattern)
// ---------------------------------------------------------------------------

describe('Navigation menu (dropdown nav pattern)', () => {
  function NavMenu() {
    return (
      <nav id="nav">
        <button id="nav-btn" aria-expanded="true" aria-haspopup="true">Products</button>
        <div id="menu" role="menu">
          <a id="item1" role="menuitem" href="/product1">Product 1</a>
          <a id="item2" role="menuitem" href="/product2">Product 2</a>
          <button id="item3" role="menuitem">View All</button>
        </div>
      </nav>
    );
  }

  it('nav button is interactive (button tag)', () => {
    render(<NavMenu />);
    const result = scan();
    const btn = document.getElementById('nav-btn');
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('anchor menuitem is interactive (role="menuitem")', () => {
    render(<NavMenu />);
    const result = scan();
    const item1 = document.getElementById('item1');
    expect(isInteractive(result, item1)).toBe(true);
  });

  it('second anchor menuitem is interactive', () => {
    render(<NavMenu />);
    const result = scan();
    const item2 = document.getElementById('item2');
    expect(isInteractive(result, item2)).toBe(true);
  });

  it('button menuitem is interactive', () => {
    render(<NavMenu />);
    const result = scan();
    const item3 = document.getElementById('item3');
    expect(isInteractive(result, item3)).toBe(true);
  });

  it('nav element itself is NOT interactive', () => {
    render(<NavMenu />);
    const result = scan();
    const nav = document.getElementById('nav');
    expect(isInteractive(result, nav)).toBe(false);
  });

  it('menu div itself is NOT interactive', () => {
    render(<NavMenu />);
    const result = scan();
    const menu = document.getElementById('menu');
    expect(isInteractive(result, menu)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tabs component (Radix UI Tabs pattern)
// ---------------------------------------------------------------------------

describe('Tabs component (Radix UI Tabs pattern)', () => {
  function Tabs() {
    return (
      <div>
        <div id="tablist" role="tablist">
          <button id="tab1" role="tab" aria-selected={true} aria-controls="panel1">Tab 1</button>
          <button id="tab2" role="tab" aria-selected={false} aria-controls="panel2">Tab 2</button>
        </div>
        <div id="panel1" role="tabpanel">
          <input id="panel-input" type="text" placeholder="Panel 1 input" />
        </div>
        <div id="panel2" role="tabpanel" hidden>Hidden panel</div>
      </div>
    );
  }

  it('first tab button is interactive', () => {
    render(<Tabs />);
    const result = scan();
    const tab1 = document.getElementById('tab1');
    expect(isInteractive(result, tab1)).toBe(true);
  });

  it('second tab button is interactive', () => {
    render(<Tabs />);
    const result = scan();
    const tab2 = document.getElementById('tab2');
    expect(isInteractive(result, tab2)).toBe(true);
  });

  it('active panel input is interactive', () => {
    render(<Tabs />);
    const result = scan();
    const input = document.getElementById('panel-input');
    expect(isInteractive(result, input)).toBe(true);
  });

  it('tablist div is NOT interactive', () => {
    render(<Tabs />);
    const result = scan();
    const tablist = document.getElementById('tablist');
    expect(isInteractive(result, tablist)).toBe(false);
  });

  it('hidden panel is excluded from selectorMap', () => {
    render(<Tabs />);
    const result = scan();
    const panel2 = document.getElementById('panel2');
    expect(isInteractive(result, panel2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Accordion (expand/collapse pattern)
// ---------------------------------------------------------------------------

describe('Accordion (expand/collapse pattern)', () => {
  function Accordion() {
    return (
      <div className="accordion">
        <button id="toggle1" aria-expanded="false" aria-controls="section1">Section 1</button>
        <div id="section1" hidden>
          Section 1 Content <button id="action1">Action</button>
        </div>
        <button id="toggle2" aria-expanded="true" aria-controls="section2">Section 2</button>
        <div id="section2">
          Section 2 Content <button id="action2">Action 2</button>
        </div>
      </div>
    );
  }

  it('first section toggle button is interactive', () => {
    render(<Accordion />);
    const result = scan();
    const toggle1 = document.getElementById('toggle1');
    expect(isInteractive(result, toggle1)).toBe(true);
  });

  it('second section toggle button is interactive', () => {
    render(<Accordion />);
    const result = scan();
    const toggle2 = document.getElementById('toggle2');
    expect(isInteractive(result, toggle2)).toBe(true);
  });

  it('action button in hidden section is interactive (happy-dom: [hidden] attr cascade not applied)', () => {
    render(<Accordion />);
    const result = scan();
    const action1 = document.getElementById('action1');
    // Section 1 uses [hidden] attribute. In real browsers [hidden]=display:none excludes children.
    // happy-dom does not apply UA display:none for [hidden], so the button is still detected.
    expect(isInteractive(result, action1)).toBe(true);
  });

  it('action button in visible section is interactive', () => {
    render(<Accordion />);
    const result = scan();
    const action2 = document.getElementById('action2');
    expect(isInteractive(result, action2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Switch / Toggle button (accessible toggle pattern)
// ---------------------------------------------------------------------------

describe('Switch / Toggle button (accessible toggle pattern)', () => {
  function Switches() {
    return (
      <div>
        <button id="switch-btn" role="switch" aria-checked="false">Toggle A</button>
        <div id="switch-div-tabindex" role="switch" tabIndex={0} aria-checked="false">Toggle B</div>
        <div id="switch-div-plain" role="switch" aria-checked="false">Toggle C</div>
      </div>
    );
  }

  it('button with role="switch" is interactive (button tag takes precedence)', () => {
    render(<Switches />);
    const result = scan();
    const switchBtn = document.getElementById('switch-btn');
    expect(isInteractive(result, switchBtn)).toBe(true);
  });

  it('div with role="switch" and tabindex="0" is interactive (tabindex signal)', () => {
    render(<Switches />);
    const result = scan();
    const switchDivTabindex = document.getElementById('switch-div-tabindex');
    expect(isInteractive(result, switchDivTabindex)).toBe(true);
  });

  it('plain div with role="switch" and aria-checked is interactive (aria-checked triggers axNode checked property)', () => {
    render(<Switches />);
    const result = scan();
    const switchDivPlain = document.getElementById('switch-div-plain');
    // role="switch" is not in INTERACTIVE_ROLES, but aria-checked="false" adds { name:'checked', value:false }
    // to axNode.properties. The AX check fires for any 'checked' prop regardless of value — so it's interactive.
    expect(isInteractive(result, switchDivPlain)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Breadcrumb navigation
// ---------------------------------------------------------------------------

describe('Breadcrumb navigation', () => {
  function Breadcrumb() {
    return (
      <nav aria-label="Breadcrumb">
        <ol>
          <li id="li-home"><a id="home-link" href="/">Home</a></li>
          <li id="li-products"><a id="products-link" href="/products">Products</a></li>
          <li id="li-current" aria-current="page"><span id="current-span">Current Page</span></li>
        </ol>
      </nav>
    );
  }

  it('home link is interactive', () => {
    render(<Breadcrumb />);
    const result = scan();
    const homeLink = document.getElementById('home-link');
    expect(isInteractive(result, homeLink)).toBe(true);
  });

  it('products link is interactive', () => {
    render(<Breadcrumb />);
    const result = scan();
    const productsLink = document.getElementById('products-link');
    expect(isInteractive(result, productsLink)).toBe(true);
  });

  it('current page span is NOT interactive (span without form control descendant)', () => {
    render(<Breadcrumb />);
    const result = scan();
    const currentSpan = document.getElementById('current-span');
    expect(isInteractive(result, currentSpan)).toBe(false);
  });

  it('list items are NOT interactive', () => {
    render(<Breadcrumb />);
    const result = scan();
    const liHome = document.getElementById('li-home');
    const liProducts = document.getElementById('li-products');
    const liCurrent = document.getElementById('li-current');
    expect(isInteractive(result, liHome)).toBe(false);
    expect(isInteractive(result, liProducts)).toBe(false);
    expect(isInteractive(result, liCurrent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Data table with interactive rows (grid pattern)
// ---------------------------------------------------------------------------

describe('Data table with interactive rows (grid pattern)', () => {
  function DataTable() {
    return (
      <table role="grid">
        <thead>
          <tr>
            <th id="col-name" role="columnheader">Name</th>
            <th id="col-actions" role="columnheader">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-alice" role="row">
            <td id="cell-name" role="gridcell">Alice</td>
            <td id="cell-actions" role="gridcell">
              <button id="edit-btn">Edit</button>
              <button id="delete-btn">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  it('tr with role="row" is interactive', () => {
    render(<DataTable />);
    const result = scan();
    const row = document.getElementById('row-alice');
    expect(isInteractive(result, row)).toBe(true);
  });

  it('td with role="gridcell" (name cell) is interactive', () => {
    render(<DataTable />);
    const result = scan();
    const cellName = document.getElementById('cell-name');
    expect(isInteractive(result, cellName)).toBe(true);
  });

  it('td with role="gridcell" (actions cell) is interactive', () => {
    render(<DataTable />);
    const result = scan();
    const cellActions = document.getElementById('cell-actions');
    expect(isInteractive(result, cellActions)).toBe(true);
  });

  it('Edit button is interactive', () => {
    render(<DataTable />);
    const result = scan();
    const editBtn = document.getElementById('edit-btn');
    expect(isInteractive(result, editBtn)).toBe(true);
  });

  it('Delete button is interactive', () => {
    render(<DataTable />);
    const result = scan();
    const deleteBtn = document.getElementById('delete-btn');
    expect(isInteractive(result, deleteBtn)).toBe(true);
  });

  it('th with role="columnheader" is NOT interactive', () => {
    render(<DataTable />);
    const result = scan();
    const colName = document.getElementById('col-name');
    const colActions = document.getElementById('col-actions');
    expect(isInteractive(result, colName)).toBe(false);
    expect(isInteractive(result, colActions)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Toast / Notification (dismiss button)
// ---------------------------------------------------------------------------

describe('Toast / Notification (dismiss button)', () => {
  function Toast() {
    return (
      <div id="alert" role="alert" aria-live="assertive">
        <p id="alert-msg">Error occurred</p>
        <button id="dismiss">Dismiss</button>
      </div>
    );
  }

  it('alert div is NOT interactive (role="alert" not in INTERACTIVE_ROLES)', () => {
    render(<Toast />);
    const result = scan();
    const alert = document.getElementById('alert');
    expect(isInteractive(result, alert)).toBe(false);
  });

  it('dismiss button inside alert is interactive', () => {
    render(<Toast />);
    const result = scan();
    const dismiss = document.getElementById('dismiss');
    expect(isInteractive(result, dismiss)).toBe(true);
  });

  it('paragraph inside alert is NOT interactive', () => {
    render(<Toast />);
    const result = scan();
    const msg = document.getElementById('alert-msg');
    expect(isInteractive(result, msg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Custom date picker (Calendar grid pattern)
// ---------------------------------------------------------------------------

describe('Custom date picker (Calendar grid pattern)', () => {
  function DatePicker() {
    return (
      <div id="datepicker-dialog" role="dialog" aria-label="Date picker">
        <button id="prev-month" aria-label="Previous month">&#9664;</button>
        <button id="next-month" aria-label="Next month">&#9654;</button>
        <table role="grid">
          <tbody>
            <tr role="row">
              <td id="gridcell-1" role="gridcell">
                <button id="day1" aria-label="January 1, 2024">1</button>
              </td>
              <td id="gridcell-2" role="gridcell">
                <button id="day2" aria-label="January 2, 2024" aria-selected="true">2</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  it('prev-month button is interactive', () => {
    render(<DatePicker />);
    const result = scan();
    const prev = document.getElementById('prev-month');
    expect(isInteractive(result, prev)).toBe(true);
  });

  it('next-month button is interactive', () => {
    render(<DatePicker />);
    const result = scan();
    const next = document.getElementById('next-month');
    expect(isInteractive(result, next)).toBe(true);
  });

  it('day buttons inside gridcell are interactive', () => {
    render(<DatePicker />);
    const result = scan();
    const day1 = document.getElementById('day1');
    const day2 = document.getElementById('day2');
    expect(isInteractive(result, day1)).toBe(true);
    expect(isInteractive(result, day2)).toBe(true);
  });

  it('dialog div is NOT interactive (role="dialog" not in INTERACTIVE_ROLES)', () => {
    render(<DatePicker />);
    const result = scan();
    const dialog = document.getElementById('datepicker-dialog');
    expect(isInteractive(result, dialog)).toBe(false);
  });

  it('gridcell tds are interactive (role="gridcell" in INTERACTIVE_ROLES)', () => {
    render(<DatePicker />);
    const result = scan();
    const gc1 = document.getElementById('gridcell-1');
    const gc2 = document.getElementById('gridcell-2');
    expect(isInteractive(result, gc1)).toBe(true);
    expect(isInteractive(result, gc2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Form with custom styled inputs (common pattern)
// ---------------------------------------------------------------------------

describe('Form with custom styled inputs (common pattern)', () => {
  function CustomFileUpload() {
    return (
      <form>
        <label id="file-label" className="file-upload">
          <input id="file-input" type="file" style={{ display: 'none' }} />
          <span id="file-span">Choose file</span>
        </label>
        <label id="text-label" htmlFor="text-input">Name</label>
        <input id="text-input" type="text" placeholder="Enter name" />
        <input id="hidden-input" type="hidden" name="csrf" value="token123" />
      </form>
    );
  }

  it('hidden file input (display:none) is in selectorMap (React style prop not excluded in happy-dom)', () => {
    render(<CustomFileUpload />);
    const result = scan();
    const fileInput = document.getElementById('file-input');
    // React sets display:none via JS style property. In happy-dom this does not trigger exclusion
    // the same way HTML-parsed style="display:none" does on some element types.
    expect(isInteractive(result, fileInput)).toBe(true);
  });

  it('label wrapping hidden file input IS interactive (hasFormControlDescendant checks tag, not visibility)', () => {
    render(<CustomFileUpload />);
    const result = scan();
    const fileLabel = document.getElementById('file-label');
    expect(isInteractive(result, fileLabel)).toBe(true);
  });

  it('span inside file-upload label is NOT interactive (span wraps no form control directly)', () => {
    render(<CustomFileUpload />);
    const result = scan();
    const fileSpan = document.getElementById('file-span');
    expect(isInteractive(result, fileSpan)).toBe(false);
  });

  it('label with for attribute is NOT interactive', () => {
    render(<CustomFileUpload />);
    const result = scan();
    const textLabel = document.getElementById('text-label');
    expect(isInteractive(result, textLabel)).toBe(false);
  });

  it('visible text input is interactive', () => {
    render(<CustomFileUpload />);
    const result = scan();
    const textInput = document.getElementById('text-input');
    expect(isInteractive(result, textInput)).toBe(true);
  });

  it('input type="hidden" is NOT in selectorMap (dom-processor explicitly excludes hidden type)', () => {
    render(<CustomFileUpload />);
    const result = scan();
    const hiddenInput = document.getElementById('hidden-input');
    // isElementVisible has explicit: if (element.type === 'hidden') return false
    expect(isInteractive(result, hiddenInput)).toBe(false);
  });
});
