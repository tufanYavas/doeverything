import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * isBlockedUrl caches the managed patterns in module scope, so each case
 * seeds chrome.storage.managed THEN imports a fresh module.
 */
type ManagedState = { __chromeState: { managed: Record<string, unknown> } };

async function checkerWith(patterns: string[]) {
  (globalThis as unknown as ManagedState).__chromeState.managed.blockedUrlPatterns = patterns;
  vi.resetModules();
  const { isBlockedUrl } = await import('./blocked-url-checker.js');
  return isBlockedUrl;
}

beforeEach(() => {
  vi.resetModules();
});

describe('isBlockedUrl', () => {
  it('returns not-blocked when no policy is set', async () => {
    const isBlockedUrl = await checkerWith([]);
    expect(await isBlockedUrl('https://example.com/')).toEqual({ blocked: false });
  });

  it('blocks a bare-domain pattern (treated as domain/*) and reports the reason', async () => {
    const isBlockedUrl = await checkerWith(['facebook.com']);
    const r = await isBlockedUrl('https://facebook.com/feed');
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('facebook.com');
  });

  it('ignores www. and scheme, case-insensitively', async () => {
    const isBlockedUrl = await checkerWith(['Example.com/secret/*']);
    expect((await isBlockedUrl('https://www.example.com/secret/page')).blocked).toBe(true);
    expect((await isBlockedUrl('http://example.com/secret/x')).blocked).toBe(true);
  });

  it('does not block paths outside the pattern', async () => {
    const isBlockedUrl = await checkerWith(['example.com/admin/*']);
    expect((await isBlockedUrl('https://example.com/public')).blocked).toBe(false);
  });

  it('supports a wildcard host segment', async () => {
    const isBlockedUrl = await checkerWith(['*.internal.corp/*']);
    expect((await isBlockedUrl('https://wiki.internal.corp/page')).blocked).toBe(true);
  });

  it('returns not-blocked for non-http(s) or malformed urls', async () => {
    const isBlockedUrl = await checkerWith(['example.com']);
    expect((await isBlockedUrl('chrome://settings')).blocked).toBe(false);
    expect((await isBlockedUrl('not a url')).blocked).toBe(false);
  });
});
