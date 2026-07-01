/**
 * Context budget — the ONE module that owns "how full is the window and
 * what do we do about it". Every threshold the agent loop uses derives
 * from the resolved per-model context window through the shared ratios in
 * `@doeverything/llm-providers` (CONTEXT_WINDOW_RATIOS), so compaction,
 * snapshot pruning, and the UI all agree on what "full" means.
 */

import { resolveContextWindow } from './context-window.js';
import { CONTEXT_WINDOW_RATIOS, FALLBACK_CONTEXT_WINDOW } from '@doeverything/llm-providers';
import type { LlmProviderId } from '@doeverything/llm-providers';

export type CompactionStage = 'ok' | 'warn' | 'critical';

/**
 * Post-compaction tail target: the kept (un-summarized) recent turns should
 * occupy about this share of the window, leaving room for the system
 * prompt, tool schemas, new tool results, and the model's own output.
 */
export const KEEP_TAIL_RATIO = 0.3;

/**
 * Flat allowance for what the message-array estimate can't see: ~30 tool
 * JSON schemas plus provider framing, sent with every request.
 */
export const TOOL_SCHEMA_OVERHEAD_TOKENS = 8_000;

/** Dev override key — set a small number to exercise compaction live. */
const DEV_WINDOW_KEY = 'doe:dev:context-window';

export function classifyContext(estimated: number, contextWindow: number): CompactionStage {
  const ratio = estimated / Math.max(contextWindow, 1);
  if (ratio >= CONTEXT_WINDOW_RATIOS.critical) return 'critical';
  if (ratio >= CONTEXT_WINDOW_RATIOS.warn) return 'warn';
  return 'ok';
}

/** Snapshot-prune gate for the factory's prepareStep. */
export function pruneThreshold(contextWindow: number): number {
  return Math.floor(contextWindow * CONTEXT_WINDOW_RATIOS.prune);
}

/**
 * Window resolution with the dev override applied. The runner calls this
 * once per run and threads the plain number everywhere.
 */
export async function resolveContextWindowSafe(provider: LlmProviderId, modelId: string): Promise<number> {
  try {
    const stored = await chrome.storage.local.get(DEV_WINDOW_KEY);
    const override: unknown = stored?.[DEV_WINDOW_KEY];
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
      console.debug('[doeverything] context window dev override', override);
      return Math.floor(override);
    }
  } catch {
    // storage unavailable (tests) — fall through to real resolution
  }
  try {
    return await resolveContextWindow(provider, modelId);
  } catch {
    return FALLBACK_CONTEXT_WINDOW;
  }
}
