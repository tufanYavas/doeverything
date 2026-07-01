import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  PREVIEW_SIZE_BYTES,
  compressToolResult,
  generatePreview,
  getPersistenceThreshold,
  nextHandle,
  resetHandleCounters,
} from './result-compressor.js';
import { memoryRead } from '../../agent/working-memory.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CompressorContext } from './result-compressor.js';

const ctx = (over: Partial<CompressorContext> = {}): CompressorContext => ({
  conversationId: 'c1',
  toolName: 'read_page',
  declaredMaxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  ...over,
});

beforeEach(() => resetHandleCounters());

describe('getPersistenceThreshold', () => {
  it('clamps a declared cap down to the default but never up', () => {
    expect(getPersistenceThreshold(10_000)).toBe(10_000);
    expect(getPersistenceThreshold(999_999)).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
  });
  it('passes Infinity through (opt-out)', () => {
    expect(getPersistenceThreshold(Infinity)).toBe(Infinity);
  });
});

describe('generatePreview', () => {
  it('returns the whole string and hasMore:false when under the cap', () => {
    expect(generatePreview('short', 100)).toEqual({ preview: 'short', hasMore: false });
  });
  it('cuts on the last newline when it is past 50% of the cap', () => {
    const content = 'a'.repeat(60) + '\n' + 'b'.repeat(60);
    const { preview, hasMore } = generatePreview(content, 100);
    expect(hasMore).toBe(true);
    expect(preview).toBe('a'.repeat(60)); // cut at the newline (idx 60 > 50)
  });
  it('cuts hard at the cap when the only newline is too early', () => {
    const content = 'a\n' + 'b'.repeat(200);
    const { preview, hasMore } = generatePreview(content, 100);
    expect(hasMore).toBe(true);
    expect(preview).toHaveLength(100);
  });
});

describe('nextHandle', () => {
  it('mints monotonically increasing per-tool bucket names', () => {
    expect(nextHandle('read_page')).toBe('read_page_1');
    expect(nextHandle('read_page')).toBe('read_page_2');
    expect(nextHandle('find')).toBe('find_1'); // independent counter
  });
});

describe('compressToolResult', () => {
  it('replaces an empty result with a "no output" sentinel', () => {
    expect(compressToolResult('', ctx({ toolName: 'click' }))).toBe('(click completed with no output)');
    expect(compressToolResult(null, ctx({ toolName: 'click' }))).toBe('(click completed with no output)');
    expect(compressToolResult({}, ctx({ toolName: 'click' }))).toBe('(click completed with no output)');
  });

  it('passes small results through untouched', () => {
    const r = { items: [1, 2, 3] };
    expect(compressToolResult(r, ctx())).toBe(r);
  });

  it('never compresses error results or image markers', () => {
    const err = { error: 'boom' };
    expect(compressToolResult(err, ctx())).toBe(err);
    const img = { __doe_image: { base64: 'x'.repeat(80_000), mediaType: 'image/jpeg' } };
    expect(compressToolResult(img, ctx())).toBe(img);
  });

  it('opts out entirely when the declared cap is Infinity', () => {
    const big = 'x'.repeat(80_000);
    expect(compressToolResult(big, ctx({ toolName: 'memory_get', declaredMaxResultSizeChars: Infinity }))).toBe(big);
  });

  it('buckets an oversized string and returns a paging message', () => {
    const big = 'LINE\n'.repeat(20_000); // 100K > 50K default
    const out = compressToolResult(big, ctx({ toolName: 'read_page', conversationId: 'c1' }));
    expect(typeof out).toBe('string');
    expect(out).toContain('saved to bucket "read_page_1"');
    expect(out).toContain('offset/limit slice characters'); // string paging hint
    // Full content stashed for memory_get to page through.
    expect(memoryRead('c1', 'read_page_1')).toEqual([big]);
  });

  it('buckets an oversized array with the item-index paging hint', () => {
    const arr = Array.from({ length: 20_000 }, (_, i) => ({ i }));
    const out = compressToolResult(arr, ctx({ toolName: 'find', conversationId: 'c2' }));
    expect(out).toContain('saved to bucket "find_1"');
    expect(out).toContain('offset/limit are item indexes');
    expect(memoryRead('c2', 'find_1')).toEqual(arr); // arrays stored as items, not wrapped in another array
  });
});

describe('PREVIEW_SIZE_BYTES', () => {
  it('is a sane preview window', () => {
    expect(PREVIEW_SIZE_BYTES).toBeGreaterThan(0);
  });
});
