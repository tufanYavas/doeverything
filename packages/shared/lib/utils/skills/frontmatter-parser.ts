/**
 * Markdown-frontmatter parser/serializer for SKILL.md import / export.
 *
 * A lean line-based parser supporting flat scalars and inline lists; no
 * nested objects or multiline scalars â€” that's all skills need.
 *
 * Recognized fields:
 *   description, when_to_use, argument-hint, arguments,
 *   allowed-tools, domains, model, version,
 *   user-invocable, disable-model-invocation
 */

import type { Skill } from '@doeverything/storage';

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

export interface SkillFrontmatter {
  description?: string;
  when_to_use?: string;
  'argument-hint'?: string;
  arguments?: string | string[];
  'allowed-tools'?: string | string[];
  domains?: string | string[];
  model?: string;
  version?: string;
  'user-invocable'?: boolean | string;
  'disable-model-invocation'?: boolean | string;
  name?: string;
  [key: string]: unknown;
}

export interface ParsedSkillMarkdown {
  frontmatter: SkillFrontmatter;
  body: string;
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  const m = markdown.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: markdown };
  const yamlText = m[1] ?? '';
  const body = markdown.slice(m[0].length);
  return { frontmatter: parseSimpleYaml(yamlText), body };
}

function parseSimpleYaml(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const raw = m[2] ?? '';
    out[key] = parseValue(raw);
  }
  return out;
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (!v) return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map(p => p.trim())
      .map(p => {
        if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
          return p.slice(1, -1);
        }
        return p;
      });
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export function serializeSkillToMarkdown(skill: Skill): string {
  const fm: string[] = [];
  fm.push(`name: ${escapeScalar(skill.name)}`);
  if (skill.description) fm.push(`description: ${escapeScalar(skill.description)}`);
  if (skill.whenToUse) fm.push(`when_to_use: ${escapeScalar(skill.whenToUse)}`);
  if (skill.argumentHint) fm.push(`argument-hint: ${escapeScalar(skill.argumentHint)}`);
  if (skill.argumentNames && skill.argumentNames.length > 0) {
    fm.push(`arguments: ${escapeScalar(skill.argumentNames.join(' '))}`);
  }
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    fm.push(`allowed-tools: [${skill.allowedTools.map(escapeScalar).join(', ')}]`);
  }
  if (skill.domains && skill.domains.length > 0) {
    fm.push(`domains: [${skill.domains.map(escapeScalar).join(', ')}]`);
  }
  if (skill.model) fm.push(`model: ${escapeScalar(skill.model)}`);
  if (skill.version) fm.push(`version: ${escapeScalar(skill.version)}`);
  if (skill.userInvocable === false) fm.push('user-invocable: false');
  if (skill.disableModelInvocation === true) fm.push('disable-model-invocation: true');
  return `---\n${fm.join('\n')}\n---\n${skill.body}`;
}

function escapeScalar(v: string): string {
  if (/[:#[\]{}|>&!*\n]/.test(v) || /^['"]/.test(v) || /\s$|^\s/.test(v)) {
    return JSON.stringify(v);
  }
  return v;
}

export function parseBooleanFrontmatter(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}
