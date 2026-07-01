/**
 * TabGroupManager — owns the ACTIVE doeverything tab group (one session = one
 * Chrome tab group).
 *
 * The agent runs against a *group of tabs*, not a single tab. Opening the
 * side panel on a tab is a SESSION gesture (`adoptSeedTab`):
 *
 *   - tab already inside an doeverything group → that group becomes the active
 *     session again (reopening on an old session's tab resumes it);
 *   - otherwise → a brand-new group is created, even when another doeverything
 *     group already exists in the window. Sessions never merge just
 *     because the group title matches.
 *
 * Tabs the agent spawns mid-run (tabs_create, the scheduler) JOIN the
 * active group via `adoptTab` — they never fork a new session.
 *
 * The side panel is enabled only for tabs of the ACTIVE group:
 *   - switching to a tab outside it hides the panel;
 *   - clicking the toolbar icon on an old session's tab re-activates that
 *     session (and the panel follows it again).
 *
 * The active group id is mirrored to `chrome.storage.session` so an MV3
 * SW eviction can't lose track of WHICH group is active — the old
 * title-based recovery (`tabGroups.query({title})` → first hit) grabbed an
 * arbitrary doeverything group and was exactly how unrelated sessions got
 * glued together.
 *
 * Per-tab side-panel visibility is enforced by `handlers/tab-panel.ts`
 * (chrome.tabs.onActivated listener), which calls
 * `sidePanel.setOptions({tabId, enabled})` accordingly.
 *
 * Tab group title rules:
 *   - "Doe"       — always the default; user-opened or any session without MCP
 *   - "Doe (MCP)" — only when MCP auto-created the group (no existing session);
 *                   set via `markAsMcpGroup()` called from context.ts after
 *                   the auto-create path. User-opened groups NEVER get "(MCP)"
 *                   even when the relay WebSocket is connected.
 */

import { TabEventHub } from './event-hub.js';
import { commitSessionState, loadSessionState } from '../skills/session-state.js';

const GROUP_TITLE = 'Doe';
const GROUP_TITLE_MCP = 'Doe (MCP)';
const PANEL_PATH = 'side-panel/index.html';
const ACTIVE_GROUP_KEY = 'active-tab-group';

/** True for any title that belongs to this extension (both normal and MCP). */
function isOwnTitle(title: string | undefined): boolean {
  return title === GROUP_TITLE || title === GROUP_TITLE_MCP;
}

const CYCLE_COLORS: `${chrome.tabGroups.Color}`[] = [
  'orange', 'cyan', 'purple', 'pink', 'green', 'blue', 'red', 'yellow',
];
const COLOR_INDEX_KEY = 'doe:tab-color-index';

async function nextGroupColor(): Promise<`${chrome.tabGroups.Color}`> {
  const result = await chrome.storage.local.get(COLOR_INDEX_KEY);
  const stored = result[COLOR_INDEX_KEY];
  const idx = (typeof stored === 'number' ? stored : 0) % CYCLE_COLORS.length;
  await chrome.storage.local.set({ [COLOR_INDEX_KEY]: idx + 1 });
  return CYCLE_COLORS[idx];
}

interface GroupState {
  groupId: number | null;
  members: Set<number>;
  /**
   * Tabs whose adoption is currently in flight. Moving a tab between groups
   * (e.g. stealing it from another extension's tab group) fires a
   * transitional `groupId: -1` tabs.onUpdated event before the final one;
   * tab-panel.ts consults this set so that transient doesn't disable the
   * side panel the adoption flow just opened.
   */
  adopting: Set<number>;
  /**
   * True only when MCP auto-created this group (no existing session was
   * present). Distinct from mcpMode (WebSocket connected): a user-opened
   * group should stay "Doe" even while MCP is connected. Set exclusively by
   * `markAsMcpGroup()` which is called from context.ts only in the
   * auto-create code path. Reset when a new group is created or disbanded.
   */
  mcpGroup: boolean;
}

const ADOPTION_SETTLE_MS = 1500;

const G = globalThis as unknown as { __doe_group?: GroupState };
if (!G.__doe_group) {
  G.__doe_group = { groupId: null, members: new Set(), adopting: new Set(), mcpGroup: false };
}
const state = G.__doe_group;
state.adopting ??= new Set();

const seedInFlight = new Map<number, Promise<number | null>>();

function persistActiveGroup(groupId: number | null): void {
  void commitSessionState(ACTIVE_GROUP_KEY, groupId);
}

async function restoreActiveGroup(): Promise<number | null> {
  const stored = await loadSessionState<number | null>(ACTIVE_GROUP_KEY, () => null);
  if (typeof stored !== 'number') return null;
  try {
    const group = await chrome.tabGroups.get(stored);
    if (!isOwnTitle(group.title)) return null;
    // Recover mcpGroup from the persisted Chrome title so SW eviction doesn't
    // lose the "(MCP)" label — the title IS the durable source of truth.
    state.mcpGroup = group.title === GROUP_TITLE_MCP;
    return stored;
  } catch {
    return null;
  }
}

async function activateGroup(groupId: number): Promise<void> {
  state.groupId = groupId;
  const [tabs, group] = await Promise.all([
    chrome.tabs.query({ groupId }),
    chrome.tabGroups.get(groupId).catch(() => null),
  ]);
  state.members = new Set(tabs.map(t => t.id!).filter(Boolean));
  state.mcpGroup = group?.title === GROUP_TITLE_MCP;
  persistActiveGroup(groupId);
}

async function createGroup(seedTabId: number): Promise<number> {
  const color = await nextGroupColor();
  const groupId = await chrome.tabs.group({ tabIds: [seedTabId] });
  state.groupId = groupId;
  state.members = new Set([seedTabId]);
  state.mcpGroup = false;
  persistActiveGroup(groupId);
  await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color });
  return groupId;
}

async function enablePanel(tabId: number) {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  } catch (err) {
    console.warn('[doeverything] sidePanel.setOptions(enable) failed', tabId, err);
  }
}

async function disablePanel(tabId: number) {
  try {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  } catch (err) {
    console.warn('[doeverything] sidePanel.setOptions(disable) failed', tabId, err);
  }
}

async function seedSession(tabId: number): Promise<number | null> {
  state.adopting.add(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (typeof tab.groupId === 'number' && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (isOwnTitle(group.title)) {
          await activateGroup(group.id);
          await enablePanel(tabId);
          return group.id;
        }
      } catch {
        // Group vanished mid-flight — treat the tab as ungrouped.
      }
    }
    const groupId = await createGroup(tabId);
    await enablePanel(tabId);
    return groupId;
  } catch (err) {
    console.warn('[doeverything] failed to seed session group', err);
    return null;
  } finally {
    setTimeout(() => state.adopting.delete(tabId), ADOPTION_SETTLE_MS);
  }
}

export const TabGroupManager = {
  adoptSeedTab(tabId: number): Promise<number | null> {
    const existing = seedInFlight.get(tabId);
    if (existing) return existing;
    const p = seedSession(tabId).finally(() => seedInFlight.delete(tabId));
    seedInFlight.set(tabId, p);
    return p;
  },

  async ensureSeedTab(): Promise<void> {
    let focusedId: number | undefined;
    try {
      const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      focusedId = focused?.id;
    } catch {
      // No resolvable focused tab.
    }

    const members = await this.listMembers().catch(() => [] as chrome.tabs.Tab[]);

    if (focusedId !== undefined && members.some(t => t.id === focusedId)) return;
    if (focusedId === undefined) return;
    await this.adoptSeedTab(focusedId);
  },

  async adoptTab(tabId: number): Promise<number | null> {
    state.adopting.add(tabId);
    try {
      let groupId = state.groupId;
      if (groupId === null) groupId = await restoreActiveGroup();
      if (groupId !== null) {
        try {
          const [group, tab] = await Promise.all([chrome.tabGroups.get(groupId), chrome.tabs.get(tabId)]);
          if (group.windowId !== tab.windowId) groupId = null;
        } catch {
          groupId = null;
        }
      }

      if (groupId === null) {
        groupId = await createGroup(tabId);
      } else {
        if (state.groupId !== groupId) await activateGroup(groupId);
        const tab = await chrome.tabs.get(tabId);
        if (tab.groupId !== groupId) {
          await chrome.tabs.group({ groupId, tabIds: [tabId] });
        }
        state.members.add(tabId);
      }
      await enablePanel(tabId);
      return groupId;
    } catch (err) {
      console.warn('[doeverything] failed to adopt tab into group', err);
      return null;
    } finally {
      setTimeout(() => state.adopting.delete(tabId), ADOPTION_SETTLE_MS);
    }
  },

  isAdopting(tabId: number): boolean {
    return state.adopting.has(tabId);
  },

  /**
   * True if `tabId` belongs to ANY tab group with a Doe title — regardless of
   * which group is currently "active". MCP sessions use this instead of `owns()`
   * to avoid being redirected when the user opens a new side-panel tab (which
   * promotes a different group to "active" without touching the MCP session's tab).
   */
  async isOwnTab(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (typeof tab.groupId !== 'number' || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
      const group = await chrome.tabGroups.get(tab.groupId);
      return isOwnTitle(group.title);
    } catch {
      return false;
    }
  },

  async owns(tabId: number): Promise<boolean> {
    if (state.groupId === null) {
      const restored = await restoreActiveGroup();
      if (restored === null) return false;
      await activateGroup(restored);
    }
    if (state.members.has(tabId)) return true;
    try {
      const tab = await chrome.tabs.get(tabId);
      const inGroup = tab.groupId === state.groupId;
      if (inGroup) state.members.add(tabId);
      return inGroup;
    } catch {
      return false;
    }
  },

  async listMembers(): Promise<chrome.tabs.Tab[]> {
    if (state.groupId === null) {
      const restored = await restoreActiveGroup();
      if (restored === null) return [];
      state.groupId = restored;
      persistActiveGroup(restored);
    }
    const tabs = await chrome.tabs.query({ groupId: state.groupId });
    state.members = new Set(tabs.map(t => t.id!).filter(Boolean));
    return tabs;
  },

  getGroupId(): number | null {
    return state.groupId;
  },

  /**
   * Called from context.ts ONLY when MCP auto-creates a new tab because no
   * existing group/tab was available. Renames the group to "Doe (MCP)" so
   * users can distinguish MCP-initiated sessions from manually-opened ones.
   *
   * NOT called when MCP merely uses an existing user-opened group.
   */
  async markAsMcpGroup(): Promise<void> {
    if (state.mcpGroup) return;
    state.mcpGroup = true;
    if (state.groupId === null) return;
    try {
      await chrome.tabGroups.update(state.groupId, { title: GROUP_TITLE_MCP });
    } catch {
      // Group may have been closed — no-op.
    }
  },

  async disband(): Promise<void> {
    if (state.groupId === null) return;
    try {
      const tabs = await chrome.tabs.query({ groupId: state.groupId });
      const ids = tabs.map(t => t.id!).filter(Boolean);
      if (ids.length > 0) await chrome.tabs.ungroup(ids);
      for (const id of ids) await disablePanel(id);
    } catch {
      // group may already be gone
    } finally {
      state.groupId = null;
      state.members.clear();
      state.mcpGroup = false;
      persistActiveGroup(null);
    }
  },

  _forget(tabId: number) {
    state.members.delete(tabId);
    // Guard: only wipe session storage when we KNOW the group is gone (i.e.
    // state.groupId is set and we just removed its last tracked member).
    // Without this check, after an SW eviction the members set is empty but
    // state.groupId is null; any unrelated tab close would hit size===0,
    // call persistActiveGroup(null), and corrupt the stored groupId — causing
    // every subsequent MCP tool call to spin up a new tab group.
    if (state.members.size === 0 && state.groupId !== null) {
      state.groupId = null;
      persistActiveGroup(null);
    }
  },
};

TabEventHub.onRemoved(tabId => {
  TabGroupManager._forget(tabId);
});
