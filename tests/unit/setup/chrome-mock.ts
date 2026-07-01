/**
 * In-memory `chrome.*` fake for unit tests.
 *
 * Rich enough that the tab-group session logic can be exercised for real
 * (tabs/tabGroups with create/group/ungroup/query and Chrome's
 * empty-group-auto-removal), plus working storage.local/session with
 * onChanged events. Everything else the code touches is a no-op stub.
 *
 * `globalThis.__resetChrome()` rebuilds all state — call it in beforeEach.
 * `globalThis.__chromeState` exposes the in-memory model for assertions and
 * seeding (tabs, groups, windowId, focus).
 */
import { beforeEach, vi } from 'vitest';

interface FakeTab {
  id: number;
  windowId: number;
  groupId: number;
  url: string;
  title: string;
  active: boolean;
}

interface FakeGroup {
  id: number;
  windowId: number;
  title: string;
  color: string;
}

interface ChromeState {
  tabs: Map<number, FakeTab>;
  groups: Map<number, FakeGroup>;
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  managed: Record<string, unknown>;
  lastFocusedWindowId: number;
  nextTabId: number;
  nextGroupId: number;
  storageListeners: Array<(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void>;
  areaListeners: { local: Array<(changes: Record<string, unknown>) => void>; session: Array<(changes: Record<string, unknown>) => void> };
  commandListeners: Array<(command: string, tab?: FakeTab) => void>;
  messageListeners: Array<(msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean | void>;
}

const TAB_GROUP_ID_NONE = -1;

function makeState(): ChromeState {
  return {
    tabs: new Map(),
    groups: new Map(),
    local: {},
    session: {},
    managed: {},
    lastFocusedWindowId: 1,
    nextTabId: 100,
    nextGroupId: 1000,
    storageListeners: [],
    areaListeners: { local: [], session: [] },
    commandListeners: [],
    messageListeners: [],
  };
}

let state: ChromeState = makeState();

/** Test helper: add a tab to the model and return it. */
function seedTab(partial: Partial<FakeTab> = {}): FakeTab {
  const id = partial.id ?? state.nextTabId++;
  const tab: FakeTab = {
    id,
    windowId: partial.windowId ?? 1,
    groupId: partial.groupId ?? TAB_GROUP_ID_NONE,
    url: partial.url ?? `https://example.com/${id}`,
    title: partial.title ?? `Tab ${id}`,
    active: partial.active ?? false,
  };
  state.tabs.set(id, tab);
  return tab;
}

/** Drop groups that have no member tabs — mirrors Chrome's behavior. */
function pruneEmptyGroups(): void {
  for (const groupId of [...state.groups.keys()]) {
    const hasMember = [...state.tabs.values()].some(t => t.groupId === groupId);
    if (!hasMember) state.groups.delete(groupId);
  }
}

function emitStorage(area: 'local' | 'session', changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) {
  // Real Chrome dispatches storage.onChanged ASYNCHRONOUSLY (next tick), not
  // re-entrantly inside set(). Firing synchronously here would create
  // cache-clobber races (the createStorage live-update echo re-deserializing
  // mid-set) that the extension never actually hits. Defer to a microtask so
  // a fully-awaited set() settles its own cache before the echo lands.
  const listeners = state.storageListeners;
  const areaListeners = state.areaListeners[area];
  queueMicrotask(() => {
    for (const fn of listeners) fn(changes, area); // global onChanged — (changes, area)
    for (const fn of areaListeners) fn(changes); // per-area onChanged — (changes)
  });
}

function makeStorageArea(area: 'local' | 'session') {
  const store = () => (area === 'local' ? state.local : state.session);
  return {
    onChanged: {
      addListener: vi.fn((fn: (changes: Record<string, unknown>) => void) => state.areaListeners[area].push(fn)),
      removeListener: vi.fn((fn: (changes: Record<string, unknown>) => void) => {
        state.areaListeners[area] = state.areaListeners[area].filter(l => l !== fn);
      }),
    },
    get: vi.fn(async (keys?: string | string[] | null) => {
      const s = store();
      if (keys === undefined || keys === null) return { ...s };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in s) out[k] = s[k];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const s = store();
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: s[k], newValue: v };
        s[k] = v;
      }
      emitStorage(area, changes);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const s = store();
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const k of list) {
        if (k in s) {
          changes[k] = { oldValue: s[k], newValue: undefined };
          delete s[k];
        }
      }
      if (Object.keys(changes).length) emitStorage(area, changes);
    }),
    clear: vi.fn(async () => {
      const s = store();
      for (const k of Object.keys(s)) delete s[k];
    }),
  };
}

function buildChrome() {
  return {
    runtime: {
      id: 'de-test-extension',
      lastError: undefined,
      getManifest: vi.fn(() => ({ version: '0.0.0-test' })),
      getURL: vi.fn((path: string) => `chrome-extension://de-test/${path}`),
      sendMessage: vi.fn(async () => undefined),
      openOptionsPage: vi.fn(async () => undefined),
      connect: vi.fn(() => ({
        name: 'mock-port',
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      })),
      onMessage: {
        addListener: vi.fn((fn: ChromeState['messageListeners'][number]) => state.messageListeners.push(fn)),
        removeListener: vi.fn(),
      },
      onConnect: { addListener: vi.fn(), removeListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      setUninstallURL: vi.fn(),
    },
    storage: {
      local: makeStorageArea('local'),
      session: makeStorageArea('session'),
      // Enterprise managed policy — read-only in real Chrome; seed via
      // __chromeState.managed in tests.
      managed: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          const s = state.managed;
          if (keys === undefined || keys === null) return { ...s };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in s) out[k] = s[k];
          return out;
        }),
      },
      onChanged: {
        addListener: vi.fn((fn: ChromeState['storageListeners'][number]) => state.storageListeners.push(fn)),
        removeListener: vi.fn((fn: ChromeState['storageListeners'][number]) => {
          state.storageListeners = state.storageListeners.filter(l => l !== fn);
        }),
      },
    },
    tabs: {
      get: vi.fn(async (tabId: number) => {
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return { ...tab };
      }),
      query: vi.fn(async (info: { groupId?: number; active?: boolean; lastFocusedWindow?: boolean } = {}) => {
        let list = [...state.tabs.values()];
        if (typeof info.groupId === 'number') list = list.filter(t => t.groupId === info.groupId);
        if (info.lastFocusedWindow) list = list.filter(t => t.windowId === state.lastFocusedWindowId);
        if (info.active) list = list.filter(t => t.active);
        return list.map(t => ({ ...t }));
      }),
      group: vi.fn(async ({ tabIds, groupId }: { tabIds: number | number[]; groupId?: number }) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        let gid = groupId;
        if (gid === undefined) {
          gid = state.nextGroupId++;
          const seed = state.tabs.get(ids[0]);
          state.groups.set(gid, { id: gid, windowId: seed?.windowId ?? 1, title: '', color: 'grey' });
        }
        for (const id of ids) {
          const tab = state.tabs.get(id);
          if (tab) tab.groupId = gid;
        }
        pruneEmptyGroups();
        return gid;
      }),
      ungroup: vi.fn(async (tabIds: number | number[]) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) {
          const tab = state.tabs.get(id);
          if (tab) tab.groupId = TAB_GROUP_ID_NONE;
        }
        pruneEmptyGroups();
      }),
      create: vi.fn(async ({ url }: { url?: string } = {}) => seedTab({ url, active: true })),
      update: vi.fn(async (tabId: number, props: Partial<FakeTab>) => {
        const tab = state.tabs.get(tabId);
        if (tab) Object.assign(tab, props);
        return tab ? { ...tab } : undefined;
      }),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabGroups: {
      TAB_GROUP_ID_NONE,
      Color: {
        grey: 'grey',
        blue: 'blue',
        red: 'red',
        yellow: 'yellow',
        green: 'green',
        pink: 'pink',
        purple: 'purple',
        cyan: 'cyan',
        orange: 'orange',
      },
      get: vi.fn(async (groupId: number) => {
        const group = state.groups.get(groupId);
        if (!group) throw new Error(`No group with id ${groupId}`);
        return { ...group };
      }),
      query: vi.fn(async (info: { title?: string; windowId?: number } = {}) => {
        let list = [...state.groups.values()];
        if (info.title !== undefined) list = list.filter(g => g.title === info.title);
        if (typeof info.windowId === 'number') list = list.filter(g => g.windowId === info.windowId);
        return list.map(g => ({ ...g }));
      }),
      update: vi.fn(async (groupId: number, props: Partial<FakeGroup>) => {
        const group = state.groups.get(groupId);
        if (group) Object.assign(group, props);
        return group ? { ...group } : undefined;
      }),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: {
      getCurrent: vi.fn(async () => ({ id: state.lastFocusedWindowId })),
      getLastFocused: vi.fn(async () => ({ id: state.lastFocusedWindowId })),
      update: vi.fn(async () => undefined),
    },
    sidePanel: {
      setOptions: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
      setPanelBehavior: vi.fn(async () => undefined),
    },
    commands: {
      getAll: vi.fn(async () => []),
      onCommand: { addListener: vi.fn((fn: ChromeState['commandListeners'][number]) => state.commandListeners.push(fn)) },
    },
    i18n: {
      getUILanguage: vi.fn(() => 'en-US'),
      getMessage: vi.fn((key: string) => key),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    notifications: {
      create: vi.fn(async () => 'notif-id'),
      clear: vi.fn(async () => true),
      onClicked: { addListener: vi.fn() },
    },
    declarativeNetRequest: {
      updateDynamicRules: vi.fn(async () => undefined),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: undefined }]),
    },
    action: {
      onClicked: { addListener: vi.fn() },
    },
  };
}

function install(): void {
  state = makeState();
  const chrome = buildChrome();
  const g = globalThis as unknown as { chrome: unknown; __chromeState: ChromeState; __seedTab: typeof seedTab };
  g.chrome = chrome;
  g.__chromeState = state;
  g.__seedTab = seedTab;
}

(globalThis as unknown as { __resetChrome: () => void }).__resetChrome = install;

// Fresh fake before every test, in every project that loads this setup.
install();
beforeEach(install);

export { seedTab };
export type { ChromeState, FakeTab, FakeGroup };
