import {
  executeMemoryRead,
  MAX_ITEMS_PER_CALL,
  MAX_ITEMS_BYTES_PER_CALL,
  MAX_STRING_CHARS_PER_CALL,
} from './memory-read-core.js';
import { describe, expect, it } from 'vitest';
import type { MemoryReadOptions } from './memory-read-core.js';

/**
 * `executeMemoryRead` is the shared, pure paging/describe/byte-budget engine
 * for `memory_get`. It is backend-agnostic: callers hand it a resolved items
 * array and the read params, and it returns the exact JSON-shaped response the
 * SDK ships to the model. No storage involved, so these are straight
 * input→output assertions of the real shapes (including the hard caps).
 */
function read(items: unknown[], opts: Partial<MemoryReadOptions> = {}): Record<string, unknown> {
  return executeMemoryRead(items, { bucket: 'b', ...opts }) as Record<string, unknown>;
}

describe('executeMemoryRead — empty bucket', () => {
  it('returns a zero-total empty payload with the default hint', () => {
    expect(read([])).toEqual({
      bucket: 'b',
      total: 0,
      items: [],
      hint: 'Bucket "b" is empty or missing.',
    });
  });

  it('uses emptyHint and spreads extra tags when provided', () => {
    const res = read([], { emptyHint: 'no seen-ids for x.com yet', extra: { domain: 'x.com', persistent: true } });
    expect(res).toEqual({
      bucket: 'b',
      domain: 'x.com',
      persistent: true,
      total: 0,
      items: [],
      hint: 'no seen-ids for x.com yet',
    });
  });
});

describe('executeMemoryRead — array paging', () => {
  it('returns the default first page (limit 50) with paging metadata', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ i }));
    const res = read(items);
    expect(res.total).toBe(120);
    expect(res.offset).toBe(0);
    expect(res.returned).toBe(50);
    expect(res.hasMore).toBe(true);
    expect(res.nextOffset).toBe(50);
    expect((res.items as unknown[]).length).toBe(50);
  });

  it('honors offset and limit; omits nextOffset on the last page', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const res = read(items, { offset: 8, limit: 5 });
    expect(res.offset).toBe(8);
    expect(res.returned).toBe(2);
    expect(res.items).toEqual([8, 9]);
    expect(res.hasMore).toBe(false);
    expect(res).not.toHaveProperty('nextOffset');
  });

  it('clamps limit to MAX_ITEMS_PER_CALL and reports the clamp', () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const res = read(items, { limit: 1000 });
    expect(res.returned).toBe(MAX_ITEMS_PER_CALL);
    expect(res.clamped).toEqual({ limitRequested: 1000, limitApplied: MAX_ITEMS_PER_CALL });
  });

  it('projects only requested fields, dropping unknown fields and leaving non-objects intact', () => {
    const items = [
      { id: 1, name: 'a', extra: 'drop' },
      { id: 2, name: 'b' },
      42, // non-object passes through untouched
    ];
    const res = read(items, { fields: ['id', 'name', 'missing'] });
    expect(res.items).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, 42]);
  });

  it('trims from the tail when the serialized slice exceeds the byte budget', () => {
    // Each item ~1KB; 50 of them blows past the 30KB cap, forcing a tail trim.
    const big = 'q'.repeat(1000);
    const items = Array.from({ length: 50 }, (_, i) => ({ i, big }));
    const res = read(items, { limit: 50 });

    expect(res.truncatedDueToSize).toBe(true);
    expect(typeof res.hint).toBe('string');
    expect(res.returned as number).toBeLessThan(50);
    // hasMore should be true since we trimmed before the real end.
    expect(res.hasMore).toBe(true);
    // Serialized size of the returned slice stays within budget.
    expect(JSON.stringify(res.items).length).toBeLessThanOrEqual(MAX_ITEMS_BYTES_PER_CALL);
  });

  it('keeps at least one item even if that single item exceeds the byte budget', () => {
    const giant = { blob: 'w'.repeat(MAX_ITEMS_BYTES_PER_CALL + 5000) };
    const res = read([giant], { limit: 50 });
    // The while-loop guard is `projected.length > 1`, so a lone oversized item survives.
    expect(res.returned).toBe(1);
    expect(res.truncatedDueToSize).toBeUndefined();
  });
});

describe('executeMemoryRead — single-string paging', () => {
  it('char-indexed slices a single-string bucket with the default 4000 window', () => {
    const text = 'a'.repeat(10_000);
    const res = read([text]);
    expect(res.type).toBe('string');
    expect(res.total).toBe(10_000);
    expect(res.offset).toBe(0);
    expect(res.returned).toBe(4000);
    expect(res.truncated).toBe(true);
    expect(res.nextOffset).toBe(4000);
    expect(res.text).toBe('a'.repeat(4000));
  });

  it('returns the tail without truncation flag once the end is reached', () => {
    const text = 'b'.repeat(100);
    const res = read([text], { offset: 90, limit: 50 });
    expect(res.returned).toBe(10);
    expect(res.truncated).toBe(false);
    expect(res).not.toHaveProperty('nextOffset');
    expect(res.text).toBe('b'.repeat(10));
  });

  it('clamps a string limit to MAX_STRING_CHARS_PER_CALL and reports it', () => {
    const text = 'c'.repeat(100_000);
    const res = read([text], { limit: 99_999 });
    expect(res.returned).toBe(MAX_STRING_CHARS_PER_CALL);
    expect(res.clamped).toEqual({ limitRequested: 99_999, limitApplied: MAX_STRING_CHARS_PER_CALL });
  });

  it('a multi-element array is NOT treated as a single string', () => {
    const res = read(['one', 'two']);
    expect(res.type).toBeUndefined();
    expect(res.items).toEqual(['one', 'two']);
  });
});

describe('executeMemoryRead — describe mode', () => {
  it('returns a shape report instead of values', () => {
    const items = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }];
    const res = read(items, { describe: true });
    expect(res.bucket).toBe('b');
    expect(res.path).toBe('$');
    expect(res.type).toBe('array');
    expect(res.total).toBe(3);
    expect(typeof res.schema).toBe('string');
    expect(res).not.toHaveProperty('items');
  });
});

describe('executeMemoryRead — JSONPath drill-down', () => {
  it('drills into a sub-tree — a `prop` step yields the matched node itself, not its flattened elements', () => {
    const items = [{ users: [{ id: 1 }, { id: 2 }] }];
    const res = read(items, { path: '$[0].users' });
    expect(res.path).toBe('$[0].users');
    // applySteps matches the `users` array as ONE node, so working = [theArray]:
    // total is 1 and the single returned item is the whole array.
    expect(res.total).toBe(1);
    expect(res.items).toEqual([[{ id: 1 }, { id: 2 }]]);
  });

  it('a wildcard step flattens the matched array into individual paged items', () => {
    const items = [{ users: [{ id: 1 }, { id: 2 }, { id: 3 }] }];
    const res = read(items, { path: '$[0].users[*]' });
    expect(res.total).toBe(3);
    expect(res.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('drills to a single string and switches to char paging', () => {
    const items = [{ note: 'hello world' }];
    const res = read(items, { path: '$[0].note' });
    expect(res.type).toBe('string');
    expect(res.total).toBe(11);
    expect(res.text).toBe('hello world');
    expect(res.path).toBe('$[0].note');
  });

  it('returns a path-matched-no-nodes hint when the path resolves to nothing', () => {
    const items = [{ a: 1 }];
    const res = read(items, { path: '$[0].nope' });
    expect(res.hint).toBe('path matched no nodes: $[0].nope');
    expect(res.bucket).toBe('b');
  });

  it('propagates a parse error (and the tag) for an invalid path', () => {
    const items = [{ a: 1 }];
    const res = read(items, { path: '$[unclosed', extra: { domain: 'x.com' } });
    expect(res.domain).toBe('x.com');
    expect(typeof res.error).toBe('string');
    expect(res.error as string).toContain('unmatched');
  });

  it("treats path '$' as the whole bucket (no drill, no path echoed)", () => {
    const items = [1, 2, 3];
    const res = read(items, { path: '$' });
    expect(res.total).toBe(3);
    expect(res.items).toEqual([1, 2, 3]);
    expect(res).not.toHaveProperty('path');
  });
});
