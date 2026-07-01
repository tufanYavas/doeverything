import { buildFetchSnippet, classifyBody, isBrowserControlledHeader, summarizeUrl } from './network-summary.js';
import { describe, expect, it } from 'vitest';

describe('classifyBody', () => {
  it('treats missing / empty bodies as empty', () => {
    expect(classifyBody(undefined, 'application/json').kind).toBe('empty');
    expect(classifyBody('', 'application/json').kind).toBe('empty');
  });

  it('classifies binary by content-type', () => {
    const c = classifyBody('\x89PNG', 'image/png');
    expect(c.kind).toBe('binary');
    expect(c.contentType).toBe('image/png');
  });

  it('parses JSON by content-type and exposes the parsed value', () => {
    const c = classifyBody('{"a":1}', 'application/json; charset=utf-8');
    expect(c.kind).toBe('json');
    expect(c.parsed).toEqual({ a: 1 });
    expect(c.raw).toBe('{"a":1}');
  });

  it('detects JSON by shape even without a content-type', () => {
    expect(classifyBody('[1,2,3]', undefined).kind).toBe('json');
  });

  it('falls back to text when a JSON-shaped body fails to parse', () => {
    const c = classifyBody('{not valid json}', 'application/json');
    expect(c.kind).toBe('text');
    expect(c.raw).toBe('{not valid json}');
  });

  it('classifies plain text', () => {
    expect(classifyBody('hello world', 'text/plain').kind).toBe('text');
  });
});

describe('summarizeUrl', () => {
  it('splits a URL into origin, path, and query params', () => {
    const s = summarizeUrl('https://api.example.com/v1/items?page=2&q=shoes#frag');
    expect(s.origin).toBe('https://api.example.com');
    expect(s.path).toBe('/v1/items');
    expect(s.queryParams).toEqual({ page: '2', q: 'shoes' });
    expect(s.fragment).toBe('#frag');
  });

  it('degrades gracefully on an unparseable URL', () => {
    const s = summarizeUrl('not a url');
    expect(s.origin).toBe('');
    expect(s.path).toBe('not a url');
    expect(s.queryParams).toEqual({});
  });
});

describe('isBrowserControlledHeader', () => {
  it('flags headers the browser owns / computes', () => {
    for (const h of ['Host', 'Cookie', 'User-Agent', 'Content-Length', 'Origin', 'Referer']) {
      expect(isBrowserControlledHeader(h)).toBe(true);
    }
  });
  it('flags sec-fetch-*, sec-ch-*, and HTTP/2 pseudo-headers', () => {
    expect(isBrowserControlledHeader('Sec-Fetch-Mode')).toBe(true);
    expect(isBrowserControlledHeader('sec-ch-ua-platform')).toBe(true);
    expect(isBrowserControlledHeader(':authority')).toBe(true);
  });
  it('passes through app headers', () => {
    expect(isBrowserControlledHeader('Authorization')).toBe(false);
    expect(isBrowserControlledHeader('X-Api-Key')).toBe(false);
  });
});

describe('buildFetchSnippet', () => {
  it('drops browser-controlled headers and keeps app headers', () => {
    const snippet = buildFetchSnippet({
      url: 'https://api.example.com/data',
      method: 'get',
      headers: { Authorization: 'Bearer t', Cookie: 'sid=1', 'User-Agent': 'x' },
    });
    expect(snippet).toContain('https://api.example.com/data');
    expect(snippet).toContain('Authorization');
    expect(snippet).not.toContain('Cookie');
    expect(snippet).not.toContain('User-Agent');
    expect(snippet.toUpperCase()).toContain('GET');
  });

  it('substitutes sensitive header values with their placeholder tokens', () => {
    const snippet = buildFetchSnippet({
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: { Authorization: 'Bearer super-secret' },
      sensitiveHeaderTokens: new Map([['authorization', '__SECRET_AUTH__']]),
    });
    expect(snippet).toContain('__SECRET_AUTH__');
    expect(snippet).not.toContain('super-secret');
  });
});
