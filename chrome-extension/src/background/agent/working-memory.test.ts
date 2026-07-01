import {
  clearWorkingMemory,
  memoryAppend,
  memoryBuckets,
  memoryClear,
  memoryCount,
  memoryRead,
  memorySet,
  resetAllWorkingMemory,
} from './working-memory.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CONV = 'conv-1';

beforeEach(resetAllWorkingMemory);

describe('working memory', () => {
  it('set replaces a bucket and returns the count', () => {
    expect(memorySet(CONV, 'links', ['a', 'b'])).toBe(2);
    expect(memoryRead(CONV, 'links')).toEqual(['a', 'b']);
    expect(memorySet(CONV, 'links', ['c'])).toBe(1);
    expect(memoryRead(CONV, 'links')).toEqual(['c']);
  });

  it('append adds to a bucket and returns the new total', () => {
    memorySet(CONV, 'links', ['a']);
    expect(memoryAppend(CONV, 'links', ['b', 'c'])).toBe(3);
    expect(memoryRead(CONV, 'links')).toEqual(['a', 'b', 'c']);
  });

  it('append to a fresh bucket starts it', () => {
    expect(memoryAppend(CONV, 'new', ['x'])).toBe(1);
  });

  it('count reflects bucket size; empty for unknown bucket', () => {
    memorySet(CONV, 'links', ['a', 'b', 'c']);
    expect(memoryCount(CONV, 'links')).toBe(3);
    expect(memoryCount(CONV, 'missing')).toBe(0);
    expect(memoryRead(CONV, 'missing')).toEqual([]);
  });

  it('clear removes a bucket and reports whether it existed', () => {
    memorySet(CONV, 'links', ['a']);
    expect(memoryClear(CONV, 'links')).toBe(true);
    expect(memoryClear(CONV, 'links')).toBe(false);
    expect(memoryCount(CONV, 'links')).toBe(0);
  });

  it('buckets lists names with counts', () => {
    memorySet(CONV, 'links', ['a', 'b']);
    memorySet(CONV, 'notes', ['n']);
    expect(memoryBuckets(CONV)).toEqual(
      expect.arrayContaining([
        { name: 'links', count: 2 },
        { name: 'notes', count: 1 },
      ]),
    );
  });

  it('is scoped per conversation; clearWorkingMemory drops only that conversation', () => {
    memorySet('a', 'b', [1]);
    memorySet('b', 'b', [2]);
    clearWorkingMemory('a');
    expect(memoryCount('a', 'b')).toBe(0);
    expect(memoryCount('b', 'b')).toBe(1);
  });
});
