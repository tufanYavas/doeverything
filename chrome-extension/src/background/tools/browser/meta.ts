import { recordInvokedSkill } from '../../skills/invocation-tracker.js';
import { applySkillOverrides } from '../../skills/runtime-overrides.js';
import { expandSkill } from '@doeverything/shared';
import { skillsStorage } from '@doeverything/storage';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function metaTools(ctx: AgentToolContext) {
  return {
    skill: tool({
      description:
        'Runs one of the user\'s saved doeverything skills (a markdown procedure). When the user types `/<name>`, invoke that skill via this tool. Set `skill` to the exact name (no leading slash); set `args` to the argument string. Only invoke skills listed in the `<system-reminder>` near the top of the conversation — never guess names. Don\'t invoke the same skill twice in one turn.',
      inputSchema: z.object({
        skill: z
          .string()
          .describe(
            'The exact skill name. E.g., "scrape", "translate", "research-competitor". Do NOT include the leading slash.',
          ),
        args: z
          .string()
          .optional()
          .describe('Optional arguments for the skill (matches the argument hint shown in the listing).'),
      }),
      execute: async ({ skill: rawName, args }) => {
        const trimmed = (rawName ?? '').trim();
        if (!trimmed) return { error: 'Invalid skill format: skill name is required' };
        const name = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;

        const skill = await skillsStorage.getByName(name);
        if (!skill) return { error: `Unknown skill: ${name}` };
        if (skill.disableModelInvocation) {
          return {
            error: `Skill ${name} cannot be invoked by the model (disableModelInvocation is set)`,
          };
        }

        void skillsStorage.recordUsage(name);

        const tabId = await ctx.getEffectiveTabId().catch(() => undefined);

        const expanded = expandSkill(skill, args, {
          sessionId: ctx.conversationId,
          tabId,
        });

        await applySkillOverrides(ctx.conversationId, {
          allowedTools: skill.allowedTools,
          model: skill.model ?? null,
        });

        await recordInvokedSkill(ctx.conversationId, name, expanded);

        return {
          output: expanded,
          skillName: name,
          allowedTools: skill.allowedTools && skill.allowedTools.length > 0 ? skill.allowedTools : undefined,
          model: skill.model,
        };
      },
    }),

    done: tool({
      description:
        'Ends the turn. `text` is the only message the user reads — every other tool result is hidden. `success: false` when not fulfilled. See LOOP_GUIDANCE for tone, length, and `success: false` structure.',
      inputSchema: z.object({
        text: z.string().describe('User-facing reply (markdown, in the user\'s language). Soft target ≤6000 chars.'),
        success: z.boolean().optional().describe('False when the request could not be fulfilled. Default: true.'),
      }),
      execute: async ({ text, success }) => {
        // No internal cap — `done` is `Infinity`-opt-out from the
        // universal wrapper, and self-truncation would hide overruns from
        // both the user and the agent. The system prompt's soft target
        // (LOOP_GUIDANCE: "≤6000 characters") is the only guidance.
        const safeText = text || 'Task completed.';
        return {
          output: safeText,
          isDone: true,
          doneText: safeText,
          doneSuccess: success !== false,
        };
      },
    }),
  };
}
