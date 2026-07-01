import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
const load = async () => import('./llm-config-storage.js');
/** Let the createStorage live-update echo settle between writes (a real
 * session spaces writes by user interaction; this mirrors that). */
const settle = () => new Promise(r => setTimeout(r, 0));

describe('llmConfigStorage — per-provider scoping', () => {
  it('keeps each provider model under its own key when switching back and forth', async () => {
    const { llmConfigStorage, activeModel } = await load();
    await llmConfigStorage.setProviderModel('anthropic', 'claude-opus-4-7');
    await settle();
    await llmConfigStorage.setProviderModel('openai', 'gpt-4o');
    await settle();
    let cfg = await llmConfigStorage.get();
    expect(activeModel(cfg)).toBe('gpt-4o');
    expect(cfg.models['anthropic']).toBe('claude-opus-4-7'); // not clobbered by the openai write

    await llmConfigStorage.setProvider('anthropic');
    await settle();
    cfg = await llmConfigStorage.get();
    expect(activeModel(cfg)).toBe('claude-opus-4-7');
  });

  it('setProviderModel switches provider AND sets its model atomically (no cross-leak)', async () => {
    const { llmConfigStorage, activeModel } = await load();
    await llmConfigStorage.setProviderModel('google', 'gemini-2.5-pro');
    const cfg = await llmConfigStorage.get();
    expect(cfg.provider).toBe('google');
    expect(activeModel(cfg)).toBe('gemini-2.5-pro');
    expect(cfg.models['google']).toBe('gemini-2.5-pro');
  });

  it('activeBaseUrl is per-provider', async () => {
    const { llmConfigStorage, activeBaseUrl } = await load();
    await llmConfigStorage.setProvider('openai-compatible');
    await llmConfigStorage.setBaseUrl('https://my-endpoint/v1');
    const cfg = await llmConfigStorage.get();
    expect(activeBaseUrl(cfg)).toBe('https://my-endpoint/v1');
  });

  it('API keys round-trip through at-rest encryption and are keyed per provider', async () => {
    const { llmConfigStorage } = await load();
    await llmConfigStorage.setApiKey('anthropic', 'sk-ant-xyz');
    await llmConfigStorage.setApiKey('openai', 'sk-oai-abc');
    const cfg = await llmConfigStorage.get();
    // Decrypted back to plaintext on read.
    expect(cfg.apiKeys['anthropic']).toBe('sk-ant-xyz');
    expect(cfg.apiKeys['openai']).toBe('sk-oai-abc');
    await llmConfigStorage.setProvider('anthropic');
    expect(await llmConfigStorage.getActiveApiKey()).toBe('sk-ant-xyz');
  });

  it('setFastModel stores and clears the fast tier', async () => {
    const { llmConfigStorage } = await load();
    await llmConfigStorage.setFastModel({ provider: 'google', model: 'gemini-2.5-flash' });
    expect((await llmConfigStorage.get()).fastModel).toEqual({ provider: 'google', model: 'gemini-2.5-flash' });
    await llmConfigStorage.setFastModel(null);
    expect((await llmConfigStorage.get()).fastModel).toBeNull();
  });
});
