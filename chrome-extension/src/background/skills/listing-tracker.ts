/**
 * Per-session delta tracker for skill listings.
 *
 * The runner injects the FULL listing once on turn-0 of a conversation,
 * then on subsequent turns only emits skills the agent has not yet been
 * told about (skills added through the options UI mid-conversation).
 * `resetAllListingSessions()` is called when storage changes via CRUD so
 * the next turn re-emits with fresh content.
 *
 * Persisted via `chrome.storage.session` so an MV3 service-worker
 * eviction doesn't make us re-broadcast the entire listing on every
 * post-wake turn (which would burn tokens on already-announced skills).
 */

import { commitSessionState, loadSessionState, readSessionState } from './session-state.js';
import type { Skill } from '@doeverything/storage';

interface SessionState {
  /** Names already announced to the agent in this conversation. */
  sentNames: string[];
  /** When set, the next listing call swallows the emission (resume path). */
  suppressNext: boolean;
}

const KEY = 'listing';
type State = Record<string /* sessionId */, SessionState>;
const empty = (): State => ({});

export interface SkillListingDelta {
  newSkills: Skill[];
  isInitial: boolean;
}

export async function consumeSkillListing(sessionId: string, allSkills: Skill[]): Promise<SkillListingDelta> {
  await loadSessionState<State>(KEY, empty);
  const state = readSessionState<State>(KEY);
  const session = state[sessionId] ?? { sentNames: [], suppressNext: false };

  if (session.suppressNext) {
    session.suppressNext = false;
    const next = new Set(session.sentNames);
    for (const s of allSkills) next.add(s.name);
    session.sentNames = Array.from(next);
    state[sessionId] = session;
    void commitSessionState(KEY, state);
    return { newSkills: [], isInitial: false };
  }

  const sent = new Set(session.sentNames);
  const newSkills = allSkills.filter(s => !sent.has(s.name));
  if (newSkills.length === 0) {
    state[sessionId] = session;
    return { newSkills: [], isInitial: false };
  }

  const isInitial = sent.size === 0;
  for (const s of newSkills) sent.add(s.name);
  session.sentNames = Array.from(sent);
  state[sessionId] = session;
  await commitSessionState(KEY, state);
  return { newSkills, isInitial };
}

/**
 * Read-only view of the skill names already announced to the agent in this
 * conversation's PERSISTENT history (no mutation, no commit). Used by the
 * mid-turn skill refresher to avoid re-announcing skills the durable base
 * already carries.
 */
export async function peekSentSkillNames(sessionId: string): Promise<Set<string>> {
  await loadSessionState<State>(KEY, empty);
  const state = readSessionState<State>(KEY);
  return new Set(state[sessionId]?.sentNames ?? []);
}

export async function suppressNextSkillListing(sessionId: string): Promise<void> {
  await loadSessionState<State>(KEY, empty);
  const state = readSessionState<State>(KEY);
  const session = state[sessionId] ?? { sentNames: [], suppressNext: false };
  session.suppressNext = true;
  state[sessionId] = session;
  await commitSessionState(KEY, state);
}

export async function clearListingForSession(sessionId: string): Promise<void> {
  const state = await loadSessionState<State>(KEY, empty);
  if (!state[sessionId]) return;
  delete state[sessionId];
  await commitSessionState(KEY, state);
}

/** Reset every session's listing state â€” call when storage CRUD happens. */
export async function resetAllListingSessions(): Promise<void> {
  await commitSessionState<State>(KEY, {});
}
