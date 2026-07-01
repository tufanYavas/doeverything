import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * Per-host persistent permissions. The agent calls `isAllowed(host, kind)`
 * before every gated tool; the side panel writes `allow(host, kind, scope)`
 * after the user clicks "Allow once / Always".
 *
 * `session` scope lives in chrome.storage.session (cleared by Chrome on the
 * next browser restart). `always` scope lives in chrome.storage.local.
 */

export type PermissionKind = 'navigate' | 'click' | 'type' | 'browser_control' | 'mcp';

export interface PermissionGrant {
  host: string;
  kind: PermissionKind;
  scope: 'always' | 'session';
  grantedAt: number;
}

interface PermissionsState {
  always: PermissionGrant[];
  session: PermissionGrant[];
  /** First-time browser-control acceptance flag (Phase 4 BrowserControlAcceptance prompt). */
  browserControlAccepted: boolean;
}

const DEFAULT: PermissionsState = {
  always: [],
  session: [],
  browserControlAccepted: false,
};

const storage = createStorage<PermissionsState>('doe:permissions', DEFAULT, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export interface PermissionsStorageType extends BaseStorageType<PermissionsState> {
  isAllowed: (host: string, kind: PermissionKind) => Promise<boolean>;
  grant: (host: string, kind: PermissionKind, scope: 'always' | 'session') => Promise<void>;
  revoke: (host: string, kind: PermissionKind) => Promise<void>;
  clearSession: () => Promise<void>;
  setBrowserControlAccepted: (accepted: boolean) => Promise<void>;
}

const matches = (g: PermissionGrant, host: string, kind: PermissionKind) =>
  g.kind === kind && (g.host === host || g.host === '*');

export const permissionsStorage: PermissionsStorageType = {
  ...storage,
  isAllowed: async (host, kind) => {
    const state = await storage.get();
    return state.always.some(g => matches(g, host, kind)) || state.session.some(g => matches(g, host, kind));
  },
  grant: (host, kind, scope) =>
    storage.set(prev => {
      const list = scope === 'always' ? prev.always : prev.session;
      const filtered = list.filter(g => !(g.host === host && g.kind === kind));
      const next = [...filtered, { host, kind, scope, grantedAt: Date.now() }];
      return scope === 'always' ? { ...prev, always: next } : { ...prev, session: next };
    }),
  revoke: (host, kind) =>
    storage.set(prev => ({
      ...prev,
      always: prev.always.filter(g => !(g.host === host && g.kind === kind)),
      session: prev.session.filter(g => !(g.host === host && g.kind === kind)),
    })),
  clearSession: () => storage.set(prev => ({ ...prev, session: [] })),
  setBrowserControlAccepted: accepted => storage.set(prev => ({ ...prev, browserControlAccepted: accepted })),
};
