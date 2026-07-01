import { resolveContextWindow } from './context-window.js';
import { describe, expect, it } from 'vitest';

const DISCOVERED_KEY = 'doe:discovered-models';

/** Seed the discovered-models store directly in the fake chrome.storage.local. */
async function seedDiscovered(provider: string, contextWindows: Record<string, number>) {
  await chrome.storage.local.set({
    [DISCOVERED_KEY]: { byProvider: { [provider]: { models: Object.keys(contextWindows), fetchedAt: 1, contextWindows } } },
  });
}

describe('resolveContextWindow', () => {
  it('prefers exact discovery metadata over the static table (still cost-capped)', async () => {
    await seedDiscovered('google', { 'gemini-2.5-pro': 1_048_576 });
    // discovery says ~1M, but the cost cap clamps the effective budget to 200K.
    expect(await resolveContextWindow('google', 'gemini-2.5-pro')).toBe(200_000);
  });

  it('uses discovery value directly when below the cap', async () => {
    await seedDiscovered('openrouter', { 'some/model': 32_000 });
    expect(await resolveContextWindow('openrouter', 'some/model')).toBe(32_000);
  });

  it('falls back to the static table when discovery has nothing', async () => {
    expect(await resolveContextWindow('anthropic', 'claude-opus-4-7')).toBe(200_000);
    expect(await resolveContextWindow('cerebras', 'llama3.1-70b')).toBe(8_192);
  });

  it('caps a static 1M model (gpt-4.1) at the cost cap', async () => {
    expect(await resolveContextWindow('openai', 'gpt-4.1')).toBe(200_000);
  });

  it('returns the 120K fallback for a totally unknown model id', async () => {
    expect(await resolveContextWindow('openai-compatible', 'mystery-local-model')).toBe(120_000);
  });

  it('ignores non-positive discovery values and uses the static table', async () => {
    await seedDiscovered('anthropic', { 'claude-opus-4-7': 0 });
    expect(await resolveContextWindow('anthropic', 'claude-opus-4-7')).toBe(200_000);
  });
});
