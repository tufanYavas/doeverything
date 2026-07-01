import { createStorage, StorageEnum } from '../base/index.js';
import { decryptSecret, encryptSecret } from '../util/secret-crypto.js';
import type { FastModelConfig, LlmConfigState, LlmProviderId, RecentModel } from './brand-types.js';
import type { BaseStorageType } from '../base/types.js';

const STORAGE_KEY = 'doe:llm-config';

const DEFAULT_STATE: LlmConfigState = {
  provider: 'anthropic',
  models: {},
  apiKeys: {},
  baseUrls: {},
  fastModel: null,
  recentModels: [],
};

/** Active provider's chosen model id (empty → provider's bootstrap default). */
export const activeModel = (cfg: LlmConfigState): string => cfg.models[cfg.provider] ?? '';

/** Active provider's base-URL override (empty → provider's canonical endpoint). */
export const activeBaseUrl = (cfg: LlmConfigState): string => cfg.baseUrls[cfg.provider] ?? '';

const storage = createStorage<LlmConfigState>(STORAGE_KEY, DEFAULT_STATE, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
  serialization: {
    // Encrypt API keys at rest. Other fields stay in cleartext so the LevelDB
    // contents remain inspectable for debugging.
    serialize: async state => {
      const apiKeys: Record<string, string> = {};
      for (const [provider, key] of Object.entries(state.apiKeys ?? {})) {
        apiKeys[provider] = await encryptSecret(key);
      }
      return { ...state, apiKeys };
    },
    deserialize: async raw => {
      if (!raw || typeof raw !== 'object') return raw as LlmConfigState;
      const r = raw as Partial<LlmConfigState>;
      const apiKeys: Record<string, string> = {};
      for (const [provider, key] of Object.entries(r.apiKeys ?? {})) {
        apiKeys[provider] = await decryptSecret(key);
      }
      return {
        provider: r.provider ?? DEFAULT_STATE.provider,
        models: r.models ?? {},
        apiKeys,
        baseUrls: r.baseUrls ?? {},
        fastModel: r.fastModel ?? null,
        recentModels: r.recentModels ?? [],
      };
    },
  },
});

export interface LlmConfigStorageType extends BaseStorageType<LlmConfigState> {
  setProvider: (provider: LlmProviderId) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  /**
   * Switch provider AND set its model in a single atomic write. The base
   * `storage.set` has no lock, so firing `setProvider` + `setModel` as two
   * un-awaited calls races on a shared `prev` — the model can land under
   * the wrong provider key. Callers that change both at once (the side-panel
   * model dropdown) must use this.
   */
  setProviderModel: (provider: LlmProviderId, model: string) => Promise<void>;
  setBaseUrl: (baseUrl: string) => Promise<void>;
  setApiKey: (provider: LlmProviderId, apiKey: string) => Promise<void>;
  /** Convenience read for the active provider's API key. */
  getActiveApiKey: () => Promise<string>;
  /**
   * Set the fast/aux model. Pass `null` to clear and fall back to the
   * main model. Both fields are required when set; an empty `model`
   * string is treated as "not configured" by `resolveFastModel`.
   */
  setFastModel: (next: FastModelConfig | null) => Promise<void>;
  /**
   * Record a successful provider+model use. Moves the entry to the front
   * of `recentModels`, deduplicates, and caps the list at 5.
   */
  recordRecentModel: (provider: LlmProviderId, model: string) => Promise<void>;
}

export const llmConfigStorage: LlmConfigStorageType = {
  ...storage,
  // Switching providers is leak-proof now that model + baseUrl are
  // per-provider: each provider's own values live under its own key, so the
  // active provider's `activeModel`/`activeBaseUrl` always resolve to that
  // provider's settings (or its canonical default) — never a stale one from
  // whatever provider was selected before.
  setProvider: provider => storage.set(prev => ({ ...prev, provider })),
  // setModel/setBaseUrl always target the CURRENTLY active provider.
  setModel: model => storage.set(prev => ({ ...prev, models: { ...prev.models, [prev.provider]: model } })),
  setProviderModel: (provider, model) =>
    storage.set(prev => ({ ...prev, provider, models: { ...prev.models, [provider]: model } })),
  setBaseUrl: baseUrl => storage.set(prev => ({ ...prev, baseUrls: { ...prev.baseUrls, [prev.provider]: baseUrl } })),
  setApiKey: (provider, apiKey) => storage.set(prev => ({ ...prev, apiKeys: { ...prev.apiKeys, [provider]: apiKey } })),
  getActiveApiKey: async () => {
    const state = await storage.get();
    return state.apiKeys[state.provider] ?? '';
  },
  setFastModel: next => storage.set(prev => ({ ...prev, fastModel: next })),
  recordRecentModel: (provider, model) =>
    storage.set(prev => {
      const entry: RecentModel = { provider, model };
      const deduped = (prev.recentModels ?? []).filter(r => !(r.provider === provider && r.model === model));
      return { ...prev, recentModels: [entry, ...deduped].slice(0, 5) };
    }),
};
