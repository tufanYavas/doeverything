/**
 * Integration tests: Vue 3 interactive elements + dom-processor
 *
 * Tests getDOMState() interactivity detection against DOM produced by
 * Vue 3 components rendered with @testing-library/vue. Covers native HTML
 * elements, Vue event binding patterns, Teleport, ARIA roles, and
 * Vuetify/PrimeVue-like simulated component output.
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
// Native HTML interactive elements in Vue
// ---------------------------------------------------------------------------

describe('Native HTML interactive elements in Vue', () => {
  it('button is interactive', () => {
    const Comp = defineComponent({
      template: `<button id="el">Click me</button>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="text"] with v-model is interactive', () => {
    const Comp = defineComponent({
      setup() {
        return { value: ref('') };
      },
      template: `<input id="el" type="text" v-model="value" />`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="checkbox"] with v-model is interactive', () => {
    const Comp = defineComponent({
      setup() {
        return { checked: ref(false) };
      },
      template: `<input id="el" type="checkbox" v-model="checked" />`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="radio"] with v-model is interactive', () => {
    const Comp = defineComponent({
      setup() {
        return { picked: ref('') };
      },
      template: `<input id="el" type="radio" value="a" v-model="picked" />`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('select with v-model is interactive', () => {
    const Comp = defineComponent({
      setup() {
        return { selected: ref('') };
      },
      template: `<select id="el" v-model="selected"><option value="a">A</option></select>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('textarea with v-model is interactive', () => {
    const Comp = defineComponent({
      setup() {
        return { text: ref('') };
      },
      template: `<textarea id="el" v-model="text"></textarea>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('a[href="#"] is interactive', () => {
    const Comp = defineComponent({
      template: `<a id="el" href="#">Link</a>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('a without href is interactive (all <a> tags are interactive)', () => {
    const Comp = defineComponent({
      template: `<a id="el">No href</a>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vue event binding patterns
// ---------------------------------------------------------------------------

describe('Vue event binding patterns', () => {
  it('button with @click handler is interactive (button tag)', () => {
    const Comp = defineComponent({
      setup() {
        return { handleClick: () => {} };
      },
      template: `<button id="el" @click="handleClick">Click</button>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with @click only is NOT interactive (Vue uses addEventListener, not onclick attr)', () => {
    const Comp = defineComponent({
      setup() {
        return { handleClick: () => {} };
      },
      template: `<div id="el" @click="handleClick">Div</div>`,
    });
    render(Comp);
    const result = scan();
    // Vue binds via addEventListener, not onclick attribute, so no interactive signal
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('div with @click and cursor:pointer style is interactive (cursor:pointer heuristic)', () => {
    const Comp = defineComponent({
      setup() {
        return { handleClick: () => {} };
      },
      template: `<div id="el" @click="handleClick" style="cursor:pointer">Div</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with tabindex and @click is interactive (tabindex attr triggers interactivity)', () => {
    const Comp = defineComponent({
      setup() {
        return { handleClick: () => {} };
      },
      template: `<div id="el" tabindex="0" @click="handleClick">Div</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with tabindex="-1" is interactive (any tabindex value triggers it)', () => {
    const Comp = defineComponent({
      template: `<div id="el" tabindex="-1">Div</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('plain div without any interactive signals is NOT interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el">Plain div</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vue Teleport pattern
// ---------------------------------------------------------------------------

describe('Vue Teleport pattern', () => {
  it('button inside Teleport to body is interactive', () => {
    const Comp = defineComponent({
      template: `
        <div>
          <Teleport to="body">
            <div role="dialog">
              <button id="teleport-btn">Teleported</button>
            </div>
          </Teleport>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('teleport-btn'))).toBe(true);
  });

  it('input inside Teleport to body is interactive', () => {
    const Comp = defineComponent({
      setup() {
        return { value: ref('') };
      },
      template: `
        <div>
          <Teleport to="body">
            <input id="teleport-input" type="text" v-model="value" />
          </Teleport>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('teleport-input'))).toBe(true);
  });

  it('div role="dialog" inside Teleport is NOT interactive (dialog role is not interactive)', () => {
    const Comp = defineComponent({
      template: `
        <div>
          <Teleport to="body">
            <div id="teleport-dialog" role="dialog">Dialog content</div>
          </Teleport>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('teleport-dialog'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ARIA roles in Vue
// ---------------------------------------------------------------------------

describe('ARIA roles in Vue', () => {
  it('div role="button" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="button">Custom button</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="tab" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="tab">Tab</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="menuitem" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="menuitem">Menu Item</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="dialog" is NOT interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="dialog">Dialog</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('div role="switch" is NOT interactive (switch is not in INTERACTIVE_ROLES)', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="switch">Switch</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('div role="checkbox" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="checkbox" aria-checked="false">Checkbox</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="radio" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="radio" aria-checked="false">Radio</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="combobox" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="combobox" aria-expanded="false">Combobox</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="textbox" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="textbox" contenteditable="true">Editable</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div role="alert" is NOT interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" role="alert">Alert message</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vuetify-like component patterns (simulated DOM)
// ---------------------------------------------------------------------------

describe('Vuetify-like component patterns (simulated DOM)', () => {
  it('v-btn simulated output: <button class="v-btn"> is interactive', () => {
    const Comp = defineComponent({
      template: `<button id="el" class="v-btn v-btn--elevated">Label</button>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('v-text-field simulated output: <input class="v-field__input" type="text"> is interactive', () => {
    const Comp = defineComponent({
      template: `
        <div class="v-text-field">
          <div class="v-field">
            <input id="el" class="v-field__input" type="text" />
          </div>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('v-checkbox simulated output: <input type="checkbox" class="v-selection-control__input"> is interactive', () => {
    const Comp = defineComponent({
      template: `
        <div class="v-checkbox v-selection-control">
          <input id="el" type="checkbox" class="v-selection-control__input" />
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('v-switch simulated output: <input type="checkbox" role="switch" class="v-selection-control__input"> is interactive (input tag)', () => {
    const Comp = defineComponent({
      template: `
        <div class="v-switch v-selection-control">
          <input id="el" type="checkbox" role="switch" class="v-selection-control__input" />
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('v-select simulated: <input type="text" role="combobox" class="v-field__input"> is interactive', () => {
    const Comp = defineComponent({
      template: `
        <div class="v-select">
          <div class="v-field">
            <input id="el" type="text" role="combobox" class="v-field__input" aria-expanded="false" />
          </div>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('v-list-item simulated: <div class="v-list-item" tabindex="0"> is interactive', () => {
    const Comp = defineComponent({
      template: `
        <div class="v-list" role="list">
          <div id="el" class="v-list-item" tabindex="0">Item</div>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PrimeVue-like patterns
// ---------------------------------------------------------------------------

describe('PrimeVue-like patterns', () => {
  it('PrimeVue dropdown: <div class="p-dropdown" role="combobox" tabindex="0"> is interactive (tabindex)', () => {
    const Comp = defineComponent({
      template: `
        <div id="el" class="p-dropdown p-component" role="combobox" tabindex="0" aria-expanded="false">
          <span class="p-dropdown-label">Select</span>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('PrimeVue calendar navigate button: <button> inside .p-datepicker is interactive', () => {
    const Comp = defineComponent({
      template: `
        <div class="p-datepicker">
          <div class="p-datepicker-header">
            <button id="el" class="p-datepicker-prev">Navigate</button>
          </div>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('PrimeVue InputText: <input class="p-inputtext" type="text"> is interactive', () => {
    const Comp = defineComponent({
      template: `<input id="el" class="p-inputtext p-component" type="text" />`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('PrimeVue button: <button class="p-button"> is interactive', () => {
    const Comp = defineComponent({
      template: `<button id="el" class="p-button p-component">Submit</button>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('PrimeVue listbox item: <li role="option" tabindex="-1"> is interactive (tabindex)', () => {
    const Comp = defineComponent({
      template: `
        <ul class="p-listbox-list" role="listbox">
          <li id="el" class="p-listbox-item" role="option" tabindex="-1">Option 1</li>
        </ul>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('PrimeVue panel container div without interactive signals is NOT interactive', () => {
    const Comp = defineComponent({
      template: `
        <div id="el" class="p-panel p-component">
          <div class="p-panel-content">Content</div>
        </div>
      `,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contenteditable in Vue
// ---------------------------------------------------------------------------

describe('contenteditable in Vue', () => {
  it('div with contenteditable="true" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" contenteditable="true">Editable content</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with contenteditable="" is interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" contenteditable="">Editable content</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with contenteditable="false" is NOT interactive', () => {
    const Comp = defineComponent({
      template: `<div id="el" contenteditable="false">Not editable</div>`,
    });
    render(Comp);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });
});
