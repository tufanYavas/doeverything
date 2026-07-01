import { createStorage, StorageEnum } from '../base/index.js';
import { decryptSecret, encryptSecret } from '../util/secret-crypto.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * Custom LLM providers — runtime-configurable entries that don't require
 * a code change to add. Most modern providers expose an OpenAI-compatible
 * Chat Completions endpoint, so this single "kind" covers vLLM, Ollama,
 * LM Studio, Fireworks, DeepInfra, Perplexity, Together, Groq, your own
 * proxy, and anything similar. Add another kind here when a provider needs
 * a fundamentally different SDK (e.g. an Anthropic-style proxy that doesn't
 * speak OpenAI).
 *
 * Each entry shows up in the LlmTab provider picker as a first-class
 * choice, with its own model field and key, alongside the built-ins.
 */

export type CustomProviderKind = 'openai-compat';

export interface CustomProvider {
  /** Stable slug, used as `custom:<id>` in LlmConfigState.provider. */
  id: string;
  /** Display name shown in the picker. */
  label: string;
  kind: CustomProviderKind;
  /** API base URL (no trailing slash). e.g. `https://api.fireworks.ai/inference/v1`. */
  baseUrl: string;
  /** Bearer token. Empty allowed for endpoints that don't require auth. */
  apiKey: string;
  /** Default model id used when the user leaves the model field blank. */
  defaultModel: string;
}

export interface CustomProvidersState {
  providers: CustomProvider[];
}

const DEFAULT_STATE: CustomProvidersState = { providers: [] };
const STORAGE_KEY = 'doe:custom-providers';
/** Used in `LlmConfigState.provider` to disambiguate from built-ins. */
export const CUSTOM_PROVIDER_PREFIX = 'custom:';

const storage = createStorage<CustomProvidersState>(STORAGE_KEY, DEFAULT_STATE, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
  serialization: {
    serialize: async state => ({
      providers: await Promise.all(
        (state.providers ?? []).map(async p => ({ ...p, apiKey: await encryptSecret(p.apiKey ?? '') })),
      ),
    }),
    deserialize: async raw => {
      if (!raw || typeof raw !== 'object') return raw as CustomProvidersState;
      const r = raw as CustomProvidersState;
      return {
        providers: await Promise.all(
          (r.providers ?? []).map(async p => ({ ...p, apiKey: await decryptSecret(p.apiKey ?? '') })),
        ),
      };
    },
  },
});

export interface CustomProvidersStorageType extends BaseStorageType<CustomProvidersState> {
  upsert: (provider: CustomProvider) => Promise<void>;
  remove: (id: string) => Promise<void>;
  byId: (id: string) => Promise<CustomProvider | undefined>;
}

const slugify = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const customProvidersStorage: CustomProvidersStorageType = {
  ...storage,
  upsert: async provider => {
    const cleanId = slugify(provider.id || provider.label);
    if (!cleanId) throw new Error('Custom provider needs a non-empty id or label');
    const cleaned: CustomProvider = { ...provider, id: cleanId };
    await storage.set(prev => {
      const others = prev.providers.filter(p => p.id !== cleaned.id);
      return { providers: [...others, cleaned] };
    });
  },
  remove: async id => {
    await storage.set(prev => ({ providers: prev.providers.filter(p => p.id !== id) }));
  },
  byId: async id => {
    const state = await storage.get();
    return state.providers.find(p => p.id === id);
  },
};

export const isCustomProviderId = (value: string): boolean => value.startsWith(CUSTOM_PROVIDER_PREFIX);
export const customIdFromProvider = (value: string): string =>
  value.startsWith(CUSTOM_PROVIDER_PREFIX) ? value.slice(CUSTOM_PROVIDER_PREFIX.length) : value;
export const providerKeyFromCustomId = (id: string): string => `${CUSTOM_PROVIDER_PREFIX}${id}`;
