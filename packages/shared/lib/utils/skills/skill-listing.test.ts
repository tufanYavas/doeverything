import {
  buildSkillListingMessage,
  CHARS_PER_TOKEN,
  DEFAULT_CHAR_BUDGET,
  formatSkillsWithinBudget,
  getCharBudget,
  SKILL_BUDGET_CONTEXT_PERCENT,
} from './skill-listing.js';
import { describe, expect, it } from 'vitest';
import type { Skill } from '@doeverything/storage';

function skill(name: string, description: string, whenToUse?: string): Skill {
  return { id: name, name, description, whenToUse, body: '' } as Skill;
}

describe('getCharBudget', () => {
  it('derives the budget from the context window when provided', () => {
    expect(getCharBudget(200_000)).toBe(Math.floor(200_000 * CHARS_PER_TOKEN * SKILL_BUDGET_CONTEXT_PERCENT));
  });
  it('uses the default budget without a window or with a non-finite one', () => {
    expect(getCharBudget()).toBe(DEFAULT_CHAR_BUDGET);
    expect(getCharBudget(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHAR_BUDGET);
  });
});

describe('formatSkillsWithinBudget', () => {
  it('returns empty string for no skills', () => {
    expect(formatSkillsWithinBudget([])).toBe('');
  });

  it('lists full entries when they fit the budget', () => {
    const out = formatSkillsWithinBudget([skill('alpha', 'does A'), skill('beta', 'does B')]);
    expect(out).toBe('- alpha: does A\n- beta: does B');
  });

  it('appends whenToUse to the description', () => {
    const out = formatSkillsWithinBudget([skill('a', 'desc', 'when X')]);
    expect(out).toContain('- a: desc - when X');
  });

  it('truncates descriptions when over budget but names still fit', () => {
    const long = 'x'.repeat(400);
    const out = formatSkillsWithinBudget([skill('a', long), skill('b', long)], 2_000); // ~80 char budget
    expect(out).toContain('â€¦');
    expect(out).toMatch(/- a: x+â€¦/);
  });

  it('falls back to names-only when even truncated descriptions cannot fit', () => {
    const many = Array.from({ length: 40 }, (_, i) => skill(`skill${i}`, 'y'.repeat(100)));
    const out = formatSkillsWithinBudget(many, 2_000);
    expect(out.split('\n').every(line => /^- skill\d+$/.test(line))).toBe(true);
  });
});

describe('buildSkillListingMessage', () => {
  it('wraps content in a system-reminder block', () => {
    const msg = buildSkillListingMessage('- a: b');
    expect(msg).toMatch(/^<system-reminder>/);
    expect(msg).toContain('- a: b');
    expect(msg).toMatch(/<\/system-reminder>$/);
  });
});
