/**
 * Loads bundled SKILL.md files into `chrome.storage.local["skills"]`
 * on first install. Currently ships:
 *
 *   - chrome-extension/skills/scrape.md    → name: "scrape"
 *   - chrome-extension/skills/download.md  → name: "download"
 *
 * Each markdown file is fetched via `chrome.runtime.getURL` (the
 * `skills/` directory is included in `web_accessible_resources` of
 * the manifest), parsed via `parseSkillMarkdown`, and inserted via
 * `skillsStorage.create`. Behaviour by case:
 *   - skill missing → seed it.
 *   - skill present, bundled `version` is greater than stored
 *     `version` → replace silently (so body fixes ship to existing
 *     installs without "Restore defaults" needing to be clicked).
 *   - skill present, same/older version → leave alone.
 *   - `force: true` → replace everything (Restore Defaults UI button).
 */

import { parseSkillMarkdown } from '@doeverything/shared';
import { skillsStorage } from '@doeverything/storage';
import type { SkillFrontmatter } from '@doeverything/shared';
import type { Skill } from '@doeverything/storage';

const BUILT_IN_PATHS = ['skills/scrape.md', 'skills/download.md'];

export async function seedBuiltInSkills({ force }: { force?: boolean } = {}): Promise<string[]> {
  const seeded: string[] = [];
  for (const path of BUILT_IN_PATHS) {
    try {
      const url = chrome.runtime.getURL(path);
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const { frontmatter, body } = parseSkillMarkdown(text);
      const name = String(frontmatter.name ?? path.split('/').pop()?.replace(/\.md$/, '') ?? 'untitled');
      const existing = await skillsStorage.getByName(name);
      // Auto-replace stale built-ins when the bundled `version` is higher
      // than what the user has stored, so body fixes ship to existing
      // installs without needing "Restore defaults". The `source` field
      // stays `'imported'` even after a user edit (the UI's update path
      // doesn't touch it), so we can't reliably skip user-edited bodies
      // here — version-bumps overwrite. Acceptable trade-off because
      // built-in skills are documented as auto-updating; users who want
      // a permanent fork should save under a new name.
      const bundledVersion = parseVersion(frontmatter.version);
      const existingVersion = parseVersion(existing?.version);
      const isStale =
        !!existing && bundledVersion !== null && (existingVersion === null || bundledVersion > existingVersion);
      if (existing && !force && !isStale) continue;
      const payload = frontmatterToSkill(name, frontmatter, body);
      if (existing) {
        await skillsStorage.remove(existing.id);
      }
      await skillsStorage.create({ ...payload, source: 'imported' });
      seeded.push(name);
    } catch (e) {
      console.warn('[doeverything] failed to seed built-in skill', path, e);
    }
  }
  return seeded;
}

// Parse `1`, `1.2`, `1.2.3`, etc. into a comparable number. Anything
// non-numeric returns null so the auto-bump path conservatively skips it.
function parseVersion(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const parts = String(v).trim().split('.').map(p => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return null;
  // Pack into a single number — major*1e6 + minor*1e3 + patch — so simple
  // comparison works without semver baggage.
  const [major = 0, minor = 0, patch = 0] = parts;
  return major * 1_000_000 + minor * 1_000 + patch;
}

function frontmatterToSkill(
  name: string,
  fm: SkillFrontmatter,
  body: string,
): Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> {
  const argumentNames =
    typeof fm.arguments === 'string'
      ? fm.arguments.split(/\s+/).filter(Boolean)
      : Array.isArray(fm.arguments)
        ? fm.arguments
        : undefined;
  const allowedTools =
    typeof fm['allowed-tools'] === 'string'
      ? fm['allowed-tools']
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : Array.isArray(fm['allowed-tools'])
        ? fm['allowed-tools']
        : undefined;
  const domains =
    typeof fm.domains === 'string'
      ? fm.domains
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : Array.isArray(fm.domains)
        ? fm.domains
        : undefined;
  return {
    name,
    description: typeof fm.description === 'string' ? fm.description : '',
    whenToUse: typeof fm.when_to_use === 'string' ? fm.when_to_use : undefined,
    argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined,
    argumentNames: argumentNames?.length ? argumentNames : undefined,
    allowedTools: allowedTools?.length ? allowedTools : undefined,
    model: typeof fm.model === 'string' ? fm.model : undefined,
    version: typeof fm.version === 'string' ? fm.version : undefined,
    domains: domains?.length ? domains : undefined,
    body,
    userInvocable: fm['user-invocable'] !== false,
    disableModelInvocation: fm['disable-model-invocation'] === true,
    source: 'imported',
  };
}
