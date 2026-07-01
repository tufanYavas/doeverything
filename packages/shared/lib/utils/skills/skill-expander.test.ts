import { expandSkill } from './skill-expander.js';
import { describe, expect, it } from 'vitest';
import type { Skill } from '@doeverything/storage';

function skill(body: string, argumentNames: string[] = []): Skill {
  return { id: 's', name: 'n', description: '', body, argumentNames } as Skill;
}

describe('expandSkill', () => {
  it('substitutes named args from the args string', () => {
    expect(expandSkill(skill('Go to $site', ['site']), 'example.com')).toBe('Go to example.com');
  });

  it('replaces ${doeverything_SESSION_ID} and ${doeverything_TAB_ID} from context', () => {
    const out = expandSkill(skill('s=${doeverything_SESSION_ID} t=${doeverything_TAB_ID}'), undefined, {
      sessionId: 'conv-9',
      tabId: 42,
    });
    expect(out).toBe('s=conv-9 t=42');
  });

  it('leaves tab placeholder untouched when no tab id is provided', () => {
    expect(expandSkill(skill('tab=${doeverything_TAB_ID}'), undefined, { sessionId: 'c' })).toBe(
      'tab=${doeverything_TAB_ID}',
    );
  });

  it('appends ARGUMENTS when the body has no placeholder', () => {
    expect(expandSkill(skill('do it'), 'extra')).toBe('do it\n\nARGUMENTS: extra');
  });
});
