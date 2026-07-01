/**
 * In-memory pool of agent sessions.
 *
 * The side panel may queue up multiple parallel runs (e.g. scheduled task
 * + interactive prompt). The pool dedupes them by conversation id so we
 * don't spawn two competing port-bridges for the same session.
 *
 * The pool lives on `globalThis` so SW eviction wipes it cleanly — that's
 * the desired behaviour, since any pending agent run is gone too.
 */

interface SessionEntry {
  conversationId: string;
  startedAt: number;
  promptPreview: string;
}

const G = globalThis as unknown as { __doe_sessions?: Map<string, SessionEntry> };
if (!G.__doe_sessions) G.__doe_sessions = new Map();
const sessions = G.__doe_sessions;

export const SessionPool = {
  register(conversationId: string, promptPreview: string) {
    sessions.set(conversationId, { conversationId, startedAt: Date.now(), promptPreview });
  },
  release(conversationId: string) {
    sessions.delete(conversationId);
  },
  list(): SessionEntry[] {
    return [...sessions.values()];
  },
  size(): number {
    return sessions.size;
  },
};
