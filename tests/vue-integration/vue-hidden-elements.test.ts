import { defineComponent, ref } from 'vue';
import { render } from '@testing-library/vue';
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

describe('v-if: element removed from DOM', () => {
  it('v-if="false" removes element from DOM entirely', async () => {
    const Comp = defineComponent({
      template: `<button v-if="false" id="btn">Click</button>`,
    });
    render(Comp);
    const el = document.getElementById('btn');
    expect(el).toBeNull();
  });

  it('v-if="true" keeps element in DOM', async () => {
    const Comp = defineComponent({
      template: `<button v-if="true" id="btn">Click</button>`,
    });
    render(Comp);
    const el = document.getElementById('btn');
    expect(el).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('v-if with ref="false" removes element from DOM', async () => {
    const Comp = defineComponent({
      setup() {
        const show = ref(false);
        return { show };
      },
      template: `<input id="inp" v-if="show" type="text" />`,
    });
    render(Comp);
    const el = document.getElementById('inp');
    expect(el).toBeNull();
  });

  it('nested: button inside v-if="false" div is null', async () => {
    const Comp = defineComponent({
      setup() {
        const show = ref(false);
        return { show };
      },
      template: `
        <div v-if="show" id="wrapper">
          <button id="inner-btn">Submit</button>
        </div>
      `,
    });
    render(Comp);
    expect(document.getElementById('wrapper')).toBeNull();
    expect(document.getElementById('inner-btn')).toBeNull();
  });

  it('nested: button inside v-if="true" div is in DOM and interactive', async () => {
    const Comp = defineComponent({
      setup() {
        const show = ref(true);
        return { show };
      },
      template: `
        <div v-if="show" id="wrapper">
          <button id="inner-btn">Submit</button>
        </div>
      `,
    });
    render(Comp);
    const wrapper = document.getElementById('wrapper');
    const btn = document.getElementById('inner-btn');
    expect(wrapper).not.toBeNull();
    expect(btn).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('v-if="true" makes element appear in DOM and interactive', async () => {
    const Comp = defineComponent({
      template: `<input id="toggle-inp" v-if="true" type="text" />`,
    });
    render(Comp);
    const el = document.getElementById('toggle-inp');
    expect(el).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });
});

describe('v-show: element stays in DOM but gets display:none', () => {
  it('v-show="false" on button → display:none → not interactive', async () => {
    const Comp = defineComponent({
      template: `<button id="btn" v-show="false">Click</button>`,
    });
    render(Comp);
    const el = document.getElementById('btn') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).toBe('none');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('v-show="true" on button → visible → interactive', async () => {
    const Comp = defineComponent({
      template: `<button id="btn" v-show="true">Click</button>`,
    });
    render(Comp);
    const el = document.getElementById('btn') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).not.toBe('none');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('v-show="false" on div containing button → button interactive (happy-dom: display:none not cascaded)', async () => {
    const Comp = defineComponent({
      template: `
        <div v-show="false" id="outer">
          <button id="inner-btn">Submit</button>
        </div>
      `,
    });
    render(Comp);
    const outer = document.getElementById('outer') as HTMLElement;
    const btn = document.getElementById('inner-btn');
    expect(outer).not.toBeNull();
    expect(outer.style.display).toBe('none');
    expect(btn).not.toBeNull();
    const result = scan();
    // happy-dom: getComputedStyle on child does not inherit parent display:none
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('v-show="true" on div containing button → button interactive', async () => {
    const Comp = defineComponent({
      template: `
        <div v-show="true" id="outer">
          <button id="inner-btn">Submit</button>
        </div>
      `,
    });
    render(Comp);
    const btn = document.getElementById('inner-btn');
    expect(btn).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('v-show=false on element directly: element has display:none and is not interactive', async () => {
    const Comp = defineComponent({
      template: `<button id="btn" v-show="false">Click</button>`,
    });
    render(Comp);
    const el = document.getElementById('btn') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).toBe('none');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('v-show=true on element directly: element is visible and interactive', async () => {
    const Comp = defineComponent({
      template: `<input id="inp" v-show="true" type="text" />`,
    });
    render(Comp);
    const el = document.getElementById('inp') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).not.toBe('none');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });
});

describe('CSS-hidden inputs remain interactive', () => {
  it('input with opacity:0 is excluded (isElementTrulyVisible checks opacity:0)', async () => {
    const Comp = defineComponent({
      template: `
        <input
          id="styled-inp"
          type="checkbox"
          style="opacity:0; position:absolute; width:0; height:0;"
        />
      `,
    });
    render(Comp);
    const el = document.getElementById('styled-inp');
    expect(el).not.toBeNull();
    const result = scan();
    // getComputedStyle(el).opacity === '0' → isElementTrulyVisible returns false → excluded
    expect(isInteractive(result, el)).toBe(false);
  });

  it('input with clip-path:inset(100%) is still interactive', async () => {
    const Comp = defineComponent({
      template: `
        <input
          id="clipped-inp"
          type="text"
          style="clip-path: inset(100%); position: absolute;"
        />
      `,
    });
    render(Comp);
    const el = document.getElementById('clipped-inp');
    expect(el).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="hidden" is NOT interactive (dom-processor explicitly excludes hidden type)', async () => {
    const Comp = defineComponent({
      template: `<input id="hidden-inp" type="hidden" name="csrf" value="abc123" />`,
    });
    render(Comp);
    const el = document.getElementById('hidden-inp');
    expect(el).not.toBeNull();
    const result = scan();
    // isElementVisible: if (element.type === 'hidden') return false
    expect(isInteractive(result, el)).toBe(false);
  });

  it('select with visibility:hidden is excluded', async () => {
    const Comp = defineComponent({
      template: `<select id="sel" style="visibility:hidden"><option>A</option></select>`,
    });
    render(Comp);
    const el = document.getElementById('sel');
    expect(el).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});

describe('v-show vs v-if difference', () => {
  it('v-if="false": getElementById returns null', async () => {
    const Comp = defineComponent({
      setup() {
        const show = ref(false);
        return { show };
      },
      template: `<button id="btn" v-if="show">Click</button>`,
    });
    render(Comp);
    expect(document.getElementById('btn')).toBeNull();
  });

  it('v-show="false": getElementById returns element but isInteractive is false', async () => {
    const Comp = defineComponent({
      setup() {
        const show = ref(false);
        return { show };
      },
      template: `<button id="btn" v-show="show">Click</button>`,
    });
    render(Comp);
    const el = document.getElementById('btn') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).toBe('none');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('v-if="true" and v-show="true" both make button interactive', async () => {
    const Comp = defineComponent({
      template: `
        <div>
          <button id="btn-vif" v-if="true">VIf</button>
          <button id="btn-vshow" v-show="true">VShow</button>
        </div>
      `,
    });
    render(Comp);
    const btnVif = document.getElementById('btn-vif');
    const btnVshow = document.getElementById('btn-vshow');
    expect(btnVif).not.toBeNull();
    expect(btnVshow).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, btnVif)).toBe(true);
    expect(isInteractive(result, btnVshow)).toBe(true);
  });
});

describe('Hidden loading states', () => {
  it('spinner div during loading is not interactive', async () => {
    const Comp = defineComponent({
      setup() {
        const loading = ref(true);
        return { loading };
      },
      template: `
        <div>
          <div v-if="loading" id="spinner" class="spinner" aria-label="Loading...">
            <div class="spin-icon"></div>
          </div>
          <button v-if="!loading" id="action-btn">Go</button>
        </div>
      `,
    });
    render(Comp);
    const spinner = document.getElementById('spinner');
    const btn = document.getElementById('action-btn');
    expect(spinner).not.toBeNull();
    expect(btn).toBeNull();
    const result = scan();
    expect(isInteractive(result, spinner)).toBe(false);
  });

  it('after loading completes, action button is interactive', async () => {
    const Comp = defineComponent({
      setup() {
        const loading = ref(false);
        return { loading };
      },
      template: `
        <div>
          <div v-if="loading" id="spinner" class="spinner">Loading...</div>
          <button v-if="!loading" id="action-btn">Go</button>
        </div>
      `,
    });
    render(Comp);
    const spinner = document.getElementById('spinner');
    const btn = document.getElementById('action-btn');
    expect(spinner).toBeNull();
    expect(btn).not.toBeNull();
    const result = scan();
    expect(isInteractive(result, btn)).toBe(true);
  });

  it('v-show loading: spinner div is not interactive (plain div); hidden content button IS interactive (cascade limitation)', async () => {
    const Comp = defineComponent({
      setup() {
        const loading = ref(true);
        return { loading };
      },
      template: `
        <div>
          <div v-show="loading" id="spinner">Loading...</div>
          <div v-show="!loading" id="content">
            <button id="content-btn">Submit</button>
          </div>
        </div>
      `,
    });
    render(Comp);
    const spinner = document.getElementById('spinner') as HTMLElement;
    const contentBtn = document.getElementById('content-btn');
    expect(spinner).not.toBeNull();
    expect(spinner.style.display).not.toBe('none');
    expect(contentBtn).not.toBeNull();

    const result = scan();
    // spinner: plain div, no interactive role → not interactive
    expect(isInteractive(result, spinner)).toBe(false);
    // content-btn: inside v-show=false div (display:none), but happy-dom doesn't cascade
    // display:none to children, so the button IS detected as interactive
    expect(isInteractive(result, contentBtn)).toBe(true);
  });

  it('v-show loaded: content button is interactive when content div is visible', async () => {
    const Comp = defineComponent({
      template: `
        <div>
          <div v-show="false" id="spinner">Loading...</div>
          <div v-show="true" id="content">
            <button id="content-btn">Submit</button>
          </div>
        </div>
      `,
    });
    render(Comp);
    const content = document.getElementById('content') as HTMLElement;
    expect(content.style.display).not.toBe('none');
    const result = scan();
    expect(isInteractive(result, document.getElementById('content-btn'))).toBe(true);
  });

  it('multiple conditional buttons: only visible ones are interactive', async () => {
    const Comp = defineComponent({
      setup() {
        const step = ref(1);
        return { step };
      },
      template: `
        <div>
          <button id="btn-step1" v-show="step === 1">Step 1</button>
          <button id="btn-step2" v-show="step === 2">Step 2</button>
          <button id="btn-step3" v-show="step === 3">Step 3</button>
        </div>
      `,
    });
    render(Comp);
    const btn1 = document.getElementById('btn-step1') as HTMLElement;
    const btn2 = document.getElementById('btn-step2') as HTMLElement;
    const btn3 = document.getElementById('btn-step3') as HTMLElement;

    expect(btn1).not.toBeNull();
    expect(btn2).not.toBeNull();
    expect(btn3).not.toBeNull();

    expect(btn1.style.display).not.toBe('none');
    expect(btn2.style.display).toBe('none');
    expect(btn3.style.display).toBe('none');

    const result = scan();
    expect(isInteractive(result, btn1)).toBe(true);
    expect(isInteractive(result, btn2)).toBe(false);
    expect(isInteractive(result, btn3)).toBe(false);
  });
});
