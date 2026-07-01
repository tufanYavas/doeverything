/**
 * Persistent per-conversation compaction state.
 *
 * The panel resends the FULL ChatMessageDTO history every turn and keeps
 * displaying it (UX: the user can scroll back). The SW substitutes
 * `[stored summary + messages after cursor]` when building the model
 * conversation. Persisting `{summary, cursorMessageId}` is what makes
 * compaction pay off:
 *   - the summary is generated ONCE and reused VERBATIM, so messages[0]
 *     is byte-stable across turns and the Anthropic cache prefix survives;
 *   - the per-turn "generate a fresh summary" tax disappears;
 *   - re-compaction is incremental — new folds MERGE into the existing
 *     summary instead of re-summarising from scratch.
 *
 * Backed by the same session-state helper the skill trackers use
 * (in-memory cache + chrome.storage.session mirror): survives SW eviction
 * within a browser session, clean slate on browser restart — exactly the
 * lifetime of the panel's in-memory chat history.
 */

import { commitSessionState, loadSessionState } from '../skills/session-state.js';

export interface CompactionCacheRecord {
  conversationId: string;
  /** Reused verbatim each turn — stability is what keeps the cache prefix alive. */
  summary: string;
  /** Id of the LAST ChatMessageDTO folded into the summary. */
  cursorMessageId: string;
  /** DTO count at write time — sanity breadcrumb for stale-edit debugging. */
  coveredCount: number;
  summaryTokens: number;
  /** Bumped on every incremental fold (telemetry/debug). */
  generation: number;
  updatedAt: number;
}

type CacheMap = Record<string, CompactionCacheRecord>;

const CACHE_KEY = 'compaction-records';
/** Panel reloads mint new conversationIds; GC keeps orphans bounded. */
const MAX_RECORDS = 8;

export async function getCompactionRecord(conversationId: string): Promise<CompactionCacheRecord | null> {
  const map = await loadSessionState<CacheMap>(CACHE_KEY, () => ({}));
  return map[conversationId] ?? null;
}

export async function setCompactionRecord(record: CompactionCacheRecord): Promise<void> {
  const map = await loadSessionState<CacheMap>(CACHE_KEY, () => ({}));
  const next: CacheMap = { ...map, [record.conversationId]: record };
  const records = Object.values(next);
  if (records.length > MAX_RECORDS) {
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    const trimmed: CacheMap = {};
    for (const r of records.slice(0, MAX_RECORDS)) trimmed[r.conversationId] = r;
    await commitSessionState(CACHE_KEY, trimmed);
    return;
  }
  await commitSessionState(CACHE_KEY, next);
}

export async function clearCompactionRecord(conversationId: string): Promise<void> {
  const map = await loadSessionState<CacheMap>(CACHE_KEY, () => ({}));
  if (!(conversationId in map)) return;
  const next: CacheMap = { ...map };
  delete next[conversationId];
  await commitSessionState(CACHE_KEY, next);
}
