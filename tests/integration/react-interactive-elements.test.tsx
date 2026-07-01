import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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

describe('Native interactive HTML tags', () => {
  it('button is interactive', () => {
    const { container } = render(<button id="el">Click me</button>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="text" is interactive', () => {
    const { container } = render(<input id="el" type="text" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="email" is interactive', () => {
    const { container } = render(<input id="el" type="email" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="password" is interactive', () => {
    const { container } = render(<input id="el" type="password" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="checkbox" is interactive', () => {
    const { container } = render(<input id="el" type="checkbox" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="radio" is interactive', () => {
    const { container } = render(<input id="el" type="radio" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="range" is interactive', () => {
    const { container } = render(<input id="el" type="range" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="file" is interactive', () => {
    const { container } = render(<input id="el" type="file" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="submit" is interactive', () => {
    const { container } = render(<input id="el" type="submit" value="Submit" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="number" is interactive', () => {
    const { container } = render(<input id="el" type="number" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="date" is interactive', () => {
    const { container } = render(<input id="el" type="date" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('input type="color" is interactive', () => {
    const { container } = render(<input id="el" type="color" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('select is interactive', () => {
    const { container } = render(
      <select id="el">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('option inside select is interactive', () => {
    const { container } = render(
      <select>
        <option id="el" value="a">A</option>
      </select>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('textarea is interactive', () => {
    const { container } = render(<textarea id="el" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('a with href is interactive', () => {
    const { container } = render(<a id="el" href="#">Link</a>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('a without href is interactive (a is in INTERACTIVE_TAGS)', () => {
    const { container } = render(<a id="el">Bare anchor</a>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('details is interactive', () => {
    const { container } = render(
      <details id="el">
        <summary>Summary</summary>
        Content
      </details>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('summary is interactive', () => {
    const { container } = render(
      <details>
        <summary id="el">Summary</summary>
        Content
      </details>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });
});

describe('ARIA role-based interactivity', () => {
  it('div role="button" is interactive', () => {
    const { container } = render(<div id="el" role="button">Button</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="link" is interactive', () => {
    const { container } = render(<div id="el" role="link">Link</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="menuitem" is interactive', () => {
    const { container } = render(<div id="el" role="menuitem">Menu item</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="option" is interactive', () => {
    const { container } = render(<div id="el" role="option">Option</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="radio" is interactive', () => {
    const { container } = render(<div id="el" role="radio">Radio</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="checkbox" is interactive', () => {
    const { container } = render(<div id="el" role="checkbox">Checkbox</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="tab" is interactive', () => {
    const { container } = render(<div id="el" role="tab">Tab</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="textbox" is interactive', () => {
    const { container } = render(<div id="el" role="textbox">Text</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="combobox" is interactive', () => {
    const { container } = render(<div id="el" role="combobox">Combo</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="slider" is interactive', () => {
    const { container } = render(<div id="el" role="slider">Slider</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="spinbutton" is interactive', () => {
    const { container } = render(<div id="el" role="spinbutton">Spin</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="search" is interactive', () => {
    const { container } = render(<div id="el" role="search">Search</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="searchbox" is interactive', () => {
    const { container } = render(<div id="el" role="searchbox">Searchbox</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="row" is interactive', () => {
    const { container } = render(<div id="el" role="row">Row</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="gridcell" is interactive', () => {
    const { container } = render(<div id="el" role="gridcell">Cell</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="cell" is interactive', () => {
    const { container } = render(<div id="el" role="cell">Cell</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div role="switch" is NOT interactive (not in INTERACTIVE_ROLES)', () => {
    const { container } = render(<div id="el" role="switch">Switch</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('div role="dialog" is NOT interactive', () => {
    const { container } = render(<div id="el" role="dialog">Dialog</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('div role="alert" is NOT interactive', () => {
    const { container } = render(<div id="el" role="alert">Alert</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('div role="listitem" is NOT interactive', () => {
    const { container } = render(<div id="el" role="listitem">Item</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('div role="group" is NOT interactive', () => {
    const { container } = render(<div id="el" role="group">Group</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});

describe('Attribute-based interactivity', () => {
  it('div with tabindex="0" is interactive', () => {
    const { container } = render(<div id="el" tabIndex={0}>Tab zero</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div with tabindex="-1" is interactive (any tabindex triggers it)', () => {
    const { container } = render(<div id="el" tabIndex={-1}>Tab minus one</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div contenteditable="true" is interactive', () => {
    const { container } = render(
      <div id="el" contentEditable="true" suppressContentEditableWarning>Editable</div>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div contenteditable="" (empty string) is interactive', () => {
    const { container } = render(
      // Use dangerouslySetInnerHTML approach via a wrapper to set empty contenteditable
      <div id="wrapper" />
    );
    const wrapper = container.querySelector('#wrapper')!;
    wrapper.innerHTML = '<div id="el" contenteditable="">Editable</div>';
    const el = wrapper.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div contenteditable="false" is NOT interactive', () => {
    const { container } = render(
      <div id="el" contentEditable="false" suppressContentEditableWarning>Not editable</div>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});

describe('Label and span form control wrappers', () => {
  it('label wrapping input (no for attr) is interactive', () => {
    const { container } = render(
      <label id="el">
        Name <input type="text" />
      </label>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('label with for attribute is NOT interactive', () => {
    const { container } = render(
      <>
        <label id="el" htmlFor="myInput">Label</label>
        <input id="myInput" type="text" />
      </>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('label without for AND without form control is NOT interactive', () => {
    const { container } = render(
      <label id="el">Plain label text</label>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('span wrapping input directly is interactive (depth<=2)', () => {
    const { container } = render(
      <span id="el">
        <input type="text" />
      </span>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });
});

describe('Search indicator detection', () => {
  it('div with class="search-box" is interactive', () => {
    const { container } = render(<div id="el" className="search-box">Search</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div with id="search" is interactive', () => {
    const { container } = render(<div id="search">Search</div>);
    const el = document.getElementById('search');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div with class="magnify-icon" is interactive', () => {
    const { container } = render(<div id="el" className="magnify-icon">Search</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div with class="find-button" is interactive', () => {
    const { container } = render(<div id="el" className="find-button">Find</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('plain div without search indicator is NOT interactive', () => {
    const { container } = render(<div id="el">Plain div</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});

describe('Non-interactive elements', () => {
  it('plain div is not interactive', () => {
    const { container } = render(<div id="el">Plain div</div>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('p with text is not interactive', () => {
    const { container } = render(<p id="el">Some paragraph text</p>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('h1 is not interactive', () => {
    const { container } = render(<h1 id="el">Heading</h1>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('ul is not interactive', () => {
    const { container } = render(
      <ul id="el">
        <li>Item</li>
      </ul>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('li is not interactive', () => {
    const { container } = render(
      <ul>
        <li id="el">List item</li>
      </ul>
    );
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('nav is not interactive', () => {
    const { container } = render(<nav id="el">Navigation</nav>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('section is not interactive', () => {
    const { container } = render(<section id="el">Section content</section>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('span without form control is not interactive', () => {
    const { container } = render(<span id="el">Plain span</span>);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('img without special attrs is not interactive', () => {
    const { container } = render(<img id="el" src="test.png" alt="test" />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('video controls is not interactive (video is not in INTERACTIVE_TAGS)', () => {
    const { container } = render(<video id="el" controls />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('audio controls is not interactive', () => {
    const { container } = render(<audio id="el" controls />);
    const el = container.querySelector('#el');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});
