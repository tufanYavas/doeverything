import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@doeverything/storage';
import type { ModelMessage } from 'ai';

/**
 * SkillListingRefresher bridges the gap the per-turn listing can't cover:
 * when the agent NAVIGATES mid-turn to a page with its own scoped skills,
 * those skills surface immediately (re-injected every step) instead of
 * waiting for the next user message. It must NOT re-announce skills already
 * in the durable base (turn-start listing) and must drop a skill again once
 * the agent leaves the page it applies to.
 */
const SKILL_DELTA_MARKER = '<!-- de:skill-delta -->';

function skill(over: Partial<Skill>): Skill {
  return { id: over.name ?? 's', name: 'n', description: 'd', body: '', domains: [], ...over } as Skill;
}

const userMsg = (text: string): ModelMessage => ({ role: 'user', content: text });

function skillDelta(messages: ModelMessage[]): string | null {
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SKILL_DELTA_MARKER)) {
      return m.content;
    }
  }
  return null;
}

describe('SkillListingRefresher (mid-turn skill injection)', () => {
  beforeEach(() => vi.resetModules());

  /** Seed skills + simulate the turn-start listing having already emitted
   *  `sentAtTurnStart`, then return a fresh refresher class. */
  async function setup(skills: Array<Partial<Skill>>, sentAtTurnStart: string[] = []) {
    const { skillsStorage } = await import('@doeverything/storage');
    for (const s of skills) await skillsStorage.create(skill(s));
    if (sentAtTurnStart.length > 0) {
      const { consumeSkillListing } = await import('../skills/listing-tracker.js');
      await consumeSkillListing('c1', sentAtTurnStart.map(name => skill({ name })));
    }
    const { SkillListingRefresher } = await import('./skill-refresher.js');
    return SkillListingRefresher;
  }

  it('injects nothing while the active URL is unchanged from turn start', async () => {
    const SkillListingRefresher = await setup(
      [
        { name: 'global', description: 'g' },
        { name: 'xcom', description: 'x', domains: ['x.com'] },
      ],
      ['global'],
    );
    const url = 'https://a.com';
    const r = new SkillListingRefresher('c1', 200_000, async () => url);
    r.prime(url);
    expect(skillDelta(await r.refresh([userMsg('do it')]))).toBeNull();
  });

  it('surfaces a destination-scoped skill once the agent navigates there', async () => {
    const SkillListingRefresher = await setup(
      [
        { name: 'global', description: 'g' },
        { name: 'xcom', description: 'x', domains: ['x.com'] },
      ],
      ['global'],
    );
    let url: string | undefined = 'https://a.com';
    const r = new SkillListingRefresher('c1', 200_000, async () => url);
    r.prime(url);
    await r.refresh([userMsg('do it')]); // no-op at a.com
    url = 'https://x.com/home';
    const delta = skillDelta(await r.refresh([userMsg('do it')]));
    expect(delta).toContain('xcom');
    // `global` was announced at turn start → not repeated mid-turn.
    expect(delta).not.toContain('global');
  });

  it('drops the destination skill again after navigating away', async () => {
    const SkillListingRefresher = await setup([{ name: 'xcom', description: 'x', domains: ['x.com'] }]);
    let url: string | undefined = 'https://a.com';
    const r = new SkillListingRefresher('c1', 200_000, async () => url);
    r.prime(url);
    url = 'https://x.com';
    expect(skillDelta(await r.refresh([userMsg('go')]))).toContain('xcom');
    url = 'https://a.com';
    expect(skillDelta(await r.refresh([userMsg('go')]))).toBeNull();
  });

  it('re-injects a stable block on an unchanged URL (survives the per-step rebuild)', async () => {
    const SkillListingRefresher = await setup([{ name: 'xcom', description: 'x', domains: ['x.com'] }]);
    let url: string | undefined = 'https://a.com';
    const r = new SkillListingRefresher('c1', 200_000, async () => url);
    r.prime(url);
    url = 'https://x.com';
    const first = skillDelta(await r.refresh([userMsg('go')]));
    const second = skillDelta(await r.refresh([userMsg('go')])); // URL unchanged
    expect(second).toBe(first);
    expect(second).toContain('xcom');
  });

  it('inserts the block immediately before the latest user message', async () => {
    const SkillListingRefresher = await setup([{ name: 'xcom', description: 'x', domains: ['x.com'] }]);
    let url: string | undefined = 'https://a.com';
    const r = new SkillListingRefresher('c1', 200_000, async () => url);
    r.prime(url);
    url = 'https://x.com';
    const out = await r.refresh([{ role: 'assistant', content: 'thinking' }, userMsg('go')]);
    const idx = out.findIndex(m => typeof m.content === 'string' && m.content.startsWith(SKILL_DELTA_MARKER));
    expect(idx).toBe(out.length - 2); // right before the trailing user message
    expect(out[out.length - 1].content).toBe('go');
  });
});
