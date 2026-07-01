/**
 * Mid-turn skill re-injection for the agent loop.
 *
 * The turn-start skill catalogue (`injectSkillListing`) is baked into the
 * agent's INITIAL messages, so it persists across the whole turn for free.
 * But the agent can NAVIGATE mid-turn (page A → x.com), and a skill scoped
 * to the destination (`domains: ["x.com"]`) would otherwise stay invisible
 * until the user's NEXT message — the listing is computed once per turn
 * against the tab that was active when the turn started.
 *
 * This refresher closes that gap, mirroring `BrowserStateRefresher`: when
 * the active tab URL changes during the loop it surfaces any newly-applicable
 * skills the model hasn't been told about yet, re-injecting them every step.
 * (The SDK rebuilds each step's messages from `initialMessages`, so a
 * one-shot injection wouldn't survive — see `factory.ts` prepareStep.)
 *
 * It deliberately does NOT mark these skills "sent" in the cross-turn
 * `listing-tracker`: this injection is a transient per-step augmentation,
 * not persistent history. The next user turn re-emits them into the durable
 * base via `injectSkillListing` (marking them sent then). Until that turn,
 * this bridge keeps them visible — and only while a page they apply to is
 * active (navigating away drops them from the block again).
 */

import { peekSentSkillNames } from '../skills/listing-tracker.js';
import { getModelInvocableSkills, isSkillActiveForUrl } from '../skills/model-invocable.js';
import { buildSkillListingMessage, formatSkillsWithinBudget } from '@doeverything/shared';
import type { Skill } from '@doeverything/storage';
import type { ModelMessage } from 'ai';

/** Marks the synthetic per-step skill-delta message. Distinct from the
 *  `<environment>` ephemeral marker so the two strip independently. */
const SKILL_DELTA_MARKER = '<!-- de:skill-delta -->';

/** Drop any previously-injected skill-delta message (sentinel on first text).
 *  Idempotent: returns the input array when nothing matches. */
function stripSkillDelta(messages: ModelMessage[]): ModelMessage[] {
  let removed = false;
  const filtered = messages.filter(m => {
    if (m.role !== 'user') return true;
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content) && m.content.length > 0) {
      const first = m.content[0];
      if (first && first.type === 'text' && typeof first.text === 'string') text = first.text;
    }
    if (text.startsWith(SKILL_DELTA_MARKER)) {
      removed = true;
      return false;
    }
    return true;
  });
  return removed ? filtered : messages;
}

/** Insert the skill-delta message immediately before the latest user message
 *  (so the model reads it as immediate context). No-op when no user message
 *  exists or the body is empty. */
function injectSkillDelta(messages: ModelMessage[], body: string): ModelMessage[] {
  if (!body) return messages;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return messages;
  const message: ModelMessage = {
    role: 'user',
    content: `${SKILL_DELTA_MARKER}\n${buildSkillListingMessage(body)}`,
  };
  return [...messages.slice(0, lastUserIdx), message, ...messages.slice(lastUserIdx)];
}

export class SkillListingRefresher {
  private lastUrl: string | null = null;
  private readonly seenNames = new Set<string>();
  private accumulated: Skill[] = [];
  private block = '';

  constructor(
    private readonly conversationId: string,
    private readonly contextWindow: number,
    /** Returns the active tab's URL (the same source `injectSkillListing` uses). */
    private readonly fetchUrl: () => Promise<string | undefined>,
  ) {}

  /** Recognise the turn-start URL as already handled — its applicable skills
   *  are already in the durable base, so the first `refresh()` is a no-op. */
  prime(url: string | undefined): void {
    this.lastUrl = url ?? null;
  }

  /**
   * Re-emit the mid-turn skill block. Recomputes the block only when the
   * active URL changed since the last call (cache-stable otherwise); always
   * re-injects the current block so it survives the SDK's per-step message
   * rebuild. Returns the input array unchanged when there's nothing to show.
   */
  async refresh(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const url = await this.fetchUrl().catch(() => undefined);
    const key = url ?? null;
    if (key !== this.lastUrl) {
      this.lastUrl = key;
      const invocable = await getModelInvocableSkills(url).catch(() => []);
      if (invocable.length > 0) {
        const sent = await peekSentSkillNames(this.conversationId).catch(() => new Set<string>());
        for (const s of invocable) {
          if (!sent.has(s.name) && !this.seenNames.has(s.name)) {
            this.seenNames.add(s.name);
            this.accumulated.push(s);
          }
        }
      }
      // Show only the skills applicable to the page currently in view, so
      // navigating away from x.com drops its skill from the block again.
      const visible = this.accumulated.filter(s => isSkillActiveForUrl(s, url));
      this.block = formatSkillsWithinBudget(visible, this.contextWindow);
    }
    const stripped = stripSkillDelta(messages);
    if (!this.block) return stripped;
    return injectSkillDelta(stripped, this.block);
  }
}
