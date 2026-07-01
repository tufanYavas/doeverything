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

describe('Plain contenteditable', () => {
  it('div contenteditable="true" → interactive', () => {
    render(<div contentEditable="true" />);
    const el = document.querySelector('div[contenteditable="true"]');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div contenteditable="" (empty string) → interactive', () => {
    render(<div contentEditable="" />);
    const el = document.querySelector('div[contenteditable=""]');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('div contenteditable="false" → NOT interactive', () => {
    render(<div contentEditable="false" id="ce-false" />);
    const el = document.querySelector('#ce-false');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('span contenteditable="true" → interactive', () => {
    render(<span contentEditable="true" id="ce-span" />);
    const el = document.querySelector('#ce-span');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('p contenteditable="true" → interactive', () => {
    render(<p contentEditable="true" id="ce-p" />);
    const el = document.querySelector('#ce-p');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });
});

describe('TipTap / ProseMirror editor structure', () => {
  function TipTapEditor() {
    return (
      <div id="tiptap-root">
        <div id="toolbar">
          <button id="bold-btn">Bold</button>
          <button id="italic-btn">Italic</button>
        </div>
        <div
          className="ProseMirror"
          contentEditable="true"
          role="textbox"
          aria-multiline="true"
          translate="no"
          id="prosemirror-editor"
        >
          <p id="pm-paragraph-1">Hello world</p>
          <p id="pm-paragraph-2">Second paragraph</p>
        </div>
      </div>
    );
  }

  it('ProseMirror editor div is interactive (contenteditable + role=textbox)', () => {
    render(<TipTapEditor />);
    const el = document.querySelector('#prosemirror-editor');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('paragraph children inside ProseMirror → NOT interactive', () => {
    render(<TipTapEditor />);
    const p1 = document.querySelector('#pm-paragraph-1');
    const p2 = document.querySelector('#pm-paragraph-2');
    const result = scan();
    expect(isInteractive(result, p1)).toBe(false);
    expect(isInteractive(result, p2)).toBe(false);
  });

  it('toolbar buttons outside ProseMirror → interactive', () => {
    render(<TipTapEditor />);
    const boldBtn = document.querySelector('#bold-btn');
    const italicBtn = document.querySelector('#italic-btn');
    const result = scan();
    expect(isInteractive(result, boldBtn)).toBe(true);
    expect(isInteractive(result, italicBtn)).toBe(true);
  });
});

describe('Quill editor structure', () => {
  function QuillEditor() {
    return (
      <div id="quill-root">
        <div className="ql-toolbar" id="ql-toolbar">
          <button className="ql-bold" id="ql-bold-btn" />
          <button className="ql-italic" id="ql-italic-btn" />
          <span className="ql-formats" id="ql-formats-span">
            <span className="ql-font" id="ql-font-span" />
          </span>
        </div>
        <div className="ql-container">
          <div
            className="ql-editor"
            contentEditable="true"
            data-gramm="false"
            id="ql-editor"
          >
            <p>Start typing here...</p>
          </div>
        </div>
      </div>
    );
  }

  it('ql-editor div → interactive (contenteditable)', () => {
    render(<QuillEditor />);
    const el = document.querySelector('#ql-editor');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('ql-toolbar buttons → interactive', () => {
    render(<QuillEditor />);
    const boldBtn = document.querySelector('#ql-bold-btn');
    const italicBtn = document.querySelector('#ql-italic-btn');
    const result = scan();
    expect(isInteractive(result, boldBtn)).toBe(true);
    expect(isInteractive(result, italicBtn)).toBe(true);
  });

  it('non-interactive toolbar spans → NOT interactive', () => {
    render(<QuillEditor />);
    const formatsSpan = document.querySelector('#ql-formats-span');
    const fontSpan = document.querySelector('#ql-font-span');
    const result = scan();
    expect(isInteractive(result, formatsSpan)).toBe(false);
    expect(isInteractive(result, fontSpan)).toBe(false);
  });
});

describe('Lexical / Draft.js editor structure', () => {
  function LexicalEditor() {
    return (
      <div id="lexical-root">
        <div
          contentEditable="true"
          role="textbox"
          aria-multiline="true"
          spellCheck="true"
          data-lexical-editor="true"
          id="lexical-editor"
        >
          <p className="editor-paragraph" id="lexical-para">
            <span id="lexical-inner-span">Some text content</span>
          </p>
          <div id="lexical-inner-div">Another block</div>
        </div>
      </div>
    );
  }

  it('Lexical editor div → interactive (contenteditable + role=textbox)', () => {
    render(<LexicalEditor />);
    const el = document.querySelector('#lexical-editor');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('internal paragraph spans → NOT interactive (no interactive attrs)', () => {
    render(<LexicalEditor />);
    const span = document.querySelector('#lexical-inner-span');
    const result = scan();
    expect(isInteractive(result, span)).toBe(false);
  });

  it('internal paragraph element → NOT interactive', () => {
    render(<LexicalEditor />);
    const para = document.querySelector('#lexical-para');
    const result = scan();
    expect(isInteractive(result, para)).toBe(false);
  });

  it('internal div without contenteditable → NOT interactive', () => {
    render(<LexicalEditor />);
    const innerDiv = document.querySelector('#lexical-inner-div');
    const result = scan();
    expect(isInteractive(result, innerDiv)).toBe(false);
  });
});

describe('CodeMirror editor structure', () => {
  function CodeMirrorEditor() {
    return (
      <div className="cm-editor" id="cm-editor">
        <div className="cm-scroller">
          <div
            className="cm-content"
            contentEditable="true"
            role="textbox"
            aria-multiline="true"
            id="cm-content"
          >
            <div className="cm-line" id="cm-line-1">const x = 1;</div>
            <div className="cm-line" id="cm-line-2">const y = 2;</div>
          </div>
        </div>
      </div>
    );
  }

  it('cm-content div → interactive (contenteditable)', () => {
    render(<CodeMirrorEditor />);
    const el = document.querySelector('#cm-content');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('cm-editor outer div → NOT interactive (no contenteditable, no interactive role)', () => {
    render(<CodeMirrorEditor />);
    const el = document.querySelector('#cm-editor');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('cm-line elements inside → NOT interactive', () => {
    render(<CodeMirrorEditor />);
    const line1 = document.querySelector('#cm-line-1');
    const line2 = document.querySelector('#cm-line-2');
    const result = scan();
    expect(isInteractive(result, line1)).toBe(false);
    expect(isInteractive(result, line2)).toBe(false);
  });
});

describe('Monaco editor structure', () => {
  function MonacoEditor() {
    return (
      <div className="monaco-editor" id="monaco-root">
        <div className="overflow-guard">
          <div className="monaco-scrollable-element">
            <div className="lines-content" id="monaco-lines">
              <div className="view-line" id="monaco-view-line">
                <span>function hello() {'{}'}</span>
              </div>
            </div>
          </div>
          <textarea
            className="inputarea"
            aria-label="Editor content"
            id="monaco-textarea"
            style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', opacity: 0 }}
          />
        </div>
      </div>
    );
  }

  it('hidden textarea (monaco inputarea) is excluded (opacity:0 is filtered by isElementTrulyVisible)', () => {
    render(<MonacoEditor />);
    const el = document.querySelector('#monaco-textarea');
    const result = scan();
    // Monaco hides its textarea via opacity:0. isElementTrulyVisible excludes opacity:0 elements.
    // In a real extension this textarea would be missed — editors expose contenteditable instead.
    expect(isInteractive(result, el)).toBe(false);
  });

  it('overlay div (monaco-lines) without contenteditable → NOT interactive', () => {
    render(<MonacoEditor />);
    const el = document.querySelector('#monaco-lines');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });

  it('view-line div without contenteditable → NOT interactive', () => {
    render(<MonacoEditor />);
    const el = document.querySelector('#monaco-view-line');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});

describe('Inline editing patterns', () => {
  it('span[contenteditable="true"] for inline editing → interactive', () => {
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <span contentEditable="true" id="inline-editable-span">
                Editable cell content
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    );
    const el = document.querySelector('#inline-editable-span');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('td[contenteditable="true"] → interactive', () => {
    render(
      <table>
        <tbody>
          <tr>
            <td contentEditable="true" id="editable-td">
              Editable table cell
            </td>
          </tr>
        </tbody>
      </table>
    );
    const el = document.querySelector('#editable-td');
    const result = scan();
    expect(isInteractive(result, el)).toBe(true);
  });

  it('non-editable td → NOT interactive', () => {
    render(
      <table>
        <tbody>
          <tr>
            <td id="plain-td">Plain cell</td>
          </tr>
        </tbody>
      </table>
    );
    const el = document.querySelector('#plain-td');
    const result = scan();
    expect(isInteractive(result, el)).toBe(false);
  });
});
