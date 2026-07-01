/**
 * Per-session runtime overrides applied by skill invocations.
 *
 * When a skill fires, its frontmatter can declare:
 *
 *   - `allowed-tools`  → tool calls matching these names skip the
 *                        permission prompt for the rest of the session.
 *   - `model`          → the next API turn uses this model instead of
 *                        the user-selected one (consumed once via
 *                        `consumePendingModelOverride`).
 *
 * Session-scoped: once a skill grants a permission or picks a model, that
 * decision stays active for the conversation. Subsequent invocations
 * extend allowedTools (set union) or replace the model.
 *
 * Persisted via `chrome.storage.session` so MV3 service-worker eviction
 * mid-conversation doesn't drop a granted allow-list (the next gated
 * call would re-prompt the user) or a pending model override.
 */

import { commitSessionState, loadSessionState, readSessionState } from './session-state.js';

interface SessionOverrides {
  allowedTools: string[];
  modelOverride: string | null;
  modelOverridePending: boolean;
}

const KEY = 'overrides';
type State = Record<string /* sessionId */, SessionOverrides>;
const empty = (): State => ({});

const blankOverrides = (): SessionOverrides => ({
  allowedTools: [],
  modelOverride: null,
  modelOverridePending: false,
});

export async function applySkillOverrides(
  sessionId: string,
  payload: { allowedTools?: string[]; model?: string | null },
): Promise<void> {
  await loadSessionState<State>(KEY, empty);
  const state = readSessionState<State>(KEY);
  const overrides = state[sessionId] ?? blankOverrides();

  if (payload.allowedTools && payload.allowedTools.length > 0) {
    const set = new Set(overrides.allowedTools);
    for (const t of payload.allowedTools) set.add(t);
    overrides.allowedTools = Array.from(set);
  }
  if (payload.model) {
    overrides.modelOverride = payload.model;
    overrides.modelOverridePending = true;
  }

  state[sessionId] = overrides;
  await commitSessionState(KEY, state);
}

export async function isSkillAllowedTool(sessionId: string, toolName: string): Promise<boolean> {
  const state = await loadSessionState<State>(KEY, empty);
  return state[sessionId]?.allowedTools.includes(toolName) ?? false;
}

/**
 * Consumes the pending model override. Returns the model id (or null) and
 * clears the pending flag — the override fires for the very next API
 * request after the skill, then the cached value stays for re-use without
 * re-firing on subsequent turns.
 */
export async function consumePendingModelOverride(sessionId: string): Promise<string | null> {
  await loadSessionState<State>(KEY, empty);
  const state = readSessionState<State>(KEY);
  const overrides = state[sessionId];
  if (!overrides || !overrides.modelOverridePending) return null;
  overrides.modelOverridePending = false;
  state[sessionId] = overrides;
  await commitSessionState(KEY, state);
  return overrides.modelOverride;
}

export async function clearOverridesForSession(sessionId: string): Promise<void> {
  const state = await loadSessionState<State>(KEY, empty);
  if (!state[sessionId]) return;
  delete state[sessionId];
  await commitSessionState(KEY, state);
}

export async function resetAllSkillOverrides(): Promise<void> {
  await commitSessionState<State>(KEY, {});
}

export async function getSkillOverridesSnapshot(sessionId: string): Promise<{
  allowedTools: string[];
  modelOverride: string | null;
}> {
  const state = await loadSessionState<State>(KEY, empty);
  const o = state[sessionId];
  if (!o) return { allowedTools: [], modelOverride: null };
  return { allowedTools: [...o.allowedTools], modelOverride: o.modelOverride };
}
