/**
 * Filters the set of saved skills down to "invocable by the model right now":
 *   - `disableModelInvocation: true` removed
 *   - missing both `description` and `whenToUse` removed (model has nothing to match on)
 *   - skills with `domains` not matching `currentUrl` removed
 *
 * Used by both the runner (to inject the per-turn `<system-reminder>` listing)
 * and the `skill` tool's lookup at execute() time.
 */

import { urlMatchesAny } from '@doeverything/shared';
import { skillsStorage } from '@doeverything/storage';
import type { Skill } from '@doeverything/storage';

export function isSkillActiveForUrl(skill: Skill, currentUrl?: string): boolean {
  if (!skill.domains || skill.domains.length === 0) return true;
  return urlMatchesAny(currentUrl, skill.domains);
}

export async function getModelInvocableSkills(currentUrl?: string): Promise<Skill[]> {
  const all = await skillsStorage.getAll();
  return all.filter(
    s => !s.disableModelInvocation && (s.description || s.whenToUse) && isSkillActiveForUrl(s, currentUrl),
  );
}
