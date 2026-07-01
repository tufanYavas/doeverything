/**
 * Expands a saved skill body into the text the agent runs.
 *
 *   1. Substitutes named / indexed argument placeholders ($name, $0,
 *      $ARGUMENTS, $ARGUMENTS[N]) using the user-supplied args string.
 *   2. Replaces `${doeverything_SESSION_ID}` with the active conversation id.
 *   3. Replaces `${doeverything_TAB_ID}` with the target tab id (when known).
 *
 * Inline shell execution markers (`!`…``) are intentionally NOT supported:
 * skill bodies are pure markdown templates that get folded back into the
 * agent's user message — they never execute as code.
 */

import { substituteArguments } from './argument-substitution.js';
import type { Skill } from '@doeverything/storage';

export interface ExpandSkillContext {
  sessionId?: string;
  tabId?: number;
}

export function expandSkill(skill: Skill, args: string | undefined, ctx: ExpandSkillContext = {}): string {
  let body = skill.body;

  body = substituteArguments(body, args, true, skill.argumentNames ?? []);

  if (ctx.sessionId) {
    body = body.replace(/\$\{doeverything_SESSION_ID\}/g, ctx.sessionId);
  }
  if (typeof ctx.tabId === 'number') {
    body = body.replace(/\$\{doeverything_TAB_ID\}/g, String(ctx.tabId));
  }
  return body;
}
