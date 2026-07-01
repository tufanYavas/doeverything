import { describe, expect, it } from 'vitest';
import { wrapInIife } from './scope-iife-helpers.js';

describe('wrapInIife', () => {
  it('wraps code in an outer arrow-function IIFE', () => {
    const code = 'var ve=Object.defineProperty;(function(){"use strict";})();';
    const wrapped = wrapInIife(code);
    expect(wrapped).toBe(`(()=>{\n${code}\n})();`);
  });

  it('starts with the outer IIFE opener', () => {
    expect(wrapInIife('console.log(1);')).toMatch(/^\(\(\)=>\{/);
  });

  it('ends with the outer IIFE closer', () => {
    expect(wrapInIife('console.log(1);')).toMatch(/\}\)\(\);$/);
  });

  it('contains the original code between the IIFE delimiters', () => {
    const code = 'var S=Object.create;var ye=Object.defineProperties;';
    const wrapped = wrapInIife(code);
    expect(wrapped).toContain(code);
  });

  it('handles empty code without crashing', () => {
    const wrapped = wrapInIife('');
    expect(wrapped).toBe('(()=>{\n\n})();');
  });

  it('does not add a second wrapping layer when called once', () => {
    const wrapped = wrapInIife('x();');
    // Only one top-level IIFE wrapper
    expect(wrapped.split('(()=>{').length).toBe(2);
  });
});
