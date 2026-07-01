import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Memory is URL-conditional: persistent buckets are namespaced by registrable
 * domain, and the `<memory_roster>` block in the per-step ephemeral context
 * lists the GLOBAL ("*") buckets plus the buckets for the active tab's domain.
 * It re-emits on every domain change because `buildBrowserStateHash()` keys on
 * origin — these tests prove both halves: the hash trigger and the roster
 * content following the active domain.
 *
 * group-manager keeps session state on `globalThis.__doe_group`, so a
 * plain resetModules isn't enough — delete the global too. Persistent memory
 * lives in (fake) IndexedDB which survives resetModules, so wipe it as well.
 */
type GlobalShape = {
  __doe_group?: unknown;
  __seedTab: (p?: Record<string, unknown>) => { id: number; windowId: number; groupId: number };
  __chromeState: { tabs: Map<number, { id: number; url: string; title: string; active: boolean }> };
};
const g = globalThis as unknown as GlobalShape;

beforeEach(async () => {
  delete g.__doe_group;
  vi.resetModules();
  const { wipeAllPersistentMemory } = await import('@doeverything/storage');
  await wipeAllPersistentMemory();
});

/** Seed an doeverything group containing a single active tab at `url`. */
async function seedActiveTab(url: string) {
  const tab = g.__seedTab({ active: true, url });
  const { TabGroupManager } = await import('../tabs/group-manager.js');
  await TabGroupManager.adoptSeedTab(tab.id);
  return tab;
}

describe('buildBrowserStateHash — domain-change trigger', () => {
  it('changes when the active tab origin changes, but not on a title-only tweak', async () => {
    const tab = await seedActiveTab('https://x.com/home');
    const { buildBrowserStateHash } = await import('./system-prompt.js');

    const h1 = await buildBrowserStateHash();
    expect(h1).toContain('https://x.com');

    // Title change → same hash (volatile field excluded).
    g.__chromeState.tabs.get(tab.id)!.title = 'totally different title';
    expect(await buildBrowserStateHash()).toBe(h1);

    // Navigate to another origin → hash changes (triggers roster re-emit).
    g.__chromeState.tabs.get(tab.id)!.url = 'https://y.com/page';
    const h2 = await buildBrowserStateHash();
    expect(h2).not.toBe(h1);
    expect(h2).toContain('https://y.com');
  });
});

describe('buildEphemeralBrowserContext — memory roster follows the active domain', () => {
  it('omits the roster entirely when nothing is saved', async () => {
    await seedActiveTab('https://x.com');
    const { buildEphemeralBrowserContext } = await import('./system-prompt.js');
    expect(await buildEphemeralBrowserContext()).not.toContain('<memory_roster>');
  });

  it('lists the active domain bucket and the global bucket, not other domains', async () => {
    const { recallAppend } = await import('@doeverything/storage');
    await recallAppend('x.com', 'seen-ids', [1, 2, 3]);
    await recallAppend('*', 'identity', [{ name: 'me' }]);
    await recallAppend('other.com', 'otherbucket', ['nope']);

    await seedActiveTab('https://x.com/feed');
    const { buildEphemeralBrowserContext } = await import('./system-prompt.js');
    const ctx = await buildEphemeralBrowserContext();

    expect(ctx).toContain('<memory_roster>');
    expect(ctx).toContain('activeDomain: x.com');
    expect(ctx).toContain('global (*):');
    expect(ctx).toContain('identity');
    expect(ctx).toContain('for x.com:');
    expect(ctx).toContain('seen-ids');
    // A different domain's bucket must not leak into x.com's roster.
    expect(ctx).not.toContain('otherbucket');
    expect(ctx).not.toContain('other.com');
  });

  it('collapses subdomains to the registrable domain (m.x.com → x.com)', async () => {
    const { recallAppend } = await import('@doeverything/storage');
    await recallAppend('x.com', 'seen-ids', [1]);

    await seedActiveTab('https://m.x.com/touch');
    const { buildEphemeralBrowserContext } = await import('./system-prompt.js');
    const ctx = await buildEphemeralBrowserContext();
    expect(ctx).toContain('activeDomain: x.com');
    expect(ctx).toContain('seen-ids');
  });
});
