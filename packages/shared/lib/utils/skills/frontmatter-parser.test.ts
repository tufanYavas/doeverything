import { parseBooleanFrontmatter, parseSkillMarkdown, serializeSkillToMarkdown } from './frontmatter-parser.js';
import { describe, expect, it } from 'vitest';
import type { Skill } from '@doeverything/storage';

describe('parseSkillMarkdown', () => {
  it('returns the whole input as body when there is no frontmatter', () => {
    const r = parseSkillMarkdown('just a body');
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe('just a body');
  });

  it('parses scalar, quoted, boolean, and array values', () => {
    const md = [
      '---',
      'name: My Skill',
      'description: "Does: things"',
      'user-invocable: false',
      'domains: [example.com, "*.foo.com"]',
      '---',
      'Body here',
    ].join('\n');
    const r = parseSkillMarkdown(md);
    expect(r.frontmatter.name).toBe('My Skill');
    expect(r.frontmatter.description).toBe('Does: things');
    expect(r.frontmatter['user-invocable']).toBe(false);
    expect(r.frontmatter.domains).toEqual(['example.com', '*.foo.com']);
    expect(r.body).toBe('Body here');
  });

  it('ignores comment and blank lines', () => {
    const md = ['---', '# a comment', '', 'name: X', '---', 'b'].join('\n');
    expect(parseSkillMarkdown(md).frontmatter).toEqual({ name: 'X' });
  });
});

describe('parseBooleanFrontmatter', () => {
  it('treats real booleans and "true"/"false" strings', () => {
    expect(parseBooleanFrontmatter(true)).toBe(true);
    expect(parseBooleanFrontmatter('true')).toBe(true);
    expect(parseBooleanFrontmatter('false')).toBe(false);
    expect(parseBooleanFrontmatter(undefined)).toBe(false);
  });
});

describe('serializeSkillToMarkdown â†” parseSkillMarkdown round-trip', () => {
  it('survives a round-trip with arrays and special characters', () => {
    const skill: Skill = {
      id: 's1',
      name: 'Title: with colon',
      description: 'A description',
      body: 'The body\nwith two lines',
      argumentNames: ['a', 'b'],
      allowedTools: ['navigate', 'computer'],
      domains: ['example.com', '*.foo.com'],
      userInvocable: false,
    } as Skill;

    const md = serializeSkillToMarkdown(skill);
    const parsed = parseSkillMarkdown(md);
    expect(parsed.frontmatter.name).toBe('Title: with colon'); // colon-safe via JSON quoting
    expect(parsed.frontmatter.domains).toEqual(['example.com', '*.foo.com']);
    expect(parsed.frontmatter['allowed-tools']).toEqual(['navigate', 'computer']);
    expect(parsed.body).toBe('The body\nwith two lines');
  });
});
