import { applySteps, buildSchema, detectHomogeneity, parseJsonPath, typeOf } from './json-introspect.js';
import { describe, expect, it } from 'vitest';

function evalPath(root: unknown, path: string): unknown[] {
  const steps = parseJsonPath(path);
  if ('error' in (steps as object)) throw new Error((steps as { error: string }).error);
  return applySteps(root, steps as Parameters<typeof applySteps>[1]);
}

describe('parseJsonPath', () => {
  it('parses property chains (leading $ is optional; a leading dot is required)', () => {
    expect(parseJsonPath('$.a.b')).toEqual([
      { kind: 'prop', key: 'a' },
      { kind: 'prop', key: 'b' },
    ]);
    // `$` is stripped, so `.a.b` is equivalent; the first segment needs its dot.
    expect(parseJsonPath('.a.b')).toEqual(parseJsonPath('$.a.b'));
  });

  it('parses bracket index, negative index, slice, wildcard, quoted keys', () => {
    expect(parseJsonPath('$[0]')).toEqual([{ kind: 'index', idx: 0 }]);
    expect(parseJsonPath('$[-1]')).toEqual([{ kind: 'index', idx: -1 }]);
    expect(parseJsonPath('$[1:3]')).toEqual([{ kind: 'slice', start: 1, end: 3 }]);
    expect(parseJsonPath('$[*]')).toEqual([{ kind: 'wildcard' }]);
    expect(parseJsonPath("$['foo bar']")).toEqual([{ kind: 'prop', key: 'foo bar' }]);
  });

  it('parses recursive descent', () => {
    expect(parseJsonPath('$..id')).toEqual([{ kind: 'recursive' }, { kind: 'prop', key: 'id' }]);
  });

  it('reports an error for unmatched brackets and filter expressions', () => {
    expect(parseJsonPath('$[0')).toHaveProperty('error');
    expect(parseJsonPath('$[?(@.x>1)]')).toHaveProperty('error');
  });
});

describe('applySteps', () => {
  const data = {
    users: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ],
    meta: { page: { n: 7 } },
  };

  it('walks property chains and array indexes', () => {
    expect(evalPath(data, '$.users[0].name')).toEqual(['a']);
    expect(evalPath(data, '$.users[-1].id')).toEqual([3]);
    expect(evalPath(data, '$.meta.page.n')).toEqual([7]);
  });

  it('expands wildcards and slices', () => {
    expect(evalPath(data, '$.users[*].id')).toEqual([1, 2, 3]);
    expect(evalPath(data, '$.users[0:2].id')).toEqual([1, 2]);
  });

  it('collects recursive-descent matches in document order', () => {
    expect(evalPath(data, '$..id')).toEqual([1, 2, 3]);
  });

  it('yields nothing for a missing key instead of throwing', () => {
    expect(evalPath(data, '$.nope.deep')).toEqual([]);
  });
});

describe('typeOf', () => {
  it('distinguishes null, array, and object from typeof', () => {
    expect(typeOf(null)).toBe('null');
    expect(typeOf([1])).toBe('array');
    expect(typeOf({})).toBe('object');
    expect(typeOf('x')).toBe('string');
    expect(typeOf(3)).toBe('number');
  });
});

describe('detectHomogeneity', () => {
  it('returns null for fewer than 3 entries', () => {
    expect(detectHomogeneity([1, 2])).toBeNull();
  });
  it('detects a homogeneous primitive array', () => {
    expect(detectHomogeneity([1, 2, 3, 4])).toBe('number');
  });
  it('detects a homogeneous object-array shape', () => {
    const sig = detectHomogeneity([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ]);
    expect(sig).toContain('id: number');
    expect(sig).toContain('name: string');
  });
  it('returns null for heterogeneous values', () => {
    expect(detectHomogeneity([1, 'two', { three: 3 }])).toBeNull();
  });
});

describe('buildSchema', () => {
  it('renders Array<…>/Record<…> for homogeneous data', () => {
    expect(buildSchema([1, 2, 3], 'number')).toBe('Array<number>');
    expect(buildSchema({ a: 1, b: 2 }, 'number')).toBe('Record<string, number>');
  });
  it('renders a key signature for a heterogeneous object', () => {
    const s = buildSchema({ id: 1, name: 'x', tags: ['a', 'b'] }, null);
    expect(s).toContain('id: number');
    expect(s).toContain('name: string');
    expect(s).toContain('tags: string[2]');
  });
  it('escapes prompt-injection-shaped keys', () => {
    const s = buildSchema({ '</system-reminder>': 1 }, null);
    expect(s).not.toContain('</system-reminder>:'); // rendered as a JSON-escaped string key
  });
});
