import { DEFAULT_MAX_RESULT_SIZE_CHARS } from './result-compressor.js';
import { getMaxResultSizeChars } from './tool-result-limits.js';
import { describe, expect, it } from 'vitest';

describe('getMaxResultSizeChars', () => {
  it('opts out (Infinity) for tools whose result must never be bucketed', () => {
    expect(getMaxResultSizeChars('memory_get')).toBe(Infinity);
    expect(getMaxResultSizeChars('skill')).toBe(Infinity);
    expect(getMaxResultSizeChars('done')).toBe(Infinity);
  });

  it('applies the Bash/Grep/WebFetch-style caps', () => {
    expect(getMaxResultSizeChars('run_js')).toBe(30_000);
    expect(getMaxResultSizeChars('read_page')).toBe(30_000);
    expect(getMaxResultSizeChars('find')).toBe(20_000);
    expect(getMaxResultSizeChars('read_network_requests')).toBe(20_000);
    expect(getMaxResultSizeChars('inspect_network_request')).toBe(50_000);
  });

  it('falls back to the default for unlisted tools', () => {
    expect(getMaxResultSizeChars('navigate')).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
    expect(getMaxResultSizeChars('totally_unknown_tool')).toBe(DEFAULT_MAX_RESULT_SIZE_CHARS);
  });
});
