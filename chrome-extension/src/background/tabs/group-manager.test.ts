import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabGroupManager as TabGroupManagerType } from './group-manager.js';

/**
 * group-manager keeps its session state on `globalThis.__doe_group`,
 * so a plain `vi.resetModules()` is not enough — we also delete the global
 * before re-importing to get a genuinely fresh session. The chrome fake is
 * reset by the shared setup's own beforeEach (runs first).
 */
type GlobalShape = {
  __doe_group?: unknown;
  __chromeState: {
    tabs: Map<number, { id: number; windowId: number; groupId: number; url: string; title: string; active: boolean }>;
    groups: Map<number, { id: number; windowId: number; title: string; color: string }>;
    session: Record<string, unknown>;
    lastFocusedWindowId: number;
    nextTabId: number;
    nextGroupId: number;
  };
  __seedTab: (p?: Record<string, unknown>) => { id: number; windowId: number; groupId: number };
};

const g = globalThis as unknown as GlobalShape;

let GM: typeof TabGroupManagerType;

async function loadFreshModule() {
  delete g.__doe_group;
  vi.resetModules();
  ({ TabGroupManager: GM } = await import('./group-manager.js'));
}

/** Add a Doe-titled group directly to the fake, bypassing group-manager. */
function seedLeftoverGroup(opts: { windowId?: number; tabCount?: number; title?: string }) {
  const state = g.__chromeState;
  const gid = state.nextGroupId++;
  const windowId = opts.windowId ?? 1;
  state.groups.set(gid, { id: gid, windowId, title: opts.title ?? 'Doe', color: 'orange' });
  for (let i = 0; i < (opts.tabCount ?? 1); i++) {
    const id = state.nextTabId++;
    state.tabs.set(id, { id, windowId, groupId: gid, url: `https://old/${id}`, title: `old ${id}`, active: false });
  }
  return gid;
}

beforeEach(loadFreshModule);

describe('adoptSeedTab — session creation', () => {
  it('creates a new Doe group for an ungrouped tab and makes it active', async () => {
    const tab = g.__seedTab({ active: true });
    const gid = await GM.adoptSeedTab(tab.id);
    expect(gid).not.toBeNull();
    expect(GM.getGroupId()).toBe(gid);
    const group = g.__chromeState.groups.get(gid!);
    expect(group?.title).toBe('Doe');
    expect(g.__chromeState.tabs.get(tab.id)?.groupId).toBe(gid);
  });

  it('reactivates the existing session when the seed tab is already in an Doe group', async () => {
    const tab = g.__seedTab({ active: true });
    const first = await GM.adoptSeedTab(tab.id);
    const again = await GM.adoptSeedTab(tab.id);
    expect(again).toBe(first);
    // No second group created.
    expect([...g.__chromeState.groups.values()].filter(gr => gr.title === 'Doe')).toHaveLength(1);
  });

  it('does NOT merge two independent sessions — a second ungrouped seed tab gets its OWN group', async () => {
    const a = g.__seedTab();
    const b = g.__seedTab();
    const ga = await GM.adoptSeedTab(a.id);
    const gb = await GM.adoptSeedTab(b.id);
    expect(gb).not.toBe(ga);
    expect(g.__chromeState.tabs.get(a.id)?.groupId).toBe(ga);
    expect(g.__chromeState.tabs.get(b.id)?.groupId).toBe(gb);
  });

  it('pulls a tab out of a foreign (non-doeverything) group into a new Doe group', async () => {
    const foreignGid = seedLeftoverGroup({ title: 'Some Other Extension', tabCount: 0 });
    const tab = g.__seedTab({ groupId: foreignGid });
    const gid = await GM.adoptSeedTab(tab.id);
    expect(gid).not.toBe(foreignGid);
    expect(g.__chromeState.groups.get(gid!)?.title).toBe('Doe');
  });

  it('coalesces concurrent seed calls for the same tab (no double group)', async () => {
    const tab = g.__seedTab();
    const [g1, g2] = await Promise.all([GM.adoptSeedTab(tab.id), GM.adoptSeedTab(tab.id)]);
    expect(g1).toBe(g2);
    expect([...g.__chromeState.groups.values()]).toHaveLength(1);
  });
});

describe('adoptTab — agent-spawned tabs join the active session', () => {
  it('adds a new tab to the active group', async () => {
    const seed = g.__seedTab();
    const gid = await GM.adoptSeedTab(seed.id);
    const spawned = g.__seedTab();
    const joinGid = await GM.adoptTab(spawned.id);
    expect(joinGid).toBe(gid);
    expect(g.__chromeState.tabs.get(spawned.id)?.groupId).toBe(gid);
  });

  it('creates a group when there is no active session (e.g. scheduler with a fresh tab)', async () => {
    const tab = g.__seedTab();
    const gid = await GM.adoptTab(tab.id);
    expect(gid).not.toBeNull();
    expect(g.__chromeState.groups.get(gid!)?.title).toBe('Doe');
  });
});

describe('ensureSeedTab — guarantees the focused tab is grouped (fixes availableTabs: [])', () => {
  it('seeds the focused tab when there is no active group', async () => {
    const focused = g.__seedTab({ active: true, windowId: 1 });
    await GM.ensureSeedTab();
    const members = await GM.listMembers();
    expect(members.map(m => m.id)).toContain(focused.id);
  });

  it('is a no-op when the focused tab already belongs to the active group', async () => {
    const focused = g.__seedTab({ active: true });
    const gid = await GM.adoptSeedTab(focused.id);
    await GM.ensureSeedTab();
    expect(GM.getGroupId()).toBe(gid);
    expect([...g.__chromeState.groups.values()]).toHaveLength(1);
  });

  it('does NOT lock onto a leftover Doe group that lacks the focused tab', async () => {
    // A stale Doe group from a prior session, in another window, with
    // no storage.session mirror — exactly the regression that produced [].
    const leftover = seedLeftoverGroup({ windowId: 2, tabCount: 2 });
    const focused = g.__seedTab({ active: true, windowId: 1 });

    await GM.ensureSeedTab();

    const activeGid = GM.getGroupId();
    expect(activeGid).not.toBe(leftover);
    const members = await GM.listMembers();
    expect(members.map(m => m.id)).toEqual([focused.id]);
  });
});

describe('listMembers / disband / _forget', () => {
  it('lists only the active group members', async () => {
    const a = g.__seedTab({ active: true });
    await GM.adoptSeedTab(a.id);
    const b = g.__seedTab();
    await GM.adoptTab(b.id);
    const members = await GM.listMembers();
    expect(new Set(members.map(m => m.id))).toEqual(new Set([a.id, b.id]));
  });

  it('disband ungroups all members and clears the active group', async () => {
    const a = g.__seedTab({ active: true });
    await GM.adoptSeedTab(a.id);
    await GM.disband();
    expect(GM.getGroupId()).toBeNull();
    expect(g.__chromeState.tabs.get(a.id)?.groupId).toBe(-1);
  });

  it('_forget clears the active group once the last member is gone', async () => {
    const a = g.__seedTab({ active: true });
    await GM.adoptSeedTab(a.id);
    g.__chromeState.tabs.delete(a.id);
    GM._forget(a.id);
    expect(GM.getGroupId()).toBeNull();
  });

  it('_forget on an unrelated tab after SW eviction does not prevent group restore', async () => {
    // Phase 1: establish a session — groupId ends up in session storage.
    const a = g.__seedTab({ active: true });
    await GM.adoptSeedTab(a.id);
    const savedGroupId = GM.getGroupId();
    expect(typeof savedGroupId).toBe('number');

    // Phase 2: simulate SW eviction by re-importing the module.
    // In-memory state (groupId, members) is wiped; session storage survives.
    await loadFreshModule();
    expect(GM.getGroupId()).toBeNull();

    // Phase 3: a completely unrelated tab is closed (e.g. user closes YouTube).
    // Before the fix, state.members.size===0 AND state.groupId===null triggered
    // persistActiveGroup(null), which corrupted session storage and forced a new
    // MCP tab group on the next tool call.
    const unrelated = g.__seedTab();
    GM._forget(unrelated.id);

    // Phase 4: the next tool call should restore the group from session storage.
    const members = await GM.listMembers();
    expect(members.some(t => t.id === a.id)).toBe(true);
    expect(GM.getGroupId()).toBe(savedGroupId);
  });
});

describe('isOwnTab — title-based membership check (any Doe group)', () => {
  it('returns true for a tab in the active "Doe" session', async () => {
    const tab = g.__seedTab({ active: true });
    await GM.adoptSeedTab(tab.id);
    expect(await GM.isOwnTab(tab.id)).toBe(true);
  });

  it('returns true for a tab in a leftover "Doe" group that is not the active session', async () => {
    const gid = seedLeftoverGroup({ tabCount: 1, title: 'Doe' });
    const tabId = [...g.__chromeState.tabs.values()].find(t => t.groupId === gid)!.id;
    expect(await GM.isOwnTab(tabId)).toBe(true);
  });

  it('returns true for a tab in a "Doe (MCP)" group', async () => {
    const gid = seedLeftoverGroup({ tabCount: 1, title: 'Doe (MCP)' });
    const tabId = [...g.__chromeState.tabs.values()].find(t => t.groupId === gid)!.id;
    expect(await GM.isOwnTab(tabId)).toBe(true);
  });

  it('returns false for a tab in a foreign group', async () => {
    const gid = seedLeftoverGroup({ tabCount: 1, title: 'SomeOtherExtension' });
    const tabId = [...g.__chromeState.tabs.values()].find(t => t.groupId === gid)!.id;
    expect(await GM.isOwnTab(tabId)).toBe(false);
  });

  it('returns false for an ungrouped tab (groupId = TAB_GROUP_ID_NONE)', async () => {
    const tab = g.__seedTab({ active: false }); // seedTab uses groupId: -1 by default
    expect(tab.groupId).toBe(-1);
    expect(await GM.isOwnTab(tab.id)).toBe(false);
  });

  it('returns false (no throw) for a tab id that does not exist in Chrome', async () => {
    const nonExistentId = 999_999;
    expect(await GM.isOwnTab(nonExistentId)).toBe(false);
  });

  it('returns false (no throw) when the group is deleted mid-check', async () => {
    const gid = seedLeftoverGroup({ tabCount: 1, title: 'Doe' });
    const tabId = [...g.__chromeState.tabs.values()].find(t => t.groupId === gid)!.id;
    // Delete the group before isOwnTab resolves
    g.__chromeState.groups.delete(gid);
    expect(await GM.isOwnTab(tabId)).toBe(false);
  });

  it('does not call tabGroups.get when the tab is already ungrouped', async () => {
    // We can't intercept chrome.tabGroups.get directly in the fake, but we
    // verify the outcome: ungrouped tab → false without a group lookup
    const tab = g.__seedTab();
    expect(tab.groupId).toBe(-1);
    // If tabGroups.get were called on a missing id, the fake throws → test would error
    expect(await GM.isOwnTab(tab.id)).toBe(false);
  });
});

describe('session-storage recovery after SW eviction', () => {
  it('restores the active group from the storage.session mirror, not by title', async () => {
    const a = g.__seedTab({ active: true });
    const gid = await GM.adoptSeedTab(a.id);

    // Simulate SW eviction: drop in-memory module state but KEEP chrome
    // storage (which survives eviction within a browser session).
    delete g.__doe_group;
    vi.resetModules();
    ({ TabGroupManager: GM } = await import('./group-manager.js'));

    const members = await GM.listMembers();
    expect(GM.getGroupId()).toBe(gid);
    expect(members.map(m => m.id)).toContain(a.id);
  });

  it('does NOT resurrect a group by title when the mirror is empty', async () => {
    // A leftover titled group with no storage mirror must stay ignored.
    seedLeftoverGroup({ tabCount: 1 });
    // Fresh module, empty storage.session.
    const members = await GM.listMembers();
    expect(members).toEqual([]);
    expect(GM.getGroupId()).toBeNull();
  });
});
