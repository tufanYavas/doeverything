/**
 * Compaction survival for skill invocations.
 *
 *   1. Every time a skill expands into the conversation (via the `skill`
 *      tool or via /skill from the user), call `recordInvokedSkill`.
 *   2. After the runner compacts older turns, call
 *      `buildPostCompactSkillMessages` and append its output to the
 *      conversation. The output is a list of user-meta `<system-reminder>`
 *      messages re-injecting the skill bodies the agent already saw, so
 *      the rules they encoded survive the summary.
 *   3. On `clearInvocationsForSession`, release memory.
 *
 * Per-skill content is truncated at ~12k chars; total budget ~40k chars.
 * Most-recent-first ordering means budget pressure drops the LEAST
 * relevant entries.
 *
 * State is persisted via `chrome.storage.session` so an MV3 service-worker
 * eviction mid-conversation doesn't drop the invocation log — without that,
 * a compaction that happened after a wake-up would lose every skill the
 * agent had already invoked.
 */

import { commitSessionState, loadSessionState, readSessionState } from './session-state.js';

interface InvokedSkillRecord {
  skillName: string;
  content: string;
  invokedAt: number;
}

const CHARS_PER_TOKEN = 4;
const POST_COMPACT_MAX_CHARS_PER_SKILL = 3000 * CHARS_PER_TOKEN;
const POST_COMPACT_TOTAL_CHAR_BUDGET = 10000 * CHARS_PER_TOKEN;

const KEY = 'invocations';
type State = Record<string /* sessionId */, Record<string /* skillName */, InvokedSkillRecord>>;

const empty = (): State => ({});

export async function recordInvokedSkill(sessionId: string, skillName: string, content: string): Promise<void> {
  if (!sessionId || !skillName) return;
  await loadSessionState<State>(KEY, empty);
  const state = readSessionState<State>(KEY);
  const sessionMap = state[sessionId] ?? {};
  sessionMap[skillName] = { skillName, content, invokedAt: Date.now() };
  state[sessionId] = sessionMap;
  await commitSessionState(KEY, state);
}

export async function getInvokedSkills(sessionId: string): Promise<InvokedSkillRecord[]> {
  const state = await loadSessionState<State>(KEY, empty);
  const sessionMap = state[sessionId];
  if (!sessionMap) return [];
  return Object.values(sessionMap).sort((a, b) => b.invokedAt - a.invokedAt);
}

/**
 * Returns user-meta messages to append AFTER compaction so the agent
 * still sees the skill bodies it was operating on. Empty array when
 * nothing has been invoked yet.
 *
 * Each entry is `{ role: 'user', content: '<system-reminder>…</system-reminder>' }`.
 */
export async function buildPostCompactSkillMessages(
  sessionId: string,
): Promise<Array<{ role: 'user'; content: string }>> {
  const skills = await getInvokedSkills(sessionId);
  if (skills.length === 0) return [];

  const out: Array<{ role: 'user'; content: string }> = [];
  let usedChars = 0;
  for (const s of skills) {
    const truncated =
      s.content.length > POST_COMPACT_MAX_CHARS_PER_SKILL
        ? s.content.slice(0, POST_COMPACT_MAX_CHARS_PER_SKILL - 1) + '…'
        : s.content;
    if (usedChars + truncated.length > POST_COMPACT_TOTAL_CHAR_BUDGET) break;
    usedChars += truncated.length;
    out.push({
      role: 'user',
      content:
        '<system-reminder>\n' +
        'The following skill was invoked earlier in this conversation. ' +
        'Its instructions still apply.\n\n' +
        `Skill: ${s.skillName}\n\n${truncated}\n` +
        '</system-reminder>',
    });
  }
  return out;
}

export async function clearInvocationsForSession(sessionId: string): Promise<void> {
  const state = await loadSessionState<State>(KEY, empty);
  if (!state[sessionId]) return;
  delete state[sessionId];
  await commitSessionState(KEY, state);
}

export async function resetAllInvocations(): Promise<void> {
  await commitSessionState<State>(KEY, {});
}

export async function getInvokedSkillCount(sessionId: string): Promise<number> {
  const state = await loadSessionState<State>(KEY, empty);
  return Object.keys(state[sessionId] ?? {}).length;
}
