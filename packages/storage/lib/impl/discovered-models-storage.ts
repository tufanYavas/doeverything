import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * Per-provider cache of model ids fetched from each provider's `/models`
 * endpoint. Replaces the hardcoded `suggestedModels` lists that used to
 * live in `PROVIDER_REGISTRY`.
 *
 * The Options page (LlmTab) is the only writer — it calls `listModels()`
 * from `@doeverything/llm-providers` after the user enters an API key (or
 * clicks Refresh) and stores the result here. The side panel's
 * ModelSelector and the Options model dropdown are pure readers.
 *
 * Keyed by provider id — built-ins use their literal id, custom providers
 * use the `custom:<slug>` form so a single store covers both.
 */

export interface DiscoveredModelEntry {
  /** Model ids the provider returned, in the order it returned them. */
  models: string[];
  /** Unix epoch ms — shown in the UI as "Last refreshed N ago". */
  fetchedAt: number;
  /** Optional provider-preferred default; not all APIs surface one. */
  defaultModel?: string;
  /**
   * modelId → input context window (tokens), when the provider's /models
   * endpoint reports it (Google, OpenRouter, Together, some self-hosted
   * servers). Optional — older stored entries lack it; the agent falls
   * back to a static pattern table.
   */
  contextWindows?: Record<string, number>;
}

export interface DiscoveredModelsState {
  byProvider: Record<string, DiscoveredModelEntry>;
}

const STORAGE_KEY = 'doe:discovered-models';
const DEFAULT_STATE: DiscoveredModelsState = { byProvider: {} };

const storage = createStorage<DiscoveredModelsState>(STORAGE_KEY, DEFAULT_STATE, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export interface DiscoveredModelsStorageType extends BaseStorageType<DiscoveredModelsState> {
  setForProvider: (providerId: string, entry: Omit<DiscoveredModelEntry, 'fetchedAt'>) => Promise<void>;
  getForProvider: (providerId: string) => Promise<DiscoveredModelEntry | undefined>;
  removeForProvider: (providerId: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const discoveredModelsStorage: DiscoveredModelsStorageType = {
  ...storage,
  setForProvider: async (providerId, entry) => {
    await storage.set(prev => ({
      byProvider: { ...prev.byProvider, [providerId]: { ...entry, fetchedAt: Date.now() } },
    }));
  },
  getForProvider: async providerId => {
    const state = await storage.get();
    return state.byProvider[providerId];
  },
  removeForProvider: async providerId => {
    await storage.set(prev => {
      const next = { ...prev.byProvider };
      delete next[providerId];
      return { byProvider: next };
    });
  },
  clear: () => storage.set({ byProvider: {} }),
};
