/**
 * createToolContext — MCP tab lifecycle tests.
 *
 * Covers the behaviour introduced for MCP sessions:
 *   - When the group has no tabs, an MCP session auto-creates one instead of throwing.
 *   - The created tab is remembered per connectionId so the next tool call
 *     in the SAME session reuses it (no duplicate tabs).
 *   - Two DIFFERENT connectionIds each get their own tab slot.
 *   - When a previously-cached tab is closed, the session opens a fresh one.
 *   - Non-MCP sessions still throw when the group is empty (no auto-create).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Types mirroring chrome-mock state
// ---------------------------------------------------------------------------

type GlobalShape = {
  __doe_group?: unknown;
  __doe_mcp_tabs?: Map<string, number>;
  __chromeState: {
    tabs: Map<number, { id: number; windowId: number; groupId: number; url: string; title: string; active: boolean }>;
    groups: Map<number, { id: number; windowId: number; title: string; color: string }>;
    session: Record<string, unknown>;
    nextTabId: number;
    nextGroupId: number;
  };
  __seedTab: (p?: Record<string, unknown>) => { id: number; windowId: number; groupId: number };
};

const g = globalThis as unknown as GlobalShape;

// ---------------------------------------------------------------------------
// Module reset helpers
// ---------------------------------------------------------------------------

let createToolContext: (typeof import('./context.js'))['createToolContext'];

async function loadFreshModules() {
  // Clear per-connection tab registry.
  delete g.__doe_mcp_tabs;
  // Clear group-manager state so listMembers() starts empty.
  delete g.__doe_group;
  vi.resetModules();
  ({ createToolContext } = await import('./context.js'));
}

beforeEach(loadFreshModules);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMcpCtx(connectionId: string) {
  // conversationId must start with 'mcp_' to set isMcpSession=true; for
  // per-connection scoping we pass the stable bridge connectionId directly.
  return createToolContext(connectionId, new AbortController().signal);
}

function countGroupTabs() {
  let count = 0;
  for (const tab of g.__chromeState.tabs.values()) {
    if (tab.groupId !== -1) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Auto-create behaviour
// ---------------------------------------------------------------------------

describe('MCP session — auto-create tab when group is empty', () => {
  it('creates a new tab instead of throwing when no group member exists', async () => {
    const ctx = makeMcpCtx('mcp_conn_111');
    const tabId = await ctx.getActiveTabId();
    expect(typeof tabId).toBe('number');
    // The tab must exist in Chrome state.
    expect(g.__chromeState.tabs.has(tabId)).toBe(true);
  });

  it('adopts the auto-created tab into a group', async () => {
    const ctx = makeMcpCtx('mcp_conn_222');
    await ctx.getActiveTabId();
    expect(countGroupTabs()).toBeGreaterThan(0);
  });

  it('registers the new tab in the per-connection registry', async () => {
    const connId = 'mcp_conn_333';
    const ctx = makeMcpCtx(connId);
    const tabId = await ctx.getActiveTabId();
    expect(g.__doe_mcp_tabs?.get(connId)).toBe(tabId);
  });
});

// ---------------------------------------------------------------------------
// Per-connection tab reuse
// ---------------------------------------------------------------------------

describe('MCP session — same connectionId reuses the same tab', () => {
  it('returns the same tabId on consecutive calls without creating a second tab', async () => {
    const connId = 'mcp_conn_444';
    // First call — auto-creates a tab.
    const ctx1 = makeMcpCtx(connId);
    const id1 = await ctx1.getActiveTabId();
    const tabsBefore = g.__chromeState.tabs.size;

    // Second call with the SAME connectionId — must reuse.
    const ctx2 = makeMcpCtx(connId);
    const id2 = await ctx2.getActiveTabId();

    expect(id2).toBe(id1);
    expect(g.__chromeState.tabs.size).toBe(tabsBefore);
  });
});

// ---------------------------------------------------------------------------
// Per-connection tab isolation
// ---------------------------------------------------------------------------

describe('MCP session — per-connection tab registry scoping', () => {
  it('each connectionId tracks its tab independently in the registry', async () => {
    // Conn A auto-creates a tab and records it.
    const ctxA = makeMcpCtx('mcp_conn_A');
    const idA = await ctxA.getActiveTabId();
    ctxA.setActiveTabId(idA);

    // Simulate conn B navigating to a different tab later.
    const ctxB = makeMcpCtx('mcp_conn_B');
    const idB = await ctxB.getActiveTabId(); // finds same group tab on first call
    // Now B explicitly sets a different tab (e.g. after tabs_create).
    const newTab = g.__seedTab({ active: false });
    ctxB.setActiveTabId(newTab.id);

    // Registry must store different values per connectionId.
    expect(g.__doe_mcp_tabs?.get('mcp_conn_A')).toBe(idA);
    expect(g.__doe_mcp_tabs?.get('mcp_conn_B')).toBe(newTab.id);
    // They're now distinct.
    expect(g.__doe_mcp_tabs?.get('mcp_conn_A')).not.toBe(g.__doe_mcp_tabs?.get('mcp_conn_B'));
  });

  it('second connection with empty group gets its own auto-created tab', async () => {
    // Conn A creates tab X.
    const ctxA = makeMcpCtx('mcp_conn_X');
    const idX = await ctxA.getActiveTabId();

    // Simulate conn A's tab being removed from the group, leaving it empty.
    const tabEntry = g.__chromeState.tabs.get(idX);
    if (tabEntry) tabEntry.groupId = -1;
    delete g.__doe_group;
    // Reset modules so listMembers() starts fresh with empty group.
    vi.resetModules();
    ({ createToolContext } = await import('./context.js'));
    if (!g.__doe_mcp_tabs) g.__doe_mcp_tabs = new Map();
    // Conn A's stale entry is gone; conn B starts fresh.

    const ctxB = createToolContext('mcp_conn_Y', new AbortController().signal);
    const idY = await ctxB.getActiveTabId();

    expect(typeof idY).toBe('number');
    expect(g.__chromeState.tabs.has(idY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Closed tab recovery
// ---------------------------------------------------------------------------

describe('MCP session — recovers when the cached tab is closed', () => {
  it('creates a new tab when the previously cached tab no longer exists in Chrome', async () => {
    const connId = 'mcp_conn_recover';
    // Establish a cached tab.
    const ctx1 = makeMcpCtx(connId);
    const oldId = await ctx1.getActiveTabId();

    // Simulate the user closing that tab.
    g.__chromeState.tabs.delete(oldId);
    // Also remove from any group so listMembers() returns nothing.
    for (const tab of g.__chromeState.tabs.values()) {
      if (tab.groupId !== -1) g.__chromeState.tabs.delete(tab.id);
    }
    // Clear all tab-group state so listMembers() starts fresh too.
    delete g.__doe_group;
    vi.resetModules();
    ({ createToolContext } = await import('./context.js'));
    // Restore the stale registry entry to test the recovery path.
    if (!g.__doe_mcp_tabs) g.__doe_mcp_tabs = new Map();
    g.__doe_mcp_tabs.set(connId, oldId); // stale — tab no longer exists

    const ctx2 = createToolContext(connId, new AbortController().signal);
    const newId = await ctx2.getActiveTabId();

    expect(newId).not.toBe(oldId);
    expect(g.__chromeState.tabs.has(newId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-MCP sessions still throw
// ---------------------------------------------------------------------------

describe('non-MCP session — throws when group is empty', () => {
  it('rejects with a helpful error when there is no tab in the group', async () => {
    const ctx = createToolContext('interactive_session', new AbortController().signal);
    await expect(ctx.getActiveTabId()).rejects.toThrow('no tab in the agent group');
  });
});

// ---------------------------------------------------------------------------
// Step 4.5 — session-storage fallback when the group is dissolved
// ---------------------------------------------------------------------------

describe('MCP session — step 4.5: re-adopts tab from doe_mcp_last_tab when group is gone', () => {
  it('returns and adopts the existing tab instead of auto-creating when session storage has it', async () => {
    // An ungrouped tab survives in Chrome even though its group was auto-removed.
    const tab = g.__seedTab({ active: false, groupId: -1 });
    // Simulate the previous SW persisting this tab id before it was evicted.
    g.__chromeState.session['doe_mcp_last_tab'] = tab.id;

    const ctx = makeMcpCtx('mcp_conn_step45');
    const result = await ctx.getActiveTabId();

    // Must re-use the existing tab — no second tab created.
    expect(result).toBe(tab.id);
    // The tab must have been adopted into a Doe group.
    const groupId = g.__chromeState.tabs.get(tab.id)?.groupId;
    expect(groupId).not.toBeNull();
    expect(groupId).not.toBe(-1);
  });

  it('falls through to auto-create when doe_mcp_last_tab tab is also closed', async () => {
    // Session storage references a tab id that no longer exists in Chrome.
    g.__chromeState.session['doe_mcp_last_tab'] = 999_999;

    const ctx = makeMcpCtx('mcp_conn_step45b');
    const result = await ctx.getActiveTabId();

    // A brand-new tab is created — step 5.
    expect(typeof result).toBe('number');
    expect(g.__chromeState.tabs.has(result)).toBe(true);
    expect(result).not.toBe(999_999);
  });

  it('does NOT apply session-storage fallback for non-MCP sessions', async () => {
    // Even with doe_mcp_last_tab set, non-MCP sessions must still throw.
    const orphan = g.__seedTab({ groupId: -1 });
    g.__chromeState.session['doe_mcp_last_tab'] = orphan.id;

    const ctx = createToolContext('interactive_session', new AbortController().signal);
    await expect(ctx.getActiveTabId()).rejects.toThrow('no tab in the agent group');
  });

  it('persists the re-adopted tab to doe_mcp_last_tab so the next call uses step 1', async () => {
    const tab = g.__seedTab({ active: false, groupId: -1 });
    g.__chromeState.session['doe_mcp_last_tab'] = tab.id;

    const connId = 'mcp_conn_step45_persist';
    const ctx = makeMcpCtx(connId);
    await ctx.getActiveTabId();

    // The registry must be updated so the NEXT call takes the fast path (step 1).
    expect(g.__doe_mcp_tabs?.get(connId)).toBe(tab.id);
    // Session storage must still hold the tab id.
    expect(g.__chromeState.session['doe_mcp_last_tab']).toBe(tab.id);
  });
});

// ---------------------------------------------------------------------------
// setActiveTabId updates the registry
// ---------------------------------------------------------------------------

describe('setActiveTabId updates the per-connection registry', () => {
  it('stores the explicit tabId under the connectionId immediately', async () => {
    const connId = 'mcp_conn_set';

    // First getActiveTabId auto-creates tab X and registers it.
    const ctx = makeMcpCtx(connId);
    const autoId = await ctx.getActiveTabId();
    expect(g.__doe_mcp_tabs?.get(connId)).toBe(autoId);

    // Now simulate the agent opening a second tab and switching to it.
    const tab2 = g.__seedTab({ active: false });
    ctx.setActiveTabId(tab2.id);

    // Registry must now reflect the new tab, not the auto-created one.
    expect(g.__doe_mcp_tabs?.get(connId)).toBe(tab2.id);
    expect(g.__doe_mcp_tabs?.get(connId)).not.toBe(autoId);
  });
});
