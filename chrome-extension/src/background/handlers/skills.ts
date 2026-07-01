/**
 * doeverything skills SW message bridge.
 *
 * Inbound:
 *   - de/skills/invoke { skillId | skillName, args, conversationId, tabId? }
 *       → Resolves the skill, expands the body (substituting $ARGUMENTS,
 *         $name, ${doeverything_TAB_ID}, ${doeverything_SESSION_ID}), applies
 *         session-scoped runtime overrides, records the invocation for
 *         compaction survival, and bumps the usage counter. Returns the
 *         expanded body so the side panel can submit it as a user prompt.
 *   - de/skills/seed-defaults { force? }
 *       → Loads bundled SKILL.md files into chrome.storage if absent.
 *   - de/skills/reset-listing-sessions
 *       → Drops every conversation's skill-listing delta cache so the
 *         next agent turn re-emits a fresh listing.
 */

import { recordInvokedSkill } from '../skills/invocation-tracker.js';
import { resetAllListingSessions } from '../skills/listing-tracker.js';
import { applySkillOverrides } from '../skills/runtime-overrides.js';
import { seedBuiltInSkills } from '../skills/seed.js';
import { expandSkill } from '@doeverything/shared';
import { skillsStorage } from '@doeverything/storage';
import type { Skill } from '@doeverything/storage';

interface InvokeMessage {
  type: 'doe/skills/invoke';
  skillId?: string;
  skillName?: string;
  args?: string;
  conversationId: string;
  tabId?: number;
}

interface SeedMessage {
  type: 'doe/skills/seed-defaults';
  force?: boolean;
}

interface ResetListingMessage {
  type: 'doe/skills/reset-listing-sessions';
}

type SkillsMessage = InvokeMessage | SeedMessage | ResetListingMessage;

export function registerSkillsHandlers() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string } | null;
    if (!msg?.type?.startsWith('doe/skills/')) return false;

    void (async () => {
      try {
        const result = await dispatch(msg as SkillsMessage);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  });
}

async function dispatch(msg: SkillsMessage): Promise<unknown> {
  switch (msg.type) {
    case 'doe/skills/invoke': {
      const all = await skillsStorage.getAll();
      const skill: Skill | undefined = msg.skillId
        ? all.find(s => s.id === msg.skillId)
        : msg.skillName
          ? all.find(s => s.name === msg.skillName)
          : undefined;
      if (!skill) {
        return { ok: false, error: `Unknown skill: ${msg.skillName ?? msg.skillId ?? '(no name)'}` };
      }

      const expanded = expandSkill(skill, msg.args, {
        sessionId: msg.conversationId,
        tabId: msg.tabId,
      });

      await applySkillOverrides(msg.conversationId, {
        allowedTools: skill.allowedTools,
        model: skill.model ?? null,
      });

      await recordInvokedSkill(msg.conversationId, skill.name, expanded);

      void skillsStorage.recordUsage(skill.name);

      return {
        ok: true,
        skillName: skill.name,
        expanded,
        allowedTools: skill.allowedTools,
        model: skill.model,
      };
    }
    case 'doe/skills/seed-defaults': {
      const seeded = await seedBuiltInSkills({ force: msg.force === true });
      return { ok: true, seeded };
    }
    case 'doe/skills/reset-listing-sessions': {
      // Called by the options UI after a CRUD save/delete so the next agent
      // turn re-emits a fresh listing including the user's edits.
      await resetAllListingSessions();
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown skills message: ${(msg as { type?: string }).type}` };
  }
}
