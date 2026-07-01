/**
 * Agent runner — coordinates a single user turn end-to-end.
 *
 * Responsibilities (and ONLY these):
 *   1. Resolve the active LLM provider config + build the language model.
 *   2. Compact the conversation if it's about to overflow the context window.
 *   3. Stamp the rolling cache breakpoint, prime the browser-state refresher,
 *      build the `ToolLoopAgent` via `createDoeAgent`.
 *   4. Drive `agent.stream({ messages, abortSignal })` with a malformed-call
 *      retry loop. Surface deltas / tool lifecycle / done / error to the
 *      port-bridge callbacks.
 *   5. Persist the transcript and update badge/indicator at the end.
 *
 * Everything else lives in a sibling module:
 *   - `factory.ts` builds the agent (stop conditions, prepareStep, callbacks).
 *   - `state.ts` owns the synthetic `<environment>` user-message lifecycle.
 *   - `stop-conditions.ts` exports `lastTwoStepsAreIdentical` (advisory).
 *   - `error-mapping.ts` normalises SDK errors into a UI-friendly shape.
 *   - `transcript.ts` accumulates per-run telemetry into one record.
 *
 * Cancellation: the caller's `AbortController` propagates to `agent.stream()`
 * AND to every in-flight tool's `signal` via `AgentToolContext`.
 */

import { clearCompactionRecord, getCompactionRecord, setCompactionRecord } from './compaction-cache.js';
import { buildSummaryMessage, buildSummaryRequest, selectCompactionBoundary, splitByCursor } from './compaction.js';
import { classifyContext, KEEP_TAIL_RATIO, resolveContextWindowSafe, TOOL_SCHEMA_OVERHEAD_TOKENS } from './context-budget.js';
import { lastUserPromptText, toModelMessages } from './conversion.js';
import { describeStreamError, describeUiMessage, isContextOverflowError } from './error-mapping.js';
import { buildMalformedRetryNudge, createDoeAgent } from './factory.js';
import { Indicator } from './indicator.js';
import { SkillListingRefresher } from './skill-refresher.js';
import { BrowserStateRefresher, CacheBreakpointTracker } from './state.js';
import {
  buildBrowserStateHash,
  buildEphemeralBrowserContext,
  buildSystemPrompt,
  DOE_SYSTEM_PROMPT,
} from './system-prompt.js';
import { estimateTextTokens, estimateTokens } from './token-estimate.js';
import { TranscriptCollector } from './transcript.js';
import { setBadge } from '../handlers/badge.js';
import { TaskLogger } from '../lib/task-logger.js';
import {
  buildPostCompactSkillMessages,
  consumePendingModelOverride,
  consumeSkillListing,
  getModelInvocableSkills,
} from '../skills/index.js';
import { telemetry } from '../telemetry.js';
import { createBrowserTools } from '../tools/browser-tools.js';
import { createToolContext } from '../tools/context.js';
import { resolveFastModel } from '../tools/internal/helpers.js';
import { createLanguageModel } from '@doeverything/llm-providers';
import { buildSkillListingMessage, formatSkillsWithinBudget } from '@doeverything/shared';
import {
  activeBaseUrl,
  activeModel,
  customIdFromProvider,
  customProvidersStorage,
  isCustomProviderId,
  llmConfigStorage,
} from '@doeverything/storage';
import { generateText } from 'ai';
import type { CompactionCacheRecord } from './compaction-cache.js';
import type { ChatMessageDTO } from './conversion.js';
import type { TranscriptToolSchema } from '../lib/task-logger.js';
import type { AgentToolContext } from '../tools/context.js';
import type { LlmProviderConfig, DoeLanguageModel } from '@doeverything/llm-providers';
import type { ModelMessage, ToolSet } from 'ai';

export interface AgentRunHandle {
  abort: () => void;
  done: Promise<void>;
}

export interface AgentRunCallbacks {
  onDelta: (text: string) => void;
  onToolStart: (call: { id: string; name: string; args: unknown }) => void;
  onToolEnd: (call: { id: string; name: string; result: unknown; isError: boolean }) => void;
  onCompaction?: (info: {
    stage: 'warn' | 'critical';
    estimatedTokens: number;
    contextWindow: number;
    summary: string;
  }) => void;
  /** `context` carries the run's final context size for the UI fill indicator. */
  onDone: (context?: { estimatedTokens: number; contextWindow: number }) => void;
  onError: (message: string) => void;
}

/**
 * Cap on consecutive malformed-function-call retries before we surface a
 * "model can't recover" error. Set generous because the user explicitly
 * does NOT want premature stops — only `done()` should end a run. We
 * still need a finite ceiling so a permanently broken provider doesn't
 * loop forever, but the model gets many chances to recover first.
 */
const MAX_MALFORMED_RETRIES = 10;

export function startAgentRun(
  conversationId: string,
  rawMessages: ChatMessageDTO[],
  callbacks: AgentRunCallbacks,
): AgentRunHandle {
  const controller = new AbortController();
  let aborted = false;
  // Plain-text view of the latest user message, used by TaskLogger.start
  // before tools are built (and therefore before the SDK conversion
  // runs). Avoids paying for an early UIMessage map just for telemetry.
  const promptText = lastUserPromptText(rawMessages);

  const done = (async () => {
    const runStartedAt = Date.now();
    let firstTokenAt: number | null = null;
    let runId: string | null = null;
    const transcript = new TranscriptCollector();
    const transcriptHandle = () => ({
      runId,
      conversationId,
      startedAt: runStartedAt,
      provider: providerLabel,
      model: modelLabel,
    });
    let providerLabel: string | undefined;
    let modelLabel: string | undefined;

    try {
      // ── Resolve LLM config ────────────────────────────────────────────
      const cfg = await llmConfigStorage.get();
      let llmConfig: LlmProviderConfig;
      let resolvedModel = activeModel(cfg);
      if (isCustomProviderId(cfg.provider)) {
        const slug = customIdFromProvider(cfg.provider);
        const custom = await customProvidersStorage.byId(slug);
        if (!custom) throw new Error(`Custom provider "${slug}" not found in storage`);
        resolvedModel = (activeModel(cfg) || custom.defaultModel || '').trim();
        llmConfig = {
          provider: cfg.provider,
          model: resolvedModel,
          apiKey: custom.apiKey,
          baseUrl: custom.baseUrl,
          customProvider: {
            kind: custom.kind,
            baseUrl: custom.baseUrl,
            defaultModel: custom.defaultModel,
          },
        };
      } else {
        llmConfig = {
          provider: cfg.provider,
          model: activeModel(cfg),
          apiKey: cfg.apiKeys[cfg.provider] ?? '',
          baseUrl: activeBaseUrl(cfg) || undefined,
        };
      }
      // ── Per-session model override from skill invocations ────────────
      // A skill that declared `model: ...` in its frontmatter takes effect
      // on the very next API turn after invocation. `consumePendingModelOverride`
      // returns the override exactly once per applySkillOverrides call.
      const modelOverride = await consumePendingModelOverride(conversationId);
      if (modelOverride) {
        llmConfig.model = modelOverride;
        resolvedModel = modelOverride;
      }

      providerLabel = cfg.provider;
      modelLabel = resolvedModel;

      runId = await TaskLogger.start({
        conversationId,
        prompt: promptText,
        provider: cfg.provider,
        model: resolvedModel,
      }).catch(() => null);

      const model: DoeLanguageModel = await createLanguageModel(llmConfig);

      // ── Build tool roster + per-run AgentToolContext ─────────────────
      // The wrapper fires UI lifecycle hooks from inside `execute()` so
      // start/end are bracketed on the same await chain — no orphan UI
      // chips when an SDK-rejected toolCall (unknown name / schema fail)
      // never reaches us.
      const toolContext = createToolContext(conversationId, controller.signal, {
        onToolStart: call => {
          transcript.noteToolStart(call);
          callbacks.onToolStart(call);
        },
        onToolEnd: call => {
          transcript.noteToolEnd(call);
          callbacks.onToolEnd(call);
        },
      });
      const tools = createBrowserTools(toolContext) as unknown as ToolSet;
      transcript.noteTools(
        Object.entries(tools).map(([name, t]) => {
          const desc = (t as { description?: unknown }).description;
          return {
            name,
            description: typeof desc === 'string' ? desc : undefined,
          } satisfies TranscriptToolSchema;
        }),
      );

      // ── Guarantee a seed tab before building any tab context ─────────
      // Seed adoption from the toolbar click is fire-and-forget, so the
      // first turn can otherwise reach `<available_tabs>` before the tab
      // is grouped (the "availableTabs: []" symptom). This awaits the
      // (coalesced) adoption so the very first system prompt is populated.
      await toolContext.groups.ensureSeedTab();

      // ── System prompt (built first — its size feeds the compaction gate)
      const systemPrompt = await buildSystemPrompt({ conversationId }).catch(() => DOE_SYSTEM_PROMPT);
      transcript.noteSystem(systemPrompt);

      // ── Context window of the ACTIVE model ────────────────────────────
      // Resolved AFTER the skill model-override so it reflects the model
      // that will actually serve the run.
      const contextWindow = await resolveContextWindowSafe(cfg.provider, resolvedModel || llmConfig.model);
      console.debug('[doeverything] context window', contextWindow, cfg.provider, resolvedModel);

      // ── Persistent compaction: summary + cursor substitution ─────────
      // The panel resends the FULL history every turn (and keeps showing
      // it); the model conversation substitutes [stored summary + DTOs
      // after the cursor]. The summary string is reused verbatim across
      // turns so messages[0] stays byte-stable for the cache prefix.
      const record = await getCompactionRecord(conversationId);
      const split = splitByCursor(rawMessages, record);
      if (record && !split.cursorValid) {
        // Mid-history edit / unknown cursor — the record is unusable.
        await clearCompactionRecord(conversationId);
      }
      const activeRecord = split.cursorValid ? record : null;

      // ── Chat-store → ModelMessage[] via the SDK pipeline ─────────────
      // Runs AFTER tools are built so each tool's `toModelOutput` hook
      // shapes persisted results the same way the live turn does
      // (`__doe_image` → vision-capable `image-data` parts, etc.).
      // The SDK's `convertToModelMessages` with `ignoreIncompleteToolCalls`
      // is what guarantees tool_use/tool_result pairing across providers —
      // hand-rolled converters silently shipped orphans whenever the
      // run was interrupted between `tool-start` and `tool-end`.
      const tailModel = await toModelMessages(split.tail, tools);

      // ── Compact (incrementally) when the window is under pressure ────
      const { messages: compactedHistory, summaryActive } = await ensureCompacted({
        conversationId,
        rawTail: split.tail,
        tailModel,
        record: activeRecord,
        systemPromptTokens: estimateTextTokens(systemPrompt),
        contextWindow,
        tools,
        signal: controller.signal,
        callbacks,
      });

      // Whenever a summary message is present (this turn's fold OR a
      // reused one), re-inject the bodies of any skills the model invoked
      // earlier so their rules survive the summarized region. The skill
      // log is session-persisted, so this output is stable across turns.
      const compacted = summaryActive ? await injectPostCompactSkills(compactedHistory, conversationId) : compactedHistory;

      // The state refresher owns "is the model's view of the environment
      // current?". Hash-based change detection (tabId × origin only) so a
      // tab title tweak doesn't churn the prefix. Prime with the current
      // hash so the first `prepareStep` short-circuits when state is fresh.
      const stateRefresher = new BrowserStateRefresher(buildEphemeralBrowserContext, buildBrowserStateHash);
      const initialHash = await buildBrowserStateHash().catch(() => '');
      const stateRefreshed = await stateRefresher.refresh(compacted);

      // ── Per-turn skill listing ────────────────────────────────────────
      // Emits a `<system-reminder>` user-meta message catalogue of the
      // skills the agent can invoke right now. Full listing fires once per
      // conversation; subsequent turns re-emit only newly added skills.
      // Filtered by `domains` glob against the active tab so per-site
      // skills only surface where they apply.
      const initialMessages = await injectSkillListing(stateRefreshed, conversationId, toolContext, contextWindow);

      stateRefresher.prime(initialHash || null);
      transcript.noteMessages(initialMessages);

      // Mid-turn skill re-injection: when the agent NAVIGATES during the loop
      // (page A → x.com), surface skills scoped to the destination that the
      // turn-start listing above couldn't know about. Primed with the current
      // URL so the first `prepareStep` is a no-op (those skills are already in
      // `initialMessages`); fires only once the active URL actually changes.
      const skillRefresher = new SkillListingRefresher(conversationId, contextWindow, () =>
        getActiveTabUrl(toolContext),
      );
      skillRefresher.prime(await getActiveTabUrl(toolContext));

      // The breakpoint tracker owns the rolling Anthropic cache breakpoint.
      // Growth-gated: re-stamps only when the prefix has grown ≥5K tokens
      // since the last stamp, so we don't pay write cost (1.25× input)
      // without amortising it across reads. Lives across the agent loop;
      // `prepareStep` calls `apply()` every step.
      const breakpointTracker = new CacheBreakpointTracker();

      let messagesForApi = initialMessages;
      // Per-step observer state; reset before each retry attempt.
      let lastStepHadOutput = false;
      let lastFinishReason: string | undefined;
      let producedOutputThisRun = false;

      // Real prompt size of the latest completed step, when the provider
      // reports usage — feeds the UI's context-fill indicator on done.
      let lastContextTokens: number | undefined;

      const agent = createDoeAgent({
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
        runId: () => runId,
        onStepFinishObserver: ({ hadOutput, finishReason, contextTokens }) => {
          lastStepHadOutput = hadOutput;
          if (hadOutput) producedOutputThisRun = true;
          if (finishReason) lastFinishReason = finishReason;
          if (typeof contextTokens === 'number') lastContextTokens = contextTokens;
        },
        onFinishObserver: ({ finishReason }) => {
          if (finishReason) lastFinishReason = finishReason;
        },
      });

      // ── Surface UI ─────────────────────────────────────────────────
      await Indicator.show();
      await setBadge('running');
      telemetry.track('agent.start', { provider: cfg.provider, model: activeModel(cfg) || '(default)' });

      // ── Stream loop with malformed-call retry ──────────────────────
      let streamError: unknown = null;
      let malformedRetries = 0;
      let overflowRecoveryUsed = false;

      retryLoop: while (true) {
        streamError = null;
        producedOutputThisRun = false;
        lastStepHadOutput = false;
        lastFinishReason = undefined;

        const result = await agent.stream({
          messages: messagesForApi,
          abortSignal: controller.signal,
        });

        try {
          for await (const delta of result.textStream) {
            if (aborted) break;
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              if (runId) {
                void TaskLogger.mergeMetrics(runId, { firstTokenLatencyMs: firstTokenAt - runStartedAt });
              }
            }
            if (delta.length > 0) producedOutputThisRun = true;
            transcript.noteResponseDelta(delta);
            callbacks.onDelta(delta);
          }
        } catch (err) {
          // The textStream iterator throws on context-overflow / 5xx /
          // tool-result-schema failures (the same surface as
          // `streamText`'s `onError` callback). Capturing here covers
          // both stream-time errors and any that surface after the
          // last delta.
          if (!(controller.signal.aborted || aborted)) {
            streamError = err;
            const info = describeStreamError(err);
            console.error('[doeverything] stream error', info, err);
            telemetry.track('agent.error', {
              type: info.type,
              statusCode: info.statusCode,
              message: info.message.slice(0, 200),
            });
          }
        }

        // Decision tree for what to do after the agent.stream() call ends.
        if (controller.signal.aborted || aborted) break retryLoop;
        if (streamError) {
          // Context overflow gets ONE in-run recovery attempt: fold
          // everything before the final user turn into the persisted
          // summary and restart the turn against the compacted view.
          // (Tool work from this run's earlier steps lives in SDK-internal
          // response messages and is not reliably recoverable after a
          // thrown stream — the turn restarts from the user prompt.)
          const info = describeStreamError(streamError);
          if (isContextOverflowError(info) && !overflowRecoveryUsed) {
            overflowRecoveryUsed = true;
            console.warn('[doeverything] context overflow — forcing aggressive compaction and retrying once');
            telemetry.track('agent.overflow_recovery', { provider: cfg.provider });
            const rebuilt = await forceCompactForOverflow({
              conversationId,
              rawMessages,
              tools,
              signal: controller.signal,
            }).catch(err => {
              if (controller.signal.aborted || aborted) throw err;
              console.warn('[doeverything] overflow recovery failed', err);
              return null;
            });
            if (rebuilt) {
              // The stamped breakpoint index points into the dead array
              // shape after a rebuild — reset before re-streaming.
              breakpointTracker.reset();
              messagesForApi = await stateRefresher.refresh(rebuilt);
              transcript.noteMessages(messagesForApi);
              streamError = null;
              continue retryLoop;
            }
          }
          break retryLoop;
        }
        const tooManyRetries = malformedRetries >= MAX_MALFORMED_RETRIES;
        // KEY decision: did the FINAL step have output? Yes → loop ended
        // normally. No → the model crashed at the tail; retry with nudge.
        if (lastStepHadOutput || tooManyRetries) break retryLoop;

        malformedRetries++;
        const reasonLabel = lastFinishReason ?? 'unknown';
        const isMidLoop = producedOutputThisRun;
        console.warn(
          `[doeverything] ${isMidLoop ? 'mid-loop' : 'turn-start'} empty step (finishReason=${reasonLabel}) — retrying with corrective reminder (${malformedRetries}/${MAX_MALFORMED_RETRIES})`,
        );
        telemetry.track('agent.malformed_retry', {
          attempt: malformedRetries,
          finishReason: reasonLabel,
          midLoop: isMidLoop,
        });
        messagesForApi = [...messagesForApi, buildMalformedRetryNudge(isMidLoop, reasonLabel)];
        transcript.noteMessages(messagesForApi);
      }

      // ── Outcome dispatch ────────────────────────────────────────────
      if (streamError && !aborted && !controller.signal.aborted) {
        const info = describeStreamError(streamError);
        const uiMessage = describeUiMessage(info);
        transcript.noteError(info);
        callbacks.onError(uiMessage);
        await setBadge('error');
        if (runId) await TaskLogger.finish(runId, 'error', uiMessage);
        await transcript.persist(transcriptHandle());
        return;
      }

      if (!lastStepHadOutput && !aborted && !controller.signal.aborted) {
        const reasonLabel = lastFinishReason ?? 'unknown';
        const isMidLoop = producedOutputThisRun;
        const uiMessage =
          (isMidLoop
            ? `The agent crashed at the tail of a ${malformedRetries + 1}-attempt retry loop ` +
              `(finishReason=${reasonLabel}). Earlier tool calls in this turn ran fine, but every ` +
              `attempt to wrap up the work ended in a malformed response. `
            : `The model returned ${malformedRetries + 1} empty / malformed response${malformedRetries + 1 === 1 ? '' : 's'} ` +
              `in a row (finishReason=${reasonLabel}). `) +
          `The provider rejected the response — usually because the model tried to bundle many ` +
          `actions into one tool call instead of using the tool-call protocol one step at a time. ` +
          `Try rephrasing the request, breaking it into smaller steps, or switching to a different ` +
          `model in Options.`;
        transcript.noteSyntheticError('EmptyResponse', uiMessage, reasonLabel);
        callbacks.onError(uiMessage);
        await setBadge('error');
        if (runId) await TaskLogger.finish(runId, 'error', uiMessage);
        await transcript.persist(transcriptHandle());
        return;
      }

      callbacks.onDone({
        estimatedTokens:
          lastContextTokens ??
          estimateTokens(messagesForApi) + estimateTextTokens(systemPrompt) + TOOL_SCHEMA_OVERHEAD_TOKENS,
        contextWindow,
      });
      await setBadge('idle');
      if (runId) await TaskLogger.finish(runId, 'success');
      await transcript.persist(transcriptHandle());
    } catch (err) {
      if (controller.signal.aborted || aborted) {
        transcript.ensureFinishReason('aborted');
        callbacks.onDone();
        await setBadge('idle');
        if (runId) await TaskLogger.finish(runId, 'aborted');
        await transcript.persist(transcriptHandle());
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error('[doeverything] agent run failed', err);
      transcript.noteSyntheticError(err instanceof Error ? err.name : 'Error', message, 'error');
      callbacks.onError(message);
      await setBadge('error');
      if (runId) await TaskLogger.finish(runId, 'error', message);
      await transcript.persist(transcriptHandle());
    } finally {
      await Indicator.hide();
    }
  })();

  return {
    abort: () => {
      aborted = true;
      controller.abort();
    },
    done,
  };
}

interface EnsureCompactedOptions {
  conversationId: string;
  /** Panel DTOs AFTER the persisted cursor (full history when no record). */
  rawTail: ChatMessageDTO[];
  /** `rawTail` converted to ModelMessages (tool hooks applied). */
  tailModel: ModelMessage[];
  record: CompactionCacheRecord | null;
  systemPromptTokens: number;
  contextWindow: number;
  tools: ToolSet;
  signal: AbortSignal;
  callbacks: AgentRunCallbacks;
}

/**
 * Steady-state compaction driver.
 *
 *   - Window pressure 'ok' → return `[stored summary? + tail]` with NO LLM
 *     call. This is the cache-hit path: the summary string is reused
 *     verbatim, so messages[0] is byte-identical to the previous turn and
 *     the provider's prompt-cache prefix survives.
 *   - Pressure 'warn'/'critical' → fold older tail DTOs into the summary
 *     (incremental MERGE with the previous one, generated on the fast
 *     model), persist the new record, and return the rebuilt history.
 *   - Summary failure → log and continue uncompacted; the overflow
 *     recovery in the retry loop is the backstop.
 */
async function ensureCompacted(opts: EnsureCompactedOptions): Promise<{
  messages: ModelMessage[];
  summaryActive: boolean;
}> {
  const { conversationId, rawTail, tailModel, record, systemPromptTokens, contextWindow, tools, signal, callbacks } =
    opts;

  const base = record ? [buildSummaryMessage(record.summary), ...tailModel] : tailModel;
  const estimated = estimateTokens(base) + systemPromptTokens + TOOL_SCHEMA_OVERHEAD_TOKENS;
  const stage = classifyContext(estimated, contextWindow);
  if (stage === 'ok') {
    if (record) {
      console.debug(`[doeverything] compaction cache hit generation=${record.generation} (summary reused)`);
    }
    return { messages: base, summaryActive: record !== null };
  }

  const boundary = selectCompactionBoundary(rawTail, Math.floor(contextWindow * KEEP_TAIL_RATIO));
  if (boundary === 0) return { messages: base, summaryActive: record !== null };

  const folded = await foldIntoSummary({ conversationId, rawTail, boundary, previousRecord: record, signal });
  if (!folded) return { messages: base, summaryActive: record !== null };

  callbacks.onCompaction?.({ stage, estimatedTokens: estimated, contextWindow, summary: folded.summary });
  telemetry.track('agent.compaction', { stage, estimatedTokens: estimated, generation: folded.generation });
  console.debug(`[doeverything] compaction fold generation=${folded.generation} (${boundary} messages folded)`);

  const keptModel = await toModelMessages(rawTail.slice(boundary), tools);
  return { messages: [buildSummaryMessage(folded.summary), ...keptModel], summaryActive: true };
}

/**
 * Generate (or incrementally merge) the summary on the fast model and
 * persist the updated compaction record. Returns null on failure so
 * callers can degrade gracefully; rethrows on abort so the runner's
 * aborted path handles it.
 */
async function foldIntoSummary(opts: {
  conversationId: string;
  rawTail: ChatMessageDTO[];
  boundary: number;
  previousRecord: CompactionCacheRecord | null;
  signal: AbortSignal;
}): Promise<CompactionCacheRecord | null> {
  const { conversationId, rawTail, boundary, previousRecord, signal } = opts;
  const toFold = rawTail.slice(0, boundary);
  if (toFold.length === 0) return null;
  const request = buildSummaryRequest({ previousSummary: previousRecord?.summary ?? null, toFold });

  let summary = '';
  try {
    const summaryModel = await resolveFastModel();
    const result = await generateText({
      model: summaryModel,
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: 2_000,
      abortSignal: signal,
    });
    summary = result.text.trim();
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn('[doeverything] compaction summary failed', err);
    return null;
  }
  if (!summary) return null;

  const next: CompactionCacheRecord = {
    conversationId,
    summary,
    cursorMessageId: toFold[toFold.length - 1].id,
    coveredCount: (previousRecord?.coveredCount ?? 0) + toFold.length,
    summaryTokens: estimateTextTokens(summary),
    generation: (previousRecord?.generation ?? 0) + 1,
    updatedAt: Date.now(),
  };
  await setCompactionRecord(next);
  return next;
}

/**
 * Overflow recovery: keep ONLY the final user turn; everything before it
 * gets merged into the persisted summary (so the NEXT turn benefits too).
 * Returns the rebuilt model conversation (with post-compact skill
 * rehydration applied), or null when nothing can be folded / the summary
 * model also fails — in which case the original error surfaces unchanged.
 */
async function forceCompactForOverflow(opts: {
  conversationId: string;
  rawMessages: ChatMessageDTO[];
  tools: ToolSet;
  signal: AbortSignal;
}): Promise<ModelMessage[] | null> {
  const { conversationId, rawMessages, tools, signal } = opts;
  const record = await getCompactionRecord(conversationId);
  const split = splitByCursor(rawMessages, record);
  const activeRecord = split.cursorValid ? record : null;
  const tail = split.tail;

  let lastUserIdx = -1;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (tail[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) return null;

  const folded = await foldIntoSummary({
    conversationId,
    rawTail: tail,
    boundary: lastUserIdx,
    previousRecord: activeRecord,
    signal,
  });
  if (!folded) return null;

  const keptModel = await toModelMessages(tail.slice(lastUserIdx), tools);
  return injectPostCompactSkills([buildSummaryMessage(folded.summary), ...keptModel], conversationId);
}

/**
 * After a compaction, the summary message lives at `messages[0]`. We re-emit
 * any skill bodies the model invoked earlier in this session so their rules
 * survive — inserted right after the summary, before the kept turns.
 */
async function injectPostCompactSkills(messages: ModelMessage[], conversationId: string): Promise<ModelMessage[]> {
  const skillMessages = await buildPostCompactSkillMessages(conversationId);
  if (skillMessages.length === 0) return messages;
  const skillModelMessages: ModelMessage[] = skillMessages.map(s => ({
    role: 'user',
    content: s.content,
  }));
  // Compaction produces `[summary, ...toKeep]`; insert skills right after.
  return [messages[0], ...skillModelMessages, ...messages.slice(1)];
}

/** Resolve the active tab's URL (the source skill/memory URL-filtering uses).
 *  Returns undefined when there's no resolvable active tab. */
async function getActiveTabUrl(toolContext: AgentToolContext): Promise<string | undefined> {
  try {
    const tabId = await toolContext.getEffectiveTabId();
    const tab = await chrome.tabs.get(tabId);
    return tab?.url;
  } catch {
    return undefined;
  }
}

/**
 * Builds the per-turn skill catalogue and inserts it as a user-meta
 * `<system-reminder>` immediately before the latest user message. Emits
 * the FULL listing once per session, then only newly added skills on
 * subsequent turns. Filtered by `domains` glob against the active tab.
 */
async function injectSkillListing(
  messages: ModelMessage[],
  conversationId: string,
  toolContext: AgentToolContext,
  contextWindow: number,
): Promise<ModelMessage[]> {
  const currentUrl = await getActiveTabUrl(toolContext);
  const invocable = await getModelInvocableSkills(currentUrl).catch(() => []);
  const { newSkills } = await consumeSkillListing(conversationId, invocable);
  if (newSkills.length === 0) return messages;
  const formatted = formatSkillsWithinBudget(newSkills, contextWindow);
  if (!formatted) return messages;
  const reminder: ModelMessage = {
    role: 'user',
    content: buildSkillListingMessage(formatted),
  };
  // Insert right before the latest user message so the model reads it as
  // immediate context. If there's no user message at the tail (resumed
  // session, etc.), append at the end.
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      return [...messages.slice(0, i), reminder, ...messages.slice(i)];
    }
  }
  return [...messages, reminder];
}
