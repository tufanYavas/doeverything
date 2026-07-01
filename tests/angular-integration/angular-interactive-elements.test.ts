import { Component } from '@angular/core';
import { fireEvent, render } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
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
// Native HTML interactive elements in Angular
// ---------------------------------------------------------------------------

describe('Native HTML interactive elements in Angular', () => {
  it('button is interactive', async () => {
    @Component({
      standalone: true,
      template: `<button id="el">Click me</button>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="text"] is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="text" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="email"] is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="email" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="checkbox"] is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="checkbox" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="radio"] is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="radio" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('select is interactive', async () => {
    @Component({
      standalone: true,
      template: `<select id="el"><option value="a">A</option></select>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('textarea is interactive', async () => {
    @Component({
      standalone: true,
      template: `<textarea id="el"></textarea>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('a[href="#"] is interactive', async () => {
    @Component({
      standalone: true,
      template: `<a id="el" href="#">Link</a>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Angular-specific interaction patterns
// ---------------------------------------------------------------------------

describe('Angular-specific interaction patterns', () => {
  it('div with Angular (click) binding is NOT interactive (Angular uses event delegation, no onclick attr)', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" (click)="onClick()">Clickable div</div>`,
    })
    class TestComponent {
      onClick() {}
    }

    await render(TestComponent);
    const result = scan();
    // Angular event binding does NOT add an onclick HTML attribute — uses event delegation
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('button with Angular (click) binding is interactive (button tag)', async () => {
    @Component({
      standalone: true,
      template: `<button id="el" (click)="onClick()">Submit</button>`,
    })
    class TestComponent {
      onClick() {}
    }

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="text"] with value attribute binding is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="text" [value]="val" />`,
    })
    class TestComponent {
      val = 'hello';
    }

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input with required validator is interactive', async () => {
    @Component({
      standalone: true,
      template: `<form><input id="el" type="text" required /></form>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input with minlength validator attribute is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="text" minlength="3" maxlength="50" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('a tag rendered by Angular without href is still interactive (all anchors are interactive)', async () => {
    @Component({
      standalone: true,
      template: `<a id="el">Nav link</a>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ARIA roles rendered by Angular
// ---------------------------------------------------------------------------

describe('ARIA roles rendered by Angular', () => {
  it('div with role="button" is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="button">Custom Button</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with role="tab" is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="tab">Tab One</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with role="dialog" is NOT interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="dialog" aria-label="Modal">Content</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('div with role="menuitem" is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="menuitem">File</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with role="checkbox" is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="checkbox" aria-checked="false">Agree</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with role="switch" and aria-checked is interactive (aria-checked triggers axNode checked property)', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="switch" aria-checked="false">Toggle</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    // role="switch" is not in INTERACTIVE_ROLES, but aria-checked adds {name:'checked'} to axNode.properties.
    // The AX check returns true for any 'checked' property regardless of value.
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with role="alert" is NOT interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="alert">Error occurred</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('div with role="combobox" is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="combobox" aria-expanded="false">Select...</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('div with role="textbox" is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" role="textbox" contenteditable="true"></div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Angular Material-like patterns (simulated DOM)
// ---------------------------------------------------------------------------

describe('Angular Material-like patterns (simulated DOM)', () => {
  it('mat-button: <button mat-button> is interactive (button tag)', async () => {
    @Component({
      standalone: true,
      template: `<button id="el" mat-button>Material Button</button>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('mat-checkbox: input[type="checkbox"] inside mat-checkbox wrapper is interactive', async () => {
    @Component({
      standalone: true,
      template: `
        <div class="mat-checkbox">
          <input id="el" type="checkbox" class="mat-checkbox-input" />
          <label>Accept terms</label>
        </div>
      `,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('mat-select trigger: div with role="combobox" and tabindex="0" is interactive', async () => {
    @Component({
      standalone: true,
      template: `
        <div id="el" class="mat-select-trigger" role="combobox" tabindex="0" aria-expanded="false">
          <span class="mat-select-value">Select option</span>
        </div>
      `,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('mat-slider: div with role="slider" and tabindex="0" is interactive', async () => {
    @Component({
      standalone: true,
      template: `
        <div id="el" class="mat-slider" role="slider" tabindex="0"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
        </div>
      `,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('mat-radio-button: input[type="radio"] inside wrapper is interactive', async () => {
    @Component({
      standalone: true,
      template: `
        <div class="mat-radio-button">
          <input id="el" type="radio" class="mat-radio-input" />
          <label>Option A</label>
        </div>
      `,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('mat-form-field wrapper div is NOT interactive on its own', async () => {
    @Component({
      standalone: true,
      template: `
        <div id="el" class="mat-form-field">
          <input type="text" />
        </div>
      `,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('cdk-overlay-container div is NOT interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" class="cdk-overlay-container"></div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Angular forms with validation states
// ---------------------------------------------------------------------------

describe('Angular forms with validation states', () => {
  it('required input is interactive', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="text" required />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('disabled input is NOT detected (AX disabled property returns false before INTERACTIVE_TAGS check)', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="text" disabled />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    // axNode.properties includes { name:'disabled', value:true } for disabled form elements.
    // isInteractive returns false early when prop.name==='disabled' && prop.value===true.
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('readonly input is interactive (input tag)', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="text" readonly value="fixed" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('input[type="hidden"] is NOT detected (dom-processor explicitly excludes hidden type)', async () => {
    @Component({
      standalone: true,
      template: `<input id="el" type="hidden" value="token123" />`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    // isElementVisible: if (element.type === 'hidden') return false
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('disabled button is still interactive (button tag)', async () => {
    @Component({
      standalone: true,
      template: `<button id="el" disabled>Submit</button>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('form element containing inputs is NOT itself interactive', async () => {
    @Component({
      standalone: true,
      template: `
        <form id="el">
          <input type="text" />
          <button type="submit">Go</button>
        </form>
      `,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });

  it('tabindex="0" on a div makes it interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" tabindex="0">Focusable div</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('tabindex="-1" on a div makes it interactive (any tabindex value triggers)', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" tabindex="-1">Programmatic focus div</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('contenteditable="true" div is interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" contenteditable="true">Edit me</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(true);
  });

  it('contenteditable="false" div is NOT interactive', async () => {
    @Component({
      standalone: true,
      template: `<div id="el" contenteditable="false">Read only</div>`,
    })
    class TestComponent {}

    await render(TestComponent);
    const result = scan();
    expect(isInteractive(result, document.getElementById('el'))).toBe(false);
  });
});
