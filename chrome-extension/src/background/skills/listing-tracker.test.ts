import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@doeverything/storage';

/**
 * The listing tracker owns the cross-turn "which skills has the model been
 * told about?" delta. The runner passes it the URL-filtered skill set each
 * turn (`getModelInvocableSkills(activeUrl)`), so a skill that only becomes
 * applicable after the agent navigates to its domain surfaces on the next
 * turn as a fresh emission. Session state is module-cached, so each test
 * resets modules for a clean slate (chrome.storage.session is reset by the
 * shared setup's own beforeEach, which runs first).
 */
function skill(name: string): Skill {
  return { id: name, name, description: 'd', body: '', domains: [], source: 'user', createdAt: 0, updatedAt: 0 };
}

describe('skill listing-tracker', () => {
  beforeEach(() => vi.resetModules());

  it('emits the full set on turn 0, then nothing while unchanged', async () => {
    const { consumeSkillListing } = await import('./listing-tracker.js');
    const first = await consumeSkillListing('c1', [skill('a'), skill('b')]);
    expect(first.isInitial).toBe(true);
    expect(first.newSkills.map(s => s.name)).toEqual(['a', 'b']);

    const second = await consumeSkillListing('c1', [skill('a'), skill('b')]);
    expect(second.isInitial).toBe(false);
    expect(second.newSkills).toEqual([]);
  });

  it('surfaces a newly-applicable skill on a later turn (the x.com-navigation case)', async () => {
    const { consumeSkillListing } = await import('./listing-tracker.js');
    // Turn 1, on page A: only the unscoped skill applies.
    await consumeSkillListing('c1', [skill('global')]);
    // Turn 2, after navigating to x.com: the x.com-scoped skill now applies.
    const delta = await consumeSkillListing('c1', [skill('global'), skill('xcom')]);
    expect(delta.isInitial).toBe(false);
    expect(delta.newSkills.map(s => s.name)).toEqual(['xcom']);
  });

  it('peekSentSkillNames reflects announced skills without consuming them', async () => {
    const { consumeSkillListing, peekSentSkillNames } = await import('./listing-tracker.js');
    await consumeSkillListing('c1', [skill('a')]);
    expect([...(await peekSentSkillNames('c1'))]).toEqual(['a']);
    // peek must not mutate â€” a is still "sent", so nothing new emits.
    const again = await consumeSkillListing('c1', [skill('a')]);
    expect(again.newSkills).toEqual([]);
    expect([...(await peekSentSkillNames('c1'))]).toEqual(['a']);
  });

  it('isolates state per conversation', async () => {
    const { consumeSkillListing, peekSentSkillNames } = await import('./listing-tracker.js');
    await consumeSkillListing('c1', [skill('a')]);
    expect([...(await peekSentSkillNames('c2'))]).toEqual([]);
    const c2 = await consumeSkillListing('c2', [skill('a')]);
    expect(c2.isInitial).toBe(true);
  });

  it('suppressNext swallows the next emission but still records the names', async () => {
    const { consumeSkillListing, suppressNextSkillListing, peekSentSkillNames } = await import('./listing-tracker.js');
    await suppressNextSkillListing('c1');
    const delta = await consumeSkillListing('c1', [skill('a'), skill('b')]);
    expect(delta.newSkills).toEqual([]);
    expect([...(await peekSentSkillNames('c1'))].sort()).toEqual(['a', 'b']);
  });

  it('clearListingForSession resets a conversation', async () => {
    const { consumeSkillListing, clearListingForSession, peekSentSkillNames } = await import('./listing-tracker.js');
    await consumeSkillListing('c1', [skill('a')]);
    await clearListingForSession('c1');
    expect([...(await peekSentSkillNames('c1'))]).toEqual([]);
  });
});
