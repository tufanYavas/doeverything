/**
 * `createDoeAgent` — assembles a `ToolLoopAgent` configured for the
 * doeverything browser-driving use case. The runner owns the per-run state
 * (transcript, retry budget, abort signal) and pipes it in via the deps;
 * everything model/loop-related lives here.
 *
 * Why a factory and not a wrapper class:
 * - `ToolLoopAgent` is intentionally a thin compose layer over `streamText`
 *   (the SDK's `class ToolLoopAgent` body is roughly `streamText({ ...await
 *   this.prepareCall(options), abortSignal, onStepFinish })`). The SDK's
 *   recommended pattern is "construct an Agent with all settings".
 *   Re-wrapping it would just hide the canonical surface.
 * - All per-run mutable state (the `BrowserStateRefresher` instance, the
 *   `TranscriptCollector`, retry counters) belongs to the runner and is
 *   injected here. The factory has no fields of its own.
 */

import { pruneThreshold } from './context-budget.js';
import { lastTwoStepsAreIdentical } from './stop-conditions.js';
import { estimateTokens } from './token-estimate.js';
import { TaskLogger } from '../lib/task-logger.js';
import { telemetry } from '../telemetry.js';
import { estimateResultSize } from '../tools/truncate.js';
import { ToolLoopAgent, hasToolCall, pruneMessages, stepCountIs } from 'ai';
import type { SkillListingRefresher } from './skill-refresher.js';
import type { CacheBreakpointTracker, BrowserStateRefresher } from './state.js';
import type { TranscriptCollector } from './transcript.js';
import type { AgentToolContext } from '../tools/context.js';
import type { LanguageModel, ModelMessage, SystemModelMessage, ToolSet } from 'ai';

/**
 * Hard absolute ceiling on tool-call rounds per user turn. The agent is
 * expected to terminate via `done()`; this is only a runaway safety so a
 * pathological model can't chew through token budget indefinitely. Set
 * generous because the user explicitly does NOT want premature stops —
 * only `done()` should end a run.
 */
export const MAX_STEPS = 200;

/**
 * Tools whose output is a *snapshot of mutable state* — DOM, screenshot,
 * tab list, network log. When the prefix gets large enough that we need
 * to make room, older snapshots can be pruned (only the most recent is
 * still meaningful). Anthropic's computer-use-demo disables this pruning
 * entirely while caching is active because mid-prefix mutation breaks the
 * cache; we follow the same logic and only prune past the soft window
 * threshold (`pruneThreshold(contextWindow)` — 60% of the model's window).
 *
 * Anti-list — tools NOT eligible for pruning because every call returns
 * fresh / non-redundant info: `run_js`,
 * `inspect_network_request`, `replay_network_request`, `find`,
 * `find_elements`, and every action tool (navigate, click_at_coord, …).
 *
 * Keep in sync with the tool roster in `chrome-extension/src/background/
 * tools/browser-tools.ts`.
 */
const SNAPSHOT_TOOLS: string[] = [
  'read_page',
  'screenshot',
  'read_network_requests',
  'tabs_list',
  'tabs_context',
];

export interface DoeAgentDeps {
  /** Provider-resolved model (already wrapped with default settings). */
  model: LanguageModel;
  /** Tool roster — typed loosely because the runner uses one shared shape. */
  tools: ToolSet;
  /** Resolved system prompt text. */
  systemPrompt: string;
  /** Conversation id for telemetry. */
  conversationId: string;
  /**
   * Resolved context window of the ACTIVE model (tokens). Snapshot pruning
   * starts at `pruneThreshold(contextWindow)` (60%) — below that, the
   * cache-prefix benefit of stable history is worth more than the ~5K
   * tokens stubbing one snapshot saves; above it, window pressure
   * dominates and we accept the cache miss to stay alive. Compaction
   * kicks in around 75% (see context-budget.ts).
   */
  contextWindow: number;
  /** Per-step browser-state injector. */
  stateRefresher: BrowserStateRefresher;
  /** Per-step mid-turn skill re-injector (surfaces skills for pages the
   *  agent navigates to during the loop). */
  skillRefresher: SkillListingRefresher;
  /** Per-step rolling cache breakpoint owner. */
  breakpointTracker: CacheBreakpointTracker;
  /** Transcript accumulator — observability only. */
  transcript: TranscriptCollector;
  /** Tool execution context (shared with the wrapped tools). */
  toolContext: AgentToolContext;
  /** Mutable run id created by `TaskLogger.start`; used for tool-call notes. */
  runId: () => string | null;
  /** Notified when `onStepFinish` records a step (for malformed-retry decisions). */
  onStepFinishObserver: (event: {
    hadOutput: boolean;
    finishReason: string | undefined;
    /** Real prompt+output size of the step when the provider reported usage. */
    contextTokens?: number;
  }) => void;
  /** Notified when `onFinish` fires so the runner can short-circuit cleanup paths. */
  onFinishObserver: (event: { finishReason: string | undefined }) => void;
}

/**
 * Build a `ToolLoopAgent` ready for `agent.stream({ messages, abortSignal })`
 * calls. The returned agent is single-use per logical agent run — its
 * settings close over the deps you pass in.
 */
export function createDoeAgent(deps: DoeAgentDeps): ToolLoopAgent<never, ToolSet, never> {
  const {
    model,
    tools,
    systemPrompt,
    conversationId,
    contextWindow,
    stateRefresher,
    skillRefresher,
    breakpointTracker,
    transcript,
    toolContext,
    runId,
    onStepFinishObserver,
    onFinishObserver,
  } = deps;

  const pruneTokenThreshold = pruneThreshold(contextWindow);

  // The system prompt holds only stable session-scoped sections so it stays
  // cache-friendly. The synthetic `<environment>` message lands AFTER the
  // breakpoint so the cache hits on every prior turn even when tabs change.
  //
  // Only Anthropic carries an explicit cache breakpoint here. Gemini's
  // `@ai-sdk/google` provider has no `cacheControl` field — the closest
  // analogue is `cachedContent` (an explicit cache-resource id, separate
  // feature). Setting `google.cacheControl` is silently ignored, so we
  // omit it. Gemini relies on implicit prompt-prefix caching, which is
  // automatic when the prefix is stable.
  const instructions: SystemModelMessage = {
    role: 'system',
    content: systemPrompt,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' as const } },
    },
  };

  return new ToolLoopAgent({
    model,
    tools,
    instructions,
    // Two-layer stop policy. Per the user's explicit preference, the loop
    // should ONLY end when the agent emits the `done()` signal — no
    // heuristic stop based on repetition or "looks stuck". The step ceiling
    // remains as a runaway-safety against an infinitely looping model.
    //   • stepCountIs — absolute ceiling on the loop length.
    //   • hasToolCall — terminate the moment the agent emits its
    //                   structured "I'm done" call, so the SDK doesn't
    //                   give the model another step to start narrating.
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('done')],
    // Custom data passed to every tool's `execute()` via the SDK's native
    // `experimental_context` channel. We keep the AgentToolContext shape
    // stable; tools read from it rather than from a closure.
    experimental_context: toolContext,
    // Per-step ephemeral refresh + cache management. Three jobs in one
    // hook, ordered for cache stability:
    //   (1) Snapshot pruning — TOKEN-GATED at 60% of the model's window.
    //       Below the threshold we leave snapshots verbatim because mid-prefix mutation
    //       (stubbing an old `read_page` result when a newer one arrives)
    //       breaks every prefix-cache from that point onward — costing
    //       far more in cache misses than the ~5K tokens we'd save.
    //       Above the threshold, context-window pressure dominates and
    //       we accept the cache miss. Anthropic's own computer-use-demo
    //       disables this pruning entirely while caching is active.
    //   (2) Rolling cache breakpoint — owned by `CacheBreakpointTracker`.
    //       Growth-gated: a new breakpoint moves forward only when the
    //       prefix has grown by ≥5K tokens since the last one. Per-step
    //       stamping (the naive approach) is ~35% MORE expensive than no
    //       caching at all on a single 19-step turn.
    //   (3) Browser state refresh — strip the prior synthetic ephemeral
    //       message and inject a fresh `<environment>` snapshot (+ any
    //       repetition nudge). Hash-based change detection so tab title
    //       changes don't churn the prefix.
    prepareStep: async ({ messages: stepMessages, steps }) => {
      if (toolContext.signal.aborted) return undefined;

      // (1) Snapshot pruning, only when the prefix is approaching the
      // soft context window. Below the threshold we KEEP snapshots so
      // the prefix-cache hit pays for itself many times over.
      const sizedForPruning = estimateTokens(stepMessages) > pruneTokenThreshold;
      const pruned = sizedForPruning
        ? pruneMessages({
            messages: stepMessages,
            toolCalls: [{ type: 'before-last-message', tools: SNAPSHOT_TOOLS }],
          })
        : stepMessages;

      // (2) Re-stamp the rolling breakpoint. The SDK rebuilds the
      // messages array each step (see `streamText`'s `stepInputMessages =
      // [...initialMessages, ...responseMessages]`), so providerOptions
      // don't persist — we have to re-apply every step.
      const breakpointed = breakpointTracker.apply(pruned);

      // (3) Repetition nudge: if the last two steps were identical, hint
      // the model to switch tactic. This is advisory only — the loop no
      // longer auto-aborts on repetition; only `done()` ends a run.
      const repeat = lastTwoStepsAreIdentical(steps);
      const nudge = repeat.identical
        ? `<system-reminder>\n` +
          `You just called \`${repeat.toolName}\` twice in a row with identical arguments. The output is not changing — repeating the same call again will NOT help. Either:\n` +
          `  (1) switch to a different tool (e.g. \`read_page\` to refresh the DOM, \`find_elements\` to locate something specific, \`screenshot\` to verify the rendered state), or\n` +
          `  (2) call \`done({ text, success: false })\` with what you have so far and a short explanation of what's blocking you.\n` +
          `</system-reminder>`
        : '';

      const refreshed = await stateRefresher.refresh(breakpointed, nudge);

      // (4) Mid-turn skill re-injection. If the agent navigated to a page
      // with its own scoped skills since the turn started, surface them now
      // (re-injected every step so they survive the SDK's message rebuild).
      const withSkills = await skillRefresher.refresh(refreshed);
      return withSkills === stepMessages ? undefined : { messages: withSkills };
    },
    // If a tool's args fail Zod validation, the AI SDK by default throws
    // and ends the run. We log but pass through (return null) so the model
    // sees the synthetic error and self-corrects on the next step.
    experimental_repairToolCall: async ({ toolCall, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[doeverything] tool call repair', toolCall.toolName, message);
      return null;
    },
    onStepFinish: step => {
      // Telemetry only — UI lifecycle (`onToolStart` / `onToolEnd`) fires
      // from inside the tool wrapper itself so start/end are bracketed on
      // the same await chain. That way an SDK-rejected toolCall (unknown
      // name, schema failure, repair returns null) NEVER reaches
      // `onToolStart`, so it never produces an orphan UI chip.
      type StepCall = { toolCallId: string; toolName: string };
      type StepResultPart = {
        toolCallId: string;
        toolName: string;
        output?: unknown;
        result?: unknown;
      };
      const calls = step.toolCalls ?? [];
      const results = step.toolResults ?? [];
      const stepText = step.text ?? '';
      const finishReason = step.finishReason;
      // Real per-step usage when the provider reports it — the last step's
      // input+output is the true context size of this run, far more
      // accurate than any estimate. Consumed by the runner for the UI's
      // context-fill indicator.
      const stepInput = step.usage?.inputTokens;
      const stepOutput = step.usage?.outputTokens;
      const contextTokens =
        typeof stepInput === 'number' && Number.isFinite(stepInput)
          ? stepInput + (typeof stepOutput === 'number' && Number.isFinite(stepOutput) ? stepOutput : 0)
          : undefined;
      onStepFinishObserver({
        hadOutput: calls.length > 0 || stepText.trim().length > 0,
        finishReason,
        contextTokens,
      });
      for (const call of calls) telemetry.track('tool.start', { name: call.toolName, conversationId });
      for (const tr of results) {
        // Wire-size breadcrumb: surfaces ballooning tool outputs in the
        // logs *before* they push the request past the model's context
        // window. The wrapper already truncates, but a tool that grows
        // its result family over time shows up here as a rising trend.
        const size = estimateResultSize(tr.output);
        if (size > 30_000) {
          console.warn(
            `[doeverything] tool "${tr.toolName}" returned a large result (${size.toLocaleString()} chars after truncation)`,
          );
        }
        telemetry.track('tool.end', { name: tr.toolName, conversationId, size });
        const id = runId();
        if (id) void TaskLogger.noteToolCall(id, tr.toolName, true);
      }
    },
    onFinish: async event => {
      const usage = event?.totalUsage ?? event?.usage;
      const finishReason = event?.finishReason;
      transcript.noteFinishReason(finishReason);
      transcript.noteUsage({
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens,
        cacheCreationInputTokens: usage?.inputTokenDetails?.cacheWriteTokens,
      });
      onFinishObserver({ finishReason });
      const id = runId();
      if (id) {
        await TaskLogger.mergeMetrics(id, {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          totalTokens: usage?.totalTokens,
          cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens,
          cacheCreationInputTokens: usage?.inputTokenDetails?.cacheWriteTokens,
        }).catch(() => undefined);
      }
    },
  });
}

/**
 * Prefab `user`-role nudge appended after a malformed-function-call retry.
 * Distinguishes turn-start failures (whole run was a wash) from mid-loop
 * failures (earlier steps ran fine, only the last step crashed) so the
 * model knows what specifically to fix.
 */
export function buildMalformedRetryNudge(isMidLoop: boolean, finishReason: string): ModelMessage {
  const opener = isMidLoop
    ? `Your last step in this turn produced no tool call and no text (finishReason=${finishReason}). ` +
      `Earlier steps ran fine, but the tail of the loop crashed — this almost always means you ` +
      `tried to wrap multiple actions in a single Python / JavaScript pseudo-script ` +
      `(e.g. a for-loop containing \`default_api.navigate(...)\` then \`default_api.run_js(...)\` ` +
      `then \`default_api.done(...)\`). The provider rejected that as a malformed function call.\n`
    : `Your previous response produced no tool call and no text (finishReason=${finishReason}). ` +
      `This usually means the provider rejected the response as a malformed function call, the ` +
      `tool-call payload was unparsable, or you tried to bundle multiple actions in one shot.\n`;

  return {
    role: 'user',
    content:
      `<system-reminder>\n` +
      opener +
      `\n` +
      `Recover by following the tool-call protocol strictly:\n` +
      `  1. Emit exactly ONE real tool call this turn through the SDK's native tool API.\n` +
      `  2. Do NOT write any code, pseudo-code, or scripts that appear to invoke tools — ` +
      `no \`default_api.x(...)\`, no \`tools.foo(...)\`, no for-loops over tool calls, ` +
      `no Python / JavaScript / shell blocks intended as commands. Those are silently ` +
      `dropped.\n` +
      `  3. If the user's task is complete, call \`done({ text, success })\` as a SINGLE proper ` +
      `tool call (not inside a print()/log() expression). If not complete, pick the smallest ` +
      `next step (e.g. one navigate or one run_js) and emit ONLY that. The agent loop ` +
      `will give you another turn afterwards.\n` +
      `\n` +
      `Continue the user's task now with one proper tool call.\n` +
      `</system-reminder>`,
  };
}
