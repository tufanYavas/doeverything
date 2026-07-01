import { parseArgumentNames, parseArguments, substituteArguments } from './argument-substitution.js';
import { describe, expect, it } from 'vitest';

describe('parseArguments', () => {
  it('splits on whitespace', () => {
    expect(parseArguments('a b c')).toEqual(['a', 'b', 'c']);
  });
  it('keeps quoted spans together (single and double)', () => {
    expect(parseArguments('"hello world" foo')).toEqual(['hello world', 'foo']);
    expect(parseArguments("'a b' c")).toEqual(['a b', 'c']);
  });
  it('honors backslash escapes outside single quotes', () => {
    expect(parseArguments('a\\ b')).toEqual(['a b']);
    expect(parseArguments("'a\\ b'")).toEqual(['a\\ b']); // literal inside single quotes
  });
  it('returns [] for empty / whitespace input', () => {
    expect(parseArguments('')).toEqual([]);
    expect(parseArguments('   ')).toEqual([]);
  });
});

describe('parseArgumentNames', () => {
  it('accepts a space-separated string, dropping numeric/empty names', () => {
    expect(parseArgumentNames('target count 0')).toEqual(['target', 'count']);
  });
  it('accepts an array and filters invalid entries', () => {
    expect(parseArgumentNames(['a', '', '12', 'b'])).toEqual(['a', 'b']);
  });
  it('returns [] for undefined', () => {
    expect(parseArgumentNames(undefined)).toEqual([]);
  });
});

describe('substituteArguments', () => {
  it('substitutes named placeholders by position', () => {
    const out = substituteArguments('Open $site as $user', 'example.com alice', true, ['site', 'user']);
    expect(out).toBe('Open example.com as alice');
  });

  it('substitutes $0/$1 indexed shorthand and $ARGUMENTS[N]', () => {
    expect(substituteArguments('$0 then $1', 'a b')).toBe('a then b');
    expect(substituteArguments('val=$ARGUMENTS[1]', 'a b c')).toBe('val=b');
  });

  it('replaces the full $ARGUMENTS token', () => {
    expect(substituteArguments('run: $ARGUMENTS', 'x y z')).toBe('run: x y z');
  });

  it('leaves no literal placeholder when args are missing (replaces with empty)', () => {
    expect(substituteArguments('hi $name', undefined, false, ['name'])).toBe('hi ');
  });

  it('appends ARGUMENTS when the body has no placeholder and args are present', () => {
    expect(substituteArguments('do the thing', 'extra', true)).toBe('do the thing\n\nARGUMENTS: extra');
  });

  it('does not append when appendIfNoPlaceholder is false', () => {
    expect(substituteArguments('do the thing', 'extra', false)).toBe('do the thing');
  });

  it('does not substitute a named placeholder that is a prefix of a longer word', () => {
    // $site must not match inside $sitemap
    expect(substituteArguments('$sitemap', 'X', false, ['site'])).toBe('$sitemap');
  });
});
