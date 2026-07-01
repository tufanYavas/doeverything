import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-session runtime overrides granted by skill frontmatter:
 *   - `allowed-tools` accumulate (set union) and skip the permission prompt.
 *   - `model` is a one-shot pending override consumed by the next API turn,
 *     then the cached value stays for re-use without re-firing.
 * State is backed by `chrome.storage.session` via the module-cached
 * session-state helper, so each test resets modules (chrome.storage.session is
 * reset by the shared setup's beforeEach first).
 */
describe('skill runtime-overrides', () => {
  beforeEach(() => vi.resetModules());

  it('grants allowed tools and reports them via isSkillAllowedTool', async () => {
    const { applySkillOverrides, isSkillAllowedTool } = await import('./runtime-overrides.js');
    await applySkillOverrides('s1', { allowedTools: ['click', 'type'] });

    expect(await isSkillAllowedTool('s1', 'click')).toBe(true);
    expect(await isSkillAllowedTool('s1', 'type')).toBe(true);
    expect(await isSkillAllowedTool('s1', 'navigate')).toBe(false);
  });

  it('isSkillAllowedTool is false for an unknown session', async () => {
    const { isSkillAllowedTool } = await import('./runtime-overrides.js');
    expect(await isSkillAllowedTool('nope', 'click')).toBe(false);
  });

  it('accumulates allowed tools across invocations as a set union (de-duped)', async () => {
    const { applySkillOverrides, getSkillOverridesSnapshot } = await import('./runtime-overrides.js');
    await applySkillOverrides('s1', { allowedTools: ['a', 'b'] });
    await applySkillOverrides('s1', { allowedTools: ['b', 'c'] });

    const snap = await getSkillOverridesSnapshot('s1');
    expect([...snap.allowedTools].sort()).toEqual(['a', 'b', 'c']);
  });

  it('an empty or absent allowedTools array does not touch the existing list', async () => {
    const { applySkillOverrides, getSkillOverridesSnapshot } = await import('./runtime-overrides.js');
    await applySkillOverrides('s1', { allowedTools: ['a'] });
    await applySkillOverrides('s1', { allowedTools: [] });
    await applySkillOverrides('s1', { model: 'm1' });

    const snap = await getSkillOverridesSnapshot('s1');
    expect(snap.allowedTools).toEqual(['a']);
  });

  it('consumePendingModelOverride returns the model once, then the cached value persists but is no longer pending', async () => {
    const { applySkillOverrides, consumePendingModelOverride, getSkillOverridesSnapshot } = await import(
      './runtime-overrides.js'
    );
    await applySkillOverrides('s1', { model: 'gpt-fast' });

    // First consume fires the pending override.
    expect(await consumePendingModelOverride('s1')).toBe('gpt-fast');
    // Second consume: pending flag cleared → returns null even though cached.
    expect(await consumePendingModelOverride('s1')).toBeNull();
    // The cached model still surfaces in the snapshot for re-use.
    expect((await getSkillOverridesSnapshot('s1')).modelOverride).toBe('gpt-fast');
  });

  it('consumePendingModelOverride returns null for an unknown session', async () => {
    const { consumePendingModelOverride } = await import('./runtime-overrides.js');
    expect(await consumePendingModelOverride('ghost')).toBeNull();
  });

  it('re-applying a model re-arms the pending flag and replaces the value', async () => {
    const { applySkillOverrides, consumePendingModelOverride } = await import('./runtime-overrides.js');
    await applySkillOverrides('s1', { model: 'm1' });
    expect(await consumePendingModelOverride('s1')).toBe('m1');

    await applySkillOverrides('s1', { model: 'm2' });
    // Pending re-armed with the new model.
    expect(await consumePendingModelOverride('s1')).toBe('m2');
  });

  it('a null/absent model leaves the existing override and pending flag untouched', async () => {
    const { applySkillOverrides, consumePendingModelOverride, getSkillOverridesSnapshot } = await import(
      './runtime-overrides.js'
    );
    await applySkillOverrides('s1', { model: 'm1' });
    // model: null is falsy → ignored, does not clear or re-arm.
    await applySkillOverrides('s1', { model: null });
    await applySkillOverrides('s1', {});

    expect((await getSkillOverridesSnapshot('s1')).modelOverride).toBe('m1');
    // Still pending from the original m1 grant.
    expect(await consumePendingModelOverride('s1')).toBe('m1');
  });

  it('getSkillOverridesSnapshot returns blanks for an unknown session', async () => {
    const { getSkillOverridesSnapshot } = await import('./runtime-overrides.js');
    expect(await getSkillOverridesSnapshot('nope')).toEqual({ allowedTools: [], modelOverride: null });
  });

  it('getSkillOverridesSnapshot returns a copy of allowedTools (mutation does not leak back)', async () => {
    const { applySkillOverrides, getSkillOverridesSnapshot } = await import('./runtime-overrides.js');
    await applySkillOverrides('s1', { allowedTools: ['a'] });
    const snap = await getSkillOverridesSnapshot('s1');
    snap.allowedTools.push('mutated');

    const fresh = await getSkillOverridesSnapshot('s1');
    expect(fresh.allowedTools).toEqual(['a']);
  });

  it('clearOverridesForSession drops only that session', async () => {
    const { applySkillOverrides, clearOverridesForSession, getSkillOverridesSnapshot } = await import(
      './runtime-overrides.js'
    );
    await applySkillOverrides('s1', { allowedTools: ['a'], model: 'm1' });
    await applySkillOverrides('s2', { allowedTools: ['b'] });
    await clearOverridesForSession('s1');

    expect(await getSkillOverridesSnapshot('s1')).toEqual({ allowedTools: [], modelOverride: null });
    expect((await getSkillOverridesSnapshot('s2')).allowedTools).toEqual(['b']);
  });

  it('clearOverridesForSession on an unknown session is a no-op', async () => {
    const { applySkillOverrides, clearOverridesForSession, getSkillOverridesSnapshot } = await import(
      './runtime-overrides.js'
    );
    await applySkillOverrides('s1', { allowedTools: ['a'] });
    await clearOverridesForSession('ghost');
    expect((await getSkillOverridesSnapshot('s1')).allowedTools).toEqual(['a']);
  });

  it('resetAllSkillOverrides wipes every session', async () => {
    const { applySkillOverrides, resetAllSkillOverrides, getSkillOverridesSnapshot } = await import(
      './runtime-overrides.js'
    );
    await applySkillOverrides('s1', { allowedTools: ['a'] });
    await applySkillOverrides('s2', { model: 'm' });
    await resetAllSkillOverrides();

    expect((await getSkillOverridesSnapshot('s1')).allowedTools).toEqual([]);
    expect((await getSkillOverridesSnapshot('s2')).modelOverride).toBeNull();
  });
});
