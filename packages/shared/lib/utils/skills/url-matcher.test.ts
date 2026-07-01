import { clearUrlMatcherCache, urlMatchesAny } from './url-matcher.js';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(clearUrlMatcherCache);

describe('urlMatchesAny', () => {
  it('matches an exact hostname', () => {
    expect(urlMatchesAny('https://example.com/path', ['example.com'])).toBe(true);
    expect(urlMatchesAny('https://other.com/', ['example.com'])).toBe(false);
  });

  it('*.example.com matches exactly one subdomain level', () => {
    expect(urlMatchesAny('https://app.example.com/', ['*.example.com'])).toBe(true);
    expect(urlMatchesAny('https://example.com/', ['*.example.com'])).toBe(false); // bare not matched
    expect(urlMatchesAny('https://a.b.example.com/', ['*.example.com'])).toBe(false); // two levels
  });

  it('**.example.com matches any depth including bare', () => {
    expect(urlMatchesAny('https://example.com/', ['**.example.com'])).toBe(true);
    expect(urlMatchesAny('https://a.b.example.com/', ['**.example.com'])).toBe(true);
  });

  it('full-URL prefix with a path glob', () => {
    expect(urlMatchesAny('https://example.com/docs/intro', ['https://example.com/docs/*'])).toBe(true);
    expect(urlMatchesAny('https://example.com/blog/x', ['https://example.com/docs/*'])).toBe(false);
  });

  it('*:// matches any scheme', () => {
    expect(urlMatchesAny('http://example.com/p', ['*://example.com/p'])).toBe(true);
    expect(urlMatchesAny('https://example.com/p', ['*://example.com/p'])).toBe(true);
  });

  it('returns false for missing url / empty patterns / invalid url', () => {
    expect(urlMatchesAny(undefined, ['example.com'])).toBe(false);
    expect(urlMatchesAny('https://example.com', [])).toBe(false);
    expect(urlMatchesAny('not a url', ['example.com'])).toBe(false);
  });

  it('matches when any pattern in the list matches', () => {
    expect(urlMatchesAny('https://example.com/', ['foo.com', '*.bar.com', 'example.com'])).toBe(true);
  });
});
