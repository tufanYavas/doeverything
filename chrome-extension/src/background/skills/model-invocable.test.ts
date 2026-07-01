import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@doeverything/storage';

function skill(over: Partial<Skill> = {}): Skill {
  return { id: 's', name: 'n', description: 'd', body: '', domains: [], ...over } as Skill;
}

describe('isSkillActiveForUrl (pure)', () => {
  // Pure function â€” safe to import once.
  it('is active when the skill has no domain restriction', async () => {
    const { isSkillActiveForUrl } = await import('./model-invocable.js');
    expect(isSkillActiveForUrl(skill({ domains: [] }), 'https://anywhere.com')).toBe(true);
    expect(isSkillActiveForUrl(skill({ domains: undefined }), undefined)).toBe(true);
  });

  it('is active only on matching domains when restricted', async () => {
    const { isSkillActiveForUrl } = await import('./model-invocable.js');
    const s = skill({ domains: ['*.github.com'] });
    expect(isSkillActiveForUrl(s, 'https://gist.github.com/x')).toBe(true);
    expect(isSkillActiveForUrl(s, 'https://example.com')).toBe(false);
    expect(isSkillActiveForUrl(s, undefined)).toBe(false);
  });
});

describe('getModelInvocableSkills', () => {
  beforeEach(() => vi.resetModules());

  async function seedAndQuery(skills: Array<Partial<Skill>>, url?: string) {
    const { skillsStorage } = await import('@doeverything/storage');
    for (const s of skills) {
      await skillsStorage.create(skill(s));
    }
    const { getModelInvocableSkills } = await import('./model-invocable.js');
    return getModelInvocableSkills(url);
  }

  it('excludes skills with disableModelInvocation', async () => {
    const got = await seedAndQuery([
      { name: 'keep', description: 'd' },
      { name: 'drop', description: 'd', disableModelInvocation: true },
    ]);
    expect(got.map(s => s.name)).toEqual(['keep']);
  });

  it('excludes skills with no description and no whenToUse', async () => {
    const got = await seedAndQuery([
      { name: 'keep', description: 'has desc' },
      { name: 'blank', description: '', whenToUse: '' },
    ]);
    expect(got.map(s => s.name)).toEqual(['keep']);
  });

  it('filters by domain against the current url', async () => {
    const { skillsStorage } = await import('@doeverything/storage');
    await skillsStorage.create(skill({ name: 'gh', description: 'd', domains: ['*.github.com'] }));
    await skillsStorage.create(skill({ name: 'any', description: 'd' }));
    const { getModelInvocableSkills } = await import('./model-invocable.js');

    const onGithub = await getModelInvocableSkills('https://app.github.com/x');
    expect(new Set(onGithub.map(s => s.name))).toEqual(new Set(['gh', 'any']));

    const elsewhere = await getModelInvocableSkills('https://other.com');
    expect(elsewhere.map(s => s.name)).toEqual(['any']); // domain-restricted 'gh' filtered out
  });
});
