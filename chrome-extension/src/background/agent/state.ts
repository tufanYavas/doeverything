/**
 * Browser-state injection + prompt-cache breakpoint management for the
 * agent loop. Every per-step mutation that crosses the wire goes through
 * this file so the prompt cache can be reasoned about in one place.
 *
 * Three responsibilities:
 *   1. `BrowserStateRefresher` — owns the synthetic `<environment>` user
 *      message: builds it, decides when to re-inject, strips the previous
 *      copy. Change detection uses a hash function (NOT the full snapshot
 *      string) so volatile fields (tab title, query strings) don't bust
 *      the cache on every step.
 *   2. `CacheBreakpointTracker` — owns the rolling Anthropic
 *      `cacheControl: ephemeral` breakpoint. Growth-gated: a new
 *      breakpoint is stamped only when the prefix has grown by at least
 *      `BREAKPOINT_GROWTH_THRESHOLD` tokens since the last one. Per-step
 *      stamping (the naive approach) is ~35% MORE expensive than no
 *      caching at all on a single 19-step turn — it pays write cost
 *      (1.25× input) without amortising the read savings. Growth gating
 *      keeps the breakpoint near the front of the loop where it gets the
 *      most reads.
 *   3. Helpers for the synthetic message lifecycle (sentinel marker,
 *      strip, inject).
 *
 * Google note: `@ai-sdk/google` ignores `providerOptions.google.cacheControl`
 * (the field doesn't exist in the provider — only `cachedContent`, which is
 * a separate explicit-cache-resource feature). Gemini relies on implicit
 * caching, which prefix-matches automatically. So breakpoints here only
 * carry an `anthropic` key.
 */

import { estimateTokens } from './token-estimate.js';
import type { ModelMessage } from 'ai';

/**
 * Sentinel that marks the synthetic per-step user message carrying the
 * `<environment>` snapshot (and any one-shot nudge). Detection is
 * format-agnostic — `stripEphemeralMessages` only checks that the message's
 * text starts with this marker.
 */
const EPHEMERAL_MARKER = '<!-- de:ephemeral -->';

/**
 * Token growth required between consecutive rolling cache breakpoints.
 * Anthropic charges 1.25× base for cache writes and 0.1× for reads, so a
 * write is profitable only if it gets read at least ~1.4 more times. In a
 * 19-step loop, a breakpoint stamped at step 5 gets read by steps 6..19
 * (14 reads) — clear win. A breakpoint stamped at step 18 gets read once
 * — clear loss. Gating on growth (rather than on step count) keeps the
 * write near the front where the loop hasn't yet finished growing.
 *
 * 5K is roughly two `read_page` snapshots' worth of tool-result bytes.
 */
const BREAKPOINT_GROWTH_THRESHOLD = 5_000;

/** Wrap a snapshot in the `<environment>` envelope for model consumption. */
function wrapEnvironment(snapshot: string): string {
  return `<environment>\n${snapshot}\n</environment>`;
}

/**
 * Insert a fresh ephemeral message immediately before the latest user
 * message. Returns the input unchanged if `content` is empty or no user
 * message exists.
 */
function injectEphemeralMessage(messages: ModelMessage[], content: string): ModelMessage[] {
  if (!content) return messages;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return messages;
  const envMessage: ModelMessage = {
    role: 'user',
    content: `${EPHEMERAL_MARKER}\n${content}`,
  };
  return [...messages.slice(0, lastUserIdx), envMessage, ...messages.slice(lastUserIdx)];
}

/**
 * Drop every previously-injected ephemeral message (identified by the
 * sentinel marker on the first text). Idempotent: returns the original
 * array when nothing matches, so reference-equality short-circuits stay
 * valid.
 */
function stripEphemeralMessages(messages: ModelMessage[]): ModelMessage[] {
  let removed = false;
  const filtered = messages.filter(m => {
    if (m.role !== 'user') return true;
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content) && m.content.length > 0) {
      const first = m.content[0] as { type?: string; text?: string };
      if (first.type === 'text' && typeof first.text === 'string') text = first.text;
    }
    if (text.startsWith(EPHEMERAL_MARKER)) {
      removed = true;
      return false;
    }
    return true;
  });
  return removed ? filtered : messages;
}

/**
 * Stamp the Anthropic `cacheControl: ephemeral` marker on the assistant
 * message at `targetIdx`. No-op if the index is out of range or doesn't
 * point at an assistant message. Returns a new array only when the stamp
 * actually lands (so reference-equality short-circuits stay valid).
 */
function stampCacheBreakpoint(messages: ModelMessage[], targetIdx: number): ModelMessage[] {
  if (targetIdx < 0 || targetIdx >= messages.length) return messages;
  const target = messages[targetIdx];
  if (target.role !== 'assistant') return messages;
  const existing = (target as ModelMessage & { providerOptions?: Record<string, unknown> }).providerOptions ?? {};
  const merged: ModelMessage = {
    ...target,
    providerOptions: {
      ...existing,
      anthropic: { cacheControl: { type: 'ephemeral' as const } },
    },
  } as ModelMessage;
  return [...messages.slice(0, targetIdx), merged, ...messages.slice(targetIdx + 1)];
}

/**
 * Stateful per-run helper that owns the question "is the model's view of
 * the environment current?". The runner holds one instance per agent run
 * and calls `refresh()` from `prepareStep`. Tracks the most recently
 * injected snapshot HASH (not the full snapshot text) so a tab title
 * tweak doesn't churn the message reference and bust the prompt cache.
 */
export class BrowserStateRefresher {
  private lastInjectedHash: string | null = null;

  constructor(
    /** Returns the human-readable snapshot text shown to the model. */
    private readonly fetchSnapshot: () => Promise<string>,
    /**
     * Returns the equality key for the current state. Two snapshots
     * with the same hash are treated as identical and don't trigger
     * re-injection. Should exclude volatile fields (titles, query
     * strings) that don't change the model's available actions.
     */
    private readonly fetchHash: () => Promise<string>,
  ) {}

  /**
   * Compute a fresh snapshot, optionally append a one-shot `nudge` block
   * (e.g. the repetition guard's "switch tactic" reminder), and return a
   * new messages array with the synthetic ephemeral message rewritten.
   *
   * Returns the input array unchanged when:
   *   - the snapshot is empty AND no nudge is queued, or
   *   - the snapshot HASH equals the last one we injected AND no nudge
   *     is queued (cache short-circuit).
   *
   * Strips any prior ephemeral message before inserting the new one, so
   * blocks never accumulate.
   */
  async refresh(messages: ModelMessage[], nudge = ''): Promise<ModelMessage[]> {
    const [snapshot, hash] = await Promise.all([
      this.fetchSnapshot().catch(() => ''),
      this.fetchHash().catch(() => ''),
    ]);
    if (!snapshot && !nudge) return messages;
    if (!nudge && snapshot && hash && hash === this.lastInjectedHash) return messages;
    const stripped = stripEphemeralMessages(messages);
    const combined = [snapshot ? wrapEnvironment(snapshot) : '', nudge].filter(Boolean).join('\n\n');
    this.lastInjectedHash = hash || null;
    return injectEphemeralMessage(stripped, combined);
  }

  /** Synchronous primer for the case where the runner already injected
   * an ephemeral block once at startup and just wants the next
   * `refresh()` call to recognise that state as current. */
  prime(hash: string | null) {
    this.lastInjectedHash = hash;
  }
}

/**
 * Tracks where the rolling Anthropic cache breakpoint is currently
 * stamped and decides when to roll it forward.
 *
 * Strategy: ONE rolling breakpoint, growth-gated.
 *   - Combined with the static breakpoint on the system message, that's
 *     2 of Anthropic's 4-breakpoint per-request budget.
 *   - The breakpoint moves forward only when the prefix has grown by at
 *     least `BREAKPOINT_GROWTH_THRESHOLD` tokens since the last stamp,
 *     so we don't pay write cost without amortising it across reads.
 *   - On a fresh turn (no prior stamps) the first eligible assistant
 *     message gets stamped immediately so subsequent steps in the loop
 *     can read it.
 */
export class CacheBreakpointTracker {
  private lastStampedIdx: number = -1;
  private lastStampedTokens: number = 0;

  /**
   * Apply the rolling breakpoint to `messages`. Idempotent: returns the
   * input unchanged when the existing stamp is still the right answer.
   * `prepareStep` calls this every step; the cost is ~one `estimateTokens`
   * pass over the conversation, well under a millisecond.
   */
  apply(messages: ModelMessage[]): ModelMessage[] {
    const lastAssistantIdx = findLastAssistantIdx(messages);
    if (lastAssistantIdx === -1) return messages;

    // First call of the run: stamp immediately so the rest of the loop
    // can read this prefix.
    if (this.lastStampedIdx === -1) {
      this.lastStampedIdx = lastAssistantIdx;
      this.lastStampedTokens = estimateTokens(messages);
      return stampCacheBreakpoint(messages, lastAssistantIdx);
    }

    // Same target: keep the existing stamp by re-applying it. The SDK
    // rebuilds the messages array each step, so providerOptions don't
    // persist — we have to re-stamp to keep the breakpoint live.
    if (lastAssistantIdx === this.lastStampedIdx) {
      return stampCacheBreakpoint(messages, this.lastStampedIdx);
    }

    // Target moved (new assistant messages appended). Roll forward only
    // if growth threshold cleared.
    const currentTokens = estimateTokens(messages);
    if (currentTokens - this.lastStampedTokens < BREAKPOINT_GROWTH_THRESHOLD) {
      // Not enough new content to justify another cache write. Keep the
      // stamp at its old position so the prior write keeps paying off.
      return stampCacheBreakpoint(messages, this.lastStampedIdx);
    }

    this.lastStampedIdx = lastAssistantIdx;
    this.lastStampedTokens = currentTokens;
    return stampCacheBreakpoint(messages, lastAssistantIdx);
  }

  /**
   * Forget the current stamp. Required after the runner REBUILDS the
   * message array from scratch (overflow-recovery compaction): the stamped
   * index points into the dead array shape and would land on the wrong
   * message.
   */
  reset(): void {
    this.lastStampedIdx = -1;
    this.lastStampedTokens = 0;
  }
}

function findLastAssistantIdx(messages: ModelMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i;
  }
  return -1;
}
