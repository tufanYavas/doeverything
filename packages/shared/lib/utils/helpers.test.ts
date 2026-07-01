import { excludeValuesFromBaseArray, sleep } from './helpers.js';
import { describe, expect, it, vi } from 'vitest';

describe('excludeValuesFromBaseArray', () => {
  it('removes excluded values, preserving order of the rest', () => {
    expect(excludeValuesFromBaseArray(['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual(['a', 'c']);
  });
  it('returns the base array unchanged when nothing is excluded', () => {
    expect(excludeValuesFromBaseArray(['a', 'b'], [])).toEqual(['a', 'b']);
  });
  it('returns empty when everything is excluded', () => {
    expect(excludeValuesFromBaseArray(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    vi.useFakeTimers();
    let done = false;
    const p = sleep(500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
