import { domainFromUrl, normalizeDomain } from './normalize-domain.js';
import { describe, expect, it } from 'vitest';

describe('normalizeDomain', () => {
  it('keeps the global "*" namespace as-is', () => {
    expect(normalizeDomain('*')).toBe('*');
  });

  it('collapses subdomains to the registrable domain', () => {
    expect(normalizeDomain('m.facebook.com')).toBe('facebook.com');
    expect(normalizeDomain('www.github.com')).toBe('github.com');
    expect(normalizeDomain('a.b.c.example.co.uk')).toBe('example.co.uk');
  });

  it('accepts full URLs and strips scheme/path/query', () => {
    expect(normalizeDomain('https://www.trendyol.com/path?q=1')).toBe('trendyol.com');
    expect(normalizeDomain('http://x.com')).toBe('x.com');
  });

  it('lowercases and trims', () => {
    expect(normalizeDomain('  WWW.GitHub.Com  ')).toBe('github.com');
  });

  it('strips an explicit port', () => {
    expect(normalizeDomain('localhost:3000')).toBe('localhost');
    expect(normalizeDomain('shop.example.com:8443')).toBe('example.com');
  });

  it('returns the literal hostname for localhost / IPs / unknown TLDs', () => {
    expect(normalizeDomain('localhost')).toBe('localhost');
    expect(normalizeDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeDomain('http://192.168.1.5:8080/admin')).toBe('192.168.1.5');
  });

  it('pulls the hostname for special schemes (chrome://, file://, extension)', () => {
    expect(normalizeDomain('chrome://extensions')).toBe('extensions');
    expect(normalizeDomain('chrome-extension://abcdef/page.html')).toBe('abcdef');
  });

  it('throws on an empty domain (callers must use "*" for global)', () => {
    expect(() => normalizeDomain('')).toThrow(/empty/);
    expect(() => normalizeDomain('   ')).toThrow(/empty/);
  });
});

describe('domainFromUrl', () => {
  it('returns the registrable domain for a normal URL', () => {
    expect(domainFromUrl('https://news.ycombinator.com/item?id=1')).toBe('ycombinator.com');
  });

  it('returns null for missing input instead of throwing', () => {
    expect(domainFromUrl(undefined)).toBeNull();
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl('')).toBeNull();
  });

  it('never throws on garbage — falls back to null', () => {
    expect(domainFromUrl('not a url at all')).not.toBeUndefined();
  });
});
