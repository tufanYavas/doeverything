import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LlmProvidersModule from '@doeverything/llm-providers';
import type { LlmProviderConfig } from '@doeverything/llm-providers';

/**
 * Verify the fast-model fallback chain WITHOUT building real provider SDKs
 * or touching the at-rest key encryption:
 *
 *   - `@doeverything/llm-providers` is mocked so `createLanguageModel` just
 *     records the config it was handed (real registry/id-helpers kept).
 *   - The llm-config is SEEDED as plaintext directly into the fake
 *     chrome.storage.local. `decryptSecret` returns non-`enc:`-prefixed
 *     values verbatim, so no IndexedDB master key is needed.
 */
const LLM_CONFIG_KEY = 'doe:llm-config';
const calls: LlmProviderConfig[] = [];

vi.mock('@doeverything/llm-providers', async () => {
  const actual = await vi.importActual<typeof LlmProvidersModule>('@doeverything/llm-providers');
  return {
    ...actual,
    createLanguageModel: vi.fn(async (config: LlmProviderConfig) => {
      calls.push(config);
      return { __config: config };
    }),
  };
});

interface SeedConfig {
  provider?: string;
  models?: Record<string, string>;
  apiKeys?: Record<string, string>;
  fastModel?: { provider: string; model: string } | null;
}

async function withConfig(seed: SeedConfig) {
  await chrome.storage.local.set({
    [LLM_CONFIG_KEY]: {
      provider: seed.provider ?? 'anthropic',
      models: seed.models ?? {},
      apiKeys: seed.apiKeys ?? {},
      baseUrls: {},
      fastModel: seed.fastModel ?? null,
    },
  });
  const { resolveFastModel } = await import('./helpers.js');
  return resolveFastModel;
}

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

describe('resolveFastModel — no explicit fast model configured', () => {
  it("uses the active provider's registry default when its key is set", async () => {
    const resolveFastModel = await withConfig({ provider: 'anthropic', apiKeys: { anthropic: 'sk-test' } });
    await resolveFastModel();
    expect(calls.at(-1)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-test' });
  });

  it('falls back to the MAIN model (empty model id) when the active provider has no key', async () => {
    const resolveFastModel = await withConfig({ provider: 'anthropic' });
    await resolveFastModel();
    expect(calls.at(-1)).toMatchObject({ provider: 'anthropic', model: '' });
  });
});

describe('resolveFastModel — explicit fast model', () => {
  it('builds the chosen provider + model, sourcing that provider key', async () => {
    const resolveFastModel = await withConfig({
      provider: 'anthropic',
      apiKeys: { anthropic: 'sk-main', google: 'sk-google' },
      fastModel: { provider: 'google', model: 'gemini-2.5-flash' },
    });
    await resolveFastModel();
    expect(calls.at(-1)).toMatchObject({ provider: 'google', model: 'gemini-2.5-flash', apiKey: 'sk-google' });
  });

  it("fills an empty fast model id with that provider's registry default", async () => {
    const resolveFastModel = await withConfig({
      apiKeys: { google: 'sk-google' },
      fastModel: { provider: 'google', model: '' },
    });
    await resolveFastModel();
    expect(calls.at(-1)).toMatchObject({ provider: 'google', model: 'gemini-2.5-flash' });
  });

  it('falls back to the active provider default when the chosen fast provider has no key', async () => {
    const resolveFastModel = await withConfig({
      provider: 'anthropic',
      apiKeys: { anthropic: 'sk-main' },
      fastModel: { provider: 'google', model: 'gemini-2.5-flash' },
    });
    await resolveFastModel();
    expect(calls.at(-1)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });
});
