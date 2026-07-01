/**
 * Per-turn skill catalogue formatter.
 *
 * Produces the body of the `<system-reminder>` the agent reads at the
 * top of each turn — one bullet per skill:
 *
 *   - <name>: <description> [- <whenToUse>]
 *
 * Per-entry hard cap is `MAX_LISTING_DESC_CHARS` (250). When the full
 * listing exceeds the char budget the rest are truncated to the largest
 * equal share that still fits `MIN_DESC_LENGTH`. If even that cannot be
 * met, the listing falls back to name-only entries.
 *
 * Char budget: when the runner knows the model's context window in
 * tokens, the budget is 1% of that × 4 chars/token. Otherwise it
 * defaults to `DEFAULT_CHAR_BUDGET` (8 KB).
 */

import type { Skill } from '@doeverything/storage';

export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01;
export const CHARS_PER_TOKEN = 4;
export const DEFAULT_CHAR_BUDGET = 8_000;
export const MAX_LISTING_DESC_CHARS = 250;
export const MIN_DESC_LENGTH = 20;

export function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens && Number.isFinite(contextWindowTokens)) {
    return Math.floor(contextWindowTokens * CHARS_PER_TOKEN * SKILL_BUDGET_CONTEXT_PERCENT);
  }
  return DEFAULT_CHAR_BUDGET;
}

function getDescription(s: Skill): string {
  const desc = s.whenToUse ? `${s.description} - ${s.whenToUse}` : s.description;
  return desc.length > MAX_LISTING_DESC_CHARS ? desc.slice(0, MAX_LISTING_DESC_CHARS - 1) + '…' : desc;
}

function fullEntry(s: Skill): string {
  return `- ${s.name}: ${getDescription(s)}`;
}

export function formatSkillsWithinBudget(skills: Skill[], contextWindowTokens?: number): string {
  if (skills.length === 0) return '';
  const budget = getCharBudget(contextWindowTokens);
  const entries = skills.map(s => ({ s, full: fullEntry(s) }));
  const totalFull = entries.reduce((sum, e) => sum + e.full.length, 0) + (entries.length - 1);
  if (totalFull <= budget) return entries.map(e => e.full).join('\n');

  const nameOverhead = skills.reduce((sum, s) => sum + s.name.length + 4, 0) + (skills.length - 1);
  const availableForDescs = budget - nameOverhead;
  const maxDescLen = Math.floor(availableForDescs / skills.length);
  if (maxDescLen < MIN_DESC_LENGTH) {
    return skills.map(s => `- ${s.name}`).join('\n');
  }
  return skills
    .map(s => {
      const desc = getDescription(s);
      const truncated = desc.length > maxDescLen ? desc.slice(0, maxDescLen - 1) + '…' : desc;
      return `- ${s.name}: ${truncated}`;
    })
    .join('\n');
}

export function buildSkillListingMessage(content: string): string {
  return (
    '<system-reminder>\n' +
    'The following doeverything skills are available — invoke them with the `skill` tool:\n\n' +
    content +
    '\n</system-reminder>'
  );
}
