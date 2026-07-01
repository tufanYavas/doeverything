/**
 * Per-model context-window resolution — static fallback layer.
 *
 * The agent's compaction/pruning gates need to know how big the active
 * model's context window actually is; a hardcoded 120K was wrong in both
 * directions (Cerebras 8K models overflowed before compaction ever fired,
 * 1M Gemini models compacted pointlessly early).
 *
 * Resolution order lives in the extension (`context-window.ts` there):
 *   1. discovery metadata (exact, from the provider's /models endpoint —
 *      Google reports inputTokenLimit, OpenRouter/Together context_length)
 *   2. this static pattern table (conservative)
 *   3. FALLBACK_CONTEXT_WINDOW
 *
 * This module is pure and storage-free so the package stays usable from
 * any context. Values are deliberately CONSERVATIVE — when a family spans
 * several window sizes, the smallest common one wins; the failure mode of
 * a low value is early compaction, of a high value a provider 400.
 */

export const FALLBACK_CONTEXT_WINDOW = 120_000;

/**
 * Cost ceiling on the EFFECTIVE window, regardless of what the model
 * supports. Letting a 1M-window model (Gemini 2.5 Pro, GPT-4.1) fill up
 * before compacting would be ruinous: every agent STEP resends the whole
 * prefix, so a 10-step turn at a 750K threshold is ~7.5M input tokens —
 * ~$19 uncached / ~$2.7 cache-hit on Gemini 2.5 Pro — and Gemini bills
 * prompts >200K at 2× ($2.50/M vs $1.25/M, output $15 vs $10). Capping at
 * 200K keeps every provider in its cheap tier, bounds per-turn cost ~10×
 * lower, avoids lost-in-the-middle recall degradation, and keeps prefill
 * latency sane. The VARIABLE floor still matters — 8K/32K models must
 * compact long before 200K. The model's true window stays available in
 * the static table / discovery data; only the effective budget is capped.
 */
export const CONTEXT_WINDOW_COST_CAP = 200_000;

export interface ContextWindowRatios {
  /** Compaction soft threshold. */
  warn: number;
  /** Compaction hard threshold. */
  critical: number;
  /** Snapshot-prune threshold (factory prepareStep). */
  prune: number;
}

export const CONTEXT_WINDOW_RATIOS: ContextWindowRatios = { warn: 0.75, critical: 0.9, prune: 0.6 };

interface ContextWindowPattern {
  prefix: string;
  tokens: number;
}

/**
 * Longest-prefix-wins table. Matched against BOTH the full lowercase model
 * id and the segment after the last `/` — covering OpenRouter
 * (`anthropic/claude-…`), Together (`meta-llama/Meta-Llama-3.1-…`) and
 * bare-id idioms (Cerebras `llama3.1-70b`).
 */
const PATTERNS: ContextWindowPattern[] = [
  // Anthropic
  { prefix: 'claude-', tokens: 200_000 },
  // OpenAI
  { prefix: 'gpt-5', tokens: 256_000 },
  { prefix: 'gpt-4.1', tokens: 1_000_000 },
  { prefix: 'gpt-4o', tokens: 128_000 },
  { prefix: 'gpt-4-turbo', tokens: 128_000 },
  { prefix: 'gpt-4', tokens: 8_192 },
  { prefix: 'gpt-3.5', tokens: 16_000 },
  { prefix: 'o1', tokens: 200_000 },
  { prefix: 'o3', tokens: 200_000 },
  { prefix: 'o4', tokens: 200_000 },
  { prefix: 'chatgpt-', tokens: 128_000 },
  { prefix: 'gpt-oss', tokens: 128_000 },
  // Google
  { prefix: 'gemini-2.5', tokens: 1_000_000 },
  { prefix: 'gemini-2.0', tokens: 1_000_000 },
  { prefix: 'gemini-1.5', tokens: 1_000_000 },
  { prefix: 'gemini-', tokens: 128_000 },
  { prefix: 'gemma-3', tokens: 128_000 },
  { prefix: 'gemma', tokens: 8_192 },
  // xAI
  { prefix: 'grok-4', tokens: 256_000 },
  { prefix: 'grok-', tokens: 131_072 },
  // Meta Llama (Groq/Together id forms + Cerebras `llama3.1-…` idiom)
  { prefix: 'llama-4', tokens: 128_000 },
  { prefix: 'llama-3.1', tokens: 128_000 },
  { prefix: 'llama-3.2', tokens: 128_000 },
  { prefix: 'llama-3.3', tokens: 128_000 },
  { prefix: 'meta-llama-3.1', tokens: 128_000 },
  { prefix: 'meta-llama-3.2', tokens: 128_000 },
  { prefix: 'meta-llama-3.3', tokens: 128_000 },
  { prefix: 'llama3.', tokens: 8_192 },
  { prefix: 'llama-3-', tokens: 8_192 },
  { prefix: 'meta-llama-3-', tokens: 8_192 },
  // Mistral
  { prefix: 'mistral-large', tokens: 128_000 },
  { prefix: 'mistral-medium', tokens: 128_000 },
  { prefix: 'mistral-nemo', tokens: 128_000 },
  { prefix: 'open-mistral-nemo', tokens: 128_000 },
  { prefix: 'ministral', tokens: 128_000 },
  { prefix: 'mistral-small', tokens: 32_000 },
  { prefix: 'codestral', tokens: 32_000 },
  { prefix: 'mixtral', tokens: 32_000 },
  { prefix: 'magistral', tokens: 40_000 },
  // Other common open/hosted families
  { prefix: 'deepseek', tokens: 64_000 },
  { prefix: 'qwen', tokens: 32_768 },
  { prefix: 'kimi', tokens: 131_072 },
  { prefix: 'command', tokens: 128_000 },
];

// Longest-prefix-wins, computed once at module load.
const SORTED_PATTERNS: ContextWindowPattern[] = [...PATTERNS].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Resolve a model id to a conservative context window from the static
 * table. `undefined` = unknown (caller applies the fallback / discovery
 * metadata).
 */
export function resolveStaticContextWindow(modelId: string): number | undefined {
  const id = modelId.trim().toLowerCase();
  if (!id) return undefined;
  const lastSegment = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  for (const pattern of SORTED_PATTERNS) {
    if (id.startsWith(pattern.prefix) || lastSegment.startsWith(pattern.prefix)) return pattern.tokens;
  }
  return undefined;
}
