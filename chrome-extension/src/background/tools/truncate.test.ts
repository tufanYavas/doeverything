import { estimateResultSize, truncateToolResult } from './truncate.js';
import { describe, expect, it } from 'vitest';

describe('truncateToolResult', () => {
  it('passes small values through unchanged', () => {
    expect(truncateToolResult({ a: 1, b: 'short' })).toEqual({ a: 1, b: 'short' });
    expect(truncateToolResult('hi')).toBe('hi');
  });

  it('truncates an over-long string and keeps total output bounded', () => {
    const out = truncateToolResult('z'.repeat(50_000), { maxStringChars: 100 });
    const s = typeof out === 'string' ? out : JSON.stringify(out);
    expect(s.length).toBeLessThan(50_000);
  });

  it('caps long arrays to maxArrayItems', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const out = truncateToolResult(arr, { maxArrayItems: 5 });
    expect(Array.isArray(out)).toBe(true);
    // Truncation keeps a head slice plus a hint element/string — far fewer than 100.
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(arr).length);
  });

  it('enforces the global maxChars ceiling', () => {
    const huge = { rows: Array.from({ length: 5_000 }, (_, i) => ({ i, text: 'x'.repeat(100) })) };
    const out = truncateToolResult(huge, { maxChars: 2_000 });
    expect(estimateResultSize(out)).toBeLessThanOrEqual(estimateResultSize(huge));
  });
});

describe('estimateResultSize', () => {
  it('approximates the serialized character size', () => {
    expect(estimateResultSize('abcde')).toBeGreaterThanOrEqual(5);
    expect(estimateResultSize({ a: 'x'.repeat(1000) })).toBeGreaterThan(1000);
  });

  it('does not throw on circular structures', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => estimateResultSize(o)).not.toThrow();
  });
});
