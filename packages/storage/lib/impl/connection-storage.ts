import { createStorage, StorageEnum } from '../base/index.js';
import { decryptSecret, encryptSecret } from '../util/secret-crypto.js';
import type { ConnectionState } from './brand-types.js';
import type { BaseStorageType } from '../base/types.js';

const STORAGE_KEY = 'doe:connection';

const DEFAULT_RELAY_BASE_URL = process.env['DOE_RELAY_BASE_URL'] || null;

const DEFAULT_STATE: ConnectionState = {
  token: null,
  relayBaseUrl: DEFAULT_RELAY_BASE_URL,
  status: 'disconnected',
  lastError: null,
  lastConnectedAt: null,
  userEnabled: false,
};

const storage = createStorage<ConnectionState>(STORAGE_KEY, DEFAULT_STATE, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
  serialization: {
    // Encrypt the bearer token at rest with AES-256-GCM (same key store used
    // for API keys). The relay URL and status fields are non-secret metadata.
    serialize: async state => ({
      ...state,
      token: state.token ? await encryptSecret(state.token) : null,
    }),
    deserialize: async raw => {
      if (!raw || typeof raw !== 'object') return raw as ConnectionState;
      const r = raw as Partial<ConnectionState>;
      return {
        token: r.token ? await decryptSecret(r.token) : null,
        relayBaseUrl: r.relayBaseUrl ?? DEFAULT_RELAY_BASE_URL,
        status: r.status ?? 'disconnected',
        lastError: r.lastError ?? null,
        lastConnectedAt: r.lastConnectedAt ?? null,
        userEnabled: r.userEnabled ?? false,
      };
    },
  },
});

export interface ConnectionStorageType extends BaseStorageType<ConnectionState> {
  /** Generate-and-persist a fresh per-install token if one isn't set yet. */
  ensureToken: () => Promise<string>;
  /** Set the relay base URL (no trailing slash). */
  setRelayBaseUrl: (url: string | null) => Promise<void>;
  /** Update the live WS status flag. */
  setStatus: (status: ConnectionState['status'], error?: string | null) => Promise<void>;
  /** Bump `lastConnectedAt` to now. */
  markConnected: () => Promise<void>;
  /** Wipe the token (revokes any existing relay session). */
  resetToken: () => Promise<string>;
  /** Persist whether the user has opted in to the relay connection. */
  setUserEnabled: (enabled: boolean) => Promise<void>;
}

function generateToken(): string {
  // 16 random bytes → 22-char base64url, plenty of entropy for a relay path id.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export const connectionStorage: ConnectionStorageType = {
  ...storage,
  ensureToken: async () => {
    const state = await storage.get();
    if (state.token) return state.token;
    const token = generateToken();
    await storage.set(prev => ({ ...prev, token }));
    return token;
  },
  setRelayBaseUrl: url =>
    storage.set(prev => ({ ...prev, relayBaseUrl: url ? url.replace(/\/+$/, '') : null })),
  setStatus: (status, error = null) =>
    storage.set(prev => ({ ...prev, status, lastError: error })),
  markConnected: () =>
    storage.set(prev => ({ ...prev, lastConnectedAt: Date.now(), status: 'connected', lastError: null })),
  resetToken: async () => {
    const token = generateToken();
    await storage.set(prev => ({ ...prev, token, status: 'disconnected', lastError: null, lastConnectedAt: null }));
    return token;
  },
  setUserEnabled: enabled =>
    storage.set(prev => ({ ...prev, userEnabled: enabled })),
};
