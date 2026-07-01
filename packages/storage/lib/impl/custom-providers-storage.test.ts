import {
  customIdFromProvider,
  CUSTOM_PROVIDER_PREFIX,
  isCustomProviderId,
  providerKeyFromCustomId,
} from './custom-providers-storage.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomProvider } from './custom-providers-storage.js';

describe('custom provider id helpers (pure)', () => {
  it('round-trips slug ↔ provider key', () => {
    const key = providerKeyFromCustomId('fireworks');
    expect(key).toBe(`${CUSTOM_PROVIDER_PREFIX}fireworks`);
    expect(isCustomProviderId(key)).toBe(true);
    expect(customIdFromProvider(key)).toBe('fireworks');
  });

  it('isCustomProviderId is false for built-in ids', () => {
    expect(isCustomProviderId('anthropic')).toBe(false);
    expect(customIdFromProvider('anthropic')).toBe('anthropic');
  });
});

describe('customProvidersStorage', () => {
  beforeEach(() => vi.resetModules());
  const load = async () => (await import('./custom-providers-storage.js')).customProvidersStorage;

  function provider(over: Partial<CustomProvider> = {}): CustomProvider {
    return { id: 'fireworks', label: 'Fireworks', kind: 'openai-compat', baseUrl: 'https://api/v1', apiKey: 'sk-fw', defaultModel: 'm', ...over };
  }

  it('upsert slugifies the id and byId fetches it back (apiKey decrypted)', async () => {
    const s = await load();
    await s.upsert(provider({ id: 'My Fireworks!!', apiKey: 'sk-secret' }));
    const got = await s.byId('my-fireworks');
    expect(got?.id).toBe('my-fireworks');
    expect(got?.apiKey).toBe('sk-secret'); // encrypted at rest, decrypted on read
  });

  it('upsert replaces an existing provider with the same slug', async () => {
    const s = await load();
    await s.upsert(provider({ id: 'fw', label: 'One' }));
    await s.upsert(provider({ id: 'fw', label: 'Two' }));
    expect((await s.get()).providers).toHaveLength(1);
    expect((await s.byId('fw'))?.label).toBe('Two');
  });

  it('throws when neither id nor label yields a usable slug', async () => {
    const s = await load();
    await expect(s.upsert(provider({ id: '', label: '' }))).rejects.toThrow();
  });

  it('remove deletes by id', async () => {
    const s = await load();
    await s.upsert(provider({ id: 'fw' }));
    await s.remove('fw');
    expect(await s.byId('fw')).toBeUndefined();
  });
});
