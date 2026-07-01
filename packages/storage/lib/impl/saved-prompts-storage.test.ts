import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPrompt } from './saved-prompts-storage.js';

beforeEach(() => vi.resetModules());
const load = async () => (await import('./saved-prompts-storage.js')).savedPromptsStorage;

function prompt(over: Partial<SavedPrompt> = {}): SavedPrompt {
  return { id: 'p1', name: 'Test', prompt: 'do it', command: 'go', ...over } as SavedPrompt;
}

describe('savedPromptsStorage', () => {
  it('upsert adds then replaces by id', async () => {
    const s = await load();
    await s.upsert(prompt({ name: 'A' }));
    await s.upsert(prompt({ name: 'B' }));
    const state = await s.get();
    expect(state.prompts).toHaveLength(1);
    expect(state.prompts[0].name).toBe('B');
  });

  it('findByCommand matches case-insensitively and ignores empty input', async () => {
    const s = await load();
    await s.upsert(prompt({ id: 'p1', command: 'Deploy' }));
    expect((await s.findByCommand('deploy'))?.id).toBe('p1');
    expect((await s.findByCommand('  DEPLOY  '))?.id).toBe('p1');
    expect(await s.findByCommand('nope')).toBeUndefined();
    expect(await s.findByCommand('   ')).toBeUndefined();
  });

  it('recordUsage stamps lastUsedAt and increments invocations', async () => {
    const s = await load();
    await s.upsert(prompt({ id: 'p1' }));
    await s.recordUsage('p1');
    await s.recordUsage('p1');
    const found = await s.findByCommand('go');
    expect(found?.invocations).toBe(2);
    expect(typeof found?.lastUsedAt).toBe('number');
  });

  it('remove deletes by id', async () => {
    const s = await load();
    await s.upsert(prompt({ id: 'p1' }));
    await s.remove('p1');
    expect((await s.get()).prompts).toHaveLength(0);
  });
});
