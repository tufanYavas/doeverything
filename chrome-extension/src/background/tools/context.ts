/**
 * AgentToolContext — passed to every tool's `execute()` so tools can resolve
 * the "current target tab" without the agent having to thread tab ids
 * through every call. The context is populated once per agent run.
 *
 * Tab access is *scoped to the doeverything tab group*: the agent can only
 * operate on tabs that belong to the group attached to its session. Any
 * tabId arg coming from the model is validated; if it doesn't belong to the
 * group, tools throw a clear error so the model can recover by calling
 * `tabs_context` instead of silently driving an unrelated tab.
 */

import { CdpController } from '../cdp/controller.js';
import { TabGroupManager } from '../tabs/group-manager.js';

export interface ToolLifecycle {
  onToolStart(call: { id: string; name: string; args: unknown }): void;
  onToolEnd(call: { id: string; name: string; result: unknown; isError: boolean }): void;
}

export interface AgentToolContext {
  conversationId: string;
  signal: AbortSignal;
  /**
   * True when the context was created for an MCP tool call (not the
   * interactive side-panel agent). MCP sessions have no permission UI —
   * tools must skip interactive prompts and auto-allow or use stored grants.
   */
  isMcpSession: boolean;
  getEffectiveTabId(requestedTabId?: number): Promise<number>;
  /** @deprecated equivalent to `getEffectiveTabId(undefined)` */
  getActiveTabId(): Promise<number>;
  setActiveTabId(tabId: number): void;
  listGroupTabs(): Promise<Array<{ id: number; title: string; url: string; active: boolean }>>;
  cdp: CdpController;
  groups: typeof TabGroupManager;
  lifecycle?: ToolLifecycle;
}

// Per-connection tab registry: conversationId → tabId.
// Dual-layer: in-memory Map (fast, same SW lifetime) + chrome.storage.session
// (survives SW eviction so MCP sessions don't lose their tab on every ~30s
// dormancy cycle). Keyed by the stable connectionId from bridge.ts.
const G = globalThis as unknown as { __doe_mcp_tabs?: Map<string, number> };
if (!G.__doe_mcp_tabs) G.__doe_mcp_tabs = new Map();

const MCP_TAB_MAP_KEY = 'doe_mcp_tab_map';

function persistTabMapping(conversationId: string, tabId: number): void {
  G.__doe_mcp_tabs?.set(conversationId, tabId);
  void (async () => {
    try {
      const stored = await chrome.storage.session.get(MCP_TAB_MAP_KEY);
      const map = (stored[MCP_TAB_MAP_KEY] as Record<string, number> | undefined) ?? {};
      map[conversationId] = tabId;
      await chrome.storage.session.set({ [MCP_TAB_MAP_KEY]: map });
    } catch { /* storage unavailable */ }
  })();
}

function deleteTabMapping(conversationId: string): void {
  G.__doe_mcp_tabs?.delete(conversationId);
  void (async () => {
    try {
      const stored = await chrome.storage.session.get(MCP_TAB_MAP_KEY);
      const map = stored[MCP_TAB_MAP_KEY] as Record<string, number> | undefined;
      if (map && conversationId in map) {
        delete map[conversationId];
        await chrome.storage.session.set({ [MCP_TAB_MAP_KEY]: map });
      }
    } catch { /* storage unavailable */ }
  })();
}

async function lookupTabMapping(conversationId: string): Promise<number | null> {
  const inMemory = G.__doe_mcp_tabs?.get(conversationId);
  if (inMemory != null) return inMemory;
  try {
    const stored = await chrome.storage.session.get(MCP_TAB_MAP_KEY);
    const map = stored[MCP_TAB_MAP_KEY] as Record<string, number> | undefined;
    const tabId = map?.[conversationId];
    if (tabId != null) {
      // Warm the in-memory cache so subsequent calls skip storage.
      G.__doe_mcp_tabs?.set(conversationId, tabId);
      return tabId;
    }
  } catch { /* storage unavailable */ }
  return null;
}

export function createToolContext(
  conversationId: string,
  signal: AbortSignal,
  lifecycle?: ToolLifecycle,
): AgentToolContext {
  const isMcpSession = conversationId.startsWith('mcp_');
  let activeTabId: number | null = null;

  async function listGroupTabs() {
    const members = await TabGroupManager.listMembers().catch(() => [] as chrome.tabs.Tab[]);
    return members
      .filter(t => t.id !== undefined)
      .map(t => ({
        id: t.id!,
        title: t.title ?? '',
        url: t.url ?? '',
        active: t.active === true,
      }));
  }

  async function isInGroup(tabId: number): Promise<boolean> {
    return TabGroupManager.owns(tabId).catch(() => false);
  }

  /**
   * Resolve which tab to drive for this tool call.
   *
   * Resolution order:
   *   1. Per-connection registry (MCP: remember last tab across calls)
   *   2. Last tab the agent navigated to in this call chain
   *   3. The focused tab in the last-focused window if it's in the group
   *   4. Any member of the active group
   *   5. Auto-create a new tab (MCP only) — also marks the group as "(MCP)"
   *
   * The "(MCP)" label is set ONLY in case 5: when MCP had no existing session
   * and had to create one. User-opened groups never get "(MCP)" even when the
   * relay WebSocket is connected.
   */
  function persistMcpTab(tabId: number): void {
    persistTabMapping(conversationId, tabId);
  }

  async function pickDefaultTab(): Promise<number> {
    // 1. Per-connection registry (MCP sessions only) — check both in-memory
    //    and storage so the tab survives SW eviction / dormancy cycles.
    if (isMcpSession) {
      const cached = await lookupTabMapping(conversationId);
      if (cached != null) {
        // Use isOwnTab (any Doe group) instead of isInGroup (active group only).
        // This prevents the MCP session from being redirected when the user
        // opens a new side-panel tab, which changes the "active" group without
        // touching the MCP session's tab.
        if (await TabGroupManager.isOwnTab(cached).catch(() => false)) {
          try {
            await chrome.tabs.get(cached);
            activeTabId = cached;
            return cached;
          } catch {
            deleteTabMapping(conversationId);
          }
        } else {
          deleteTabMapping(conversationId);
        }
      }
    }

    // 2. Last navigated tab.
    if (activeTabId !== null && (await isInGroup(activeTabId))) {
      try {
        await chrome.tabs.get(activeTabId);
        return activeTabId;
      } catch {
        activeTabId = null;
      }
    }

    // 3. Focused tab in the active group.
    try {
      const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (focused?.id && (await isInGroup(focused.id))) {
        activeTabId = focused.id;
        if (isMcpSession) persistMcpTab(focused.id);
        return focused.id;
      }
    } catch {
      // fall through
    }

    // 4. Any group member.
    const members = await TabGroupManager.listMembers().catch(() => [] as chrome.tabs.Tab[]);
    const first = members.find(t => t.id !== undefined);
    if (first?.id) {
      activeTabId = first.id;
      if (isMcpSession) persistMcpTab(first.id);
      return first.id;
    }

    // 4.5. Session-storage fallback for MCP: if the group is gone (all its tabs were
    // closed → Chrome auto-removed the group) but the last known MCP tab still exists
    // in Chrome (just ungrouped), re-adopt it rather than auto-creating a new one.
    // Uses the per-session map which already survived SW eviction via storage.
    if (isMcpSession) {
      try {
        const stored = await chrome.storage.session.get(MCP_TAB_MAP_KEY);
        const map = stored[MCP_TAB_MAP_KEY] as Record<string, number> | undefined;
        const lastTabId = map?.[conversationId];
        if (typeof lastTabId === 'number') {
          const tab = await chrome.tabs.get(lastTabId);
          if (tab.id) {
            await TabGroupManager.adoptTab(tab.id);
            activeTabId = tab.id;
            persistMcpTab(tab.id);
            return tab.id;
          }
        }
      } catch {
        // Tab was closed or storage unavailable — fall through to step 5.
      }
    }

    // 5. Auto-create (MCP only) — no existing session, MCP opens one.
    if (!isMcpSession) {
      throw new Error(
        'doeverything: no tab in the agent group. Open the side panel on a tab first.',
      );
    }
    const newTab = await chrome.tabs.create({ url: 'chrome://newtab', active: false });
    if (!newTab.id) throw new Error('doeverything: failed to create a tab for MCP session');
    await TabGroupManager.adoptTab(newTab.id);
    activeTabId = newTab.id;
    persistMcpTab(newTab.id);
    // Mark the group as MCP-created — this is the ONLY place that sets "(MCP)".
    void TabGroupManager.markAsMcpGroup();
    return newTab.id;
  }

  return {
    conversationId,
    signal,
    isMcpSession,
    cdp: CdpController.getInstance(),
    groups: TabGroupManager,
    lifecycle,
    listGroupTabs,
    async getEffectiveTabId(requestedTabId?: number): Promise<number> {
      if (requestedTabId === undefined) return pickDefaultTab();
      if (!(await isInGroup(requestedTabId))) {
        const members = await listGroupTabs();
        const valid = members.map(t => t.id).join(', ') || '(none)';
        throw new Error(
          `Tab ${requestedTabId} is not in the agent's tab group. Valid tab ids: ${valid}. Call \`tabs_context\` to refresh.`,
        );
      }
      activeTabId = requestedTabId;
      return requestedTabId;
    },
    async getActiveTabId(): Promise<number> {
      return pickDefaultTab();
    },
    setActiveTabId(tabId: number) {
      activeTabId = tabId;
      if (isMcpSession) persistMcpTab(tabId);
    },
  };
}
