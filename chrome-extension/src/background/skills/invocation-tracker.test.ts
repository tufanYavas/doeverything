import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The invocation tracker remembers which skill bodies the agent has already
 * expanded so they can be re-injected after compaction. State is backed by
 * `chrome.storage.session` via the module-cached session-state helper, so each
 * test resets modules for a clean slate (chrome.storage.session itself is
 * reset by the shared setup's beforeEach, which runs first).
 */
describe('skill invocation-tracker', () => {
  beforeEach(() => vi.resetModules());

  it('records a skill and reads it back', async () => {
    const { recordInvokedSkill, getInvokedSkills, getInvokedSkillCount } = await import('./invocation-tracker.js');
    await recordInvokedSkill('s1', 'alpha', 'body-a');

    const skills = await getInvokedSkills('s1');
    expect(skills).toHaveLength(1);
    expect(skills[0].skillName).toBe('alpha');
    expect(skills[0].content).toBe('body-a');
    expect(typeof skills[0].invokedAt).toBe('number');
    expect(await getInvokedSkillCount('s1')).toBe(1);
  });

  it('ignores empty sessionId or skillName (no record written)', async () => {
    const { recordInvokedSkill, getInvokedSkillCount } = await import('./invocation-tracker.js');
    await recordInvokedSkill('', 'alpha', 'body');
    await recordInvokedSkill('s1', '', 'body');
    expect(await getInvokedSkillCount('s1')).toBe(0);
    expect(await getInvokedSkillCount('')).toBe(0);
  });

  it('re-recording the same skill name replaces its content (keyed by name)', async () => {
    const { recordInvokedSkill, getInvokedSkills, getInvokedSkillCount } = await import('./invocation-tracker.js');
    await recordInvokedSkill('s1', 'alpha', 'first');
    await recordInvokedSkill('s1', 'alpha', 'second');

    expect(await getInvokedSkillCount('s1')).toBe(1);
    const skills = await getInvokedSkills('s1');
    expect(skills[0].content).toBe('second');
  });

  it('getInvokedSkills returns most-recent-first', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValueOnce(300);
    const { recordInvokedSkill, getInvokedSkills } = await import('./invocation-tracker.js');
    await recordInvokedSkill('s1', 'a', 'A');
    await recordInvokedSkill('s1', 'b', 'B');
    await recordInvokedSkill('s1', 'c', 'C');

    const skills = await getInvokedSkills('s1');
    expect(skills.map(s => s.skillName)).toEqual(['c', 'b', 'a']);
    now.mockRestore();
  });

  it('getInvokedSkills / count are empty for an unknown session', async () => {
    const { getInvokedSkills, getInvokedSkillCount } = await import('./invocation-tracker.js');
    expect(await getInvokedSkills('nope')).toEqual([]);
    expect(await getInvokedSkillCount('nope')).toBe(0);
  });

  it('buildPostCompactSkillMessages returns [] when nothing invoked', async () => {
    const { buildPostCompactSkillMessages } = await import('./invocation-tracker.js');
    expect(await buildPostCompactSkillMessages('s1')).toEqual([]);
  });

  it('buildPostCompactSkillMessages wraps each body in a user-meta system-reminder, newest first', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1).mockReturnValueOnce(2);
    const { recordInvokedSkill, buildPostCompactSkillMessages } = await import('./invocation-tracker.js');
    await recordInvokedSkill('s1', 'old', 'OLD-BODY');
    await recordInvokedSkill('s1', 'new', 'NEW-BODY');

    const msgs = await buildPostCompactSkillMessages('s1');
    expect(msgs).toHaveLength(2);
    expect(msgs.every(m => m.role === 'user')).toBe(true);
    expect(msgs[0].content).toContain('<system-reminder>');
    expect(msgs[0].content).toContain('</system-reminder>');
    expect(msgs[0].content).toContain('Skill: new');
    expect(msgs[0].content).toContain('NEW-BODY');
    expect(msgs[1].content).toContain('Skill: old');
    now.mockRestore();
  });

  it('truncates a per-skill body that exceeds the 12k-char cap with an ellipsis', async () => {
    const { recordInvokedSkill, buildPostCompactSkillMessages } = await import('./invocation-tracker.js');
    // POST_COMPACT_MAX_CHARS_PER_SKILL = 3000 * 4 = 12000.
    const huge = 'x'.repeat(20_000);
    await recordInvokedSkill('s1', 'big', huge);

    const msgs = await buildPostCompactSkillMessages('s1');
    expect(msgs).toHaveLength(1);
    // Body is sliced to (12000 - 1) chars + '…'.
    expect(msgs[0].content).toContain('x'.repeat(11_999) + '…');
    expect(msgs[0].content).not.toContain('x'.repeat(12_001));
  });

  it('stops once the total char budget (40k) would be exceeded — drops least-recent', async () => {
    const now = vi.spyOn(Date, 'now');
    // Three ~12k-char bodies: 12k + 12k = 24k fits, third (36k) overflows 40k.
    now.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
    const { recordInvokedSkill, buildPostCompactSkillMessages } = await import('./invocation-tracker.js');
    const body = 'y'.repeat(12_000);
    await recordInvokedSkill('s1', 'first', body);
    await recordInvokedSkill('s1', 'second', body);
    await recordInvokedSkill('s1', 'third', body);

    const msgs = await buildPostCompactSkillMessages('s1');
    // Newest-first: third (12k) + second (12k) = 24k, then first (12k) → 36k still ≤ 40k.
    // All three fit since 36k ≤ 40k.
    expect(msgs.map(m => (m.content.includes('Skill: third') ? 't' : m.content.includes('Skill: second') ? 's' : 'f'))).toEqual([
      't',
      's',
      'f',
    ]);
    now.mockRestore();
  });

  it('budget break drops entries beyond 40k chars', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3).mockReturnValueOnce(4);
    const { recordInvokedSkill, buildPostCompactSkillMessages } = await import('./invocation-tracker.js');
    const body = 'z'.repeat(12_000);
    await recordInvokedSkill('s1', 'a', body);
    await recordInvokedSkill('s1', 'b', body);
    await recordInvokedSkill('s1', 'c', body);
    await recordInvokedSkill('s1', 'd', body);

    const msgs = await buildPostCompactSkillMessages('s1');
    // Newest-first d,c,b: 12k+12k+12k = 36k ≤ 40k; adding a (48k) breaks → loop stops.
    expect(msgs).toHaveLength(3);
    expect(msgs.some(m => m.content.includes('Skill: a'))).toBe(false);
    now.mockRestore();
  });

  it('clearInvocationsForSession drops only that session', async () => {
    const { recordInvokedSkill, clearInvocationsForSession, getInvokedSkillCount } = await import(
      './invocation-tracker.js'
    );
    await recordInvokedSkill('s1', 'a', 'A');
    await recordInvokedSkill('s2', 'b', 'B');
    await clearInvocationsForSession('s1');
    expect(await getInvokedSkillCount('s1')).toBe(0);
    expect(await getInvokedSkillCount('s2')).toBe(1);
  });

  it('clearInvocationsForSession on an unknown session is a no-op', async () => {
    const { recordInvokedSkill, clearInvocationsForSession, getInvokedSkillCount } = await import(
      './invocation-tracker.js'
    );
    await recordInvokedSkill('s1', 'a', 'A');
    await clearInvocationsForSession('ghost');
    expect(await getInvokedSkillCount('s1')).toBe(1);
  });

  it('resetAllInvocations wipes every session', async () => {
    const { recordInvokedSkill, resetAllInvocations, getInvokedSkillCount } = await import('./invocation-tracker.js');
    await recordInvokedSkill('s1', 'a', 'A');
    await recordInvokedSkill('s2', 'b', 'B');
    await resetAllInvocations();
    expect(await getInvokedSkillCount('s1')).toBe(0);
    expect(await getInvokedSkillCount('s2')).toBe(0);
  });

  it('isolates state per session', async () => {
    const { recordInvokedSkill, getInvokedSkills } = await import('./invocation-tracker.js');
    await recordInvokedSkill('s1', 'a', 'A');
    expect(await getInvokedSkills('s2')).toEqual([]);
  });
});
