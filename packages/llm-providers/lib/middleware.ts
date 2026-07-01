/**
 * doeverything-wide language model defaults, expressed as a Vercel AI SDK
 * middleware. Wrapped onto every model returned by `createLanguageModel`,
 * so any caller (`streamText`, `generateText`, `generateObject`) inherits
 * the same per-call settings without re-stating them.
 *
 * Why a middleware instead of inlining at each call site:
 *   - One source of truth. The runner used to set `maxOutputTokens` and
 *     `providerOptions.google.thinkingConfig` inline; compaction
 *     (`generateText`) and workflow generation (`generateObject`) didn't —
 *     so they could blow past sensible budgets. The middleware fixes that.
 *   - Merge semantics. `defaultSettingsMiddleware` deep-merges via the
 *     SDK's `mergeObjects(settings, params)`: defaults supply the floor,
 *     a caller that explicitly sets the same key wins. So a one-off
 *     `streamText({ maxOutputTokens: 16_000 })` for a long-form summary
 *     still works.
 *   - Tree-shake friendly. Each provider keeps its own typings; the
 *     middleware only adds shared call options, never re-implements the
 *     provider contract.
 */

import { defaultSettingsMiddleware } from 'ai';
import type { LanguageModelMiddleware } from 'ai';

/**
 * Hard cap on output tokens per model call. The 62,910-thinking-token
 * MAX_TOKENS blowout we saw in production was unbounded reasoning; this
 * prevents a model that drifted into "echo raw JSON" mode from eating the
 * whole budget before the agent loop notices. 8K covers normal `done.text`
 * payloads with room to spare; long-form callers can opt out by passing a
 * larger explicit value.
 */
export const doeverything_MAX_OUTPUT_TOKENS = 8_192;

/**
 * Gemini-only knob. Default is "dynamic" thinking which can spend 60K+
 * tokens on a single step for free-form reasoning that doesn't actually
 * help a tool-calling loop. 2048 is a value that works well for ReAct
 * agents per Google's own samples. `includeThoughts: false`
 * keeps the cache prefix small. Other providers ignore the
 * `providerOptions.google` block harmlessly.
 */
export const GEMINI_THINKING_BUDGET = 2_048;

/**
 * Single shared middleware applied to every doeverything language model.
 * Currently wraps `defaultSettingsMiddleware` only; if we add more
 * cross-cutting behaviour (logging, retry, caching) it composes here.
 */
export const doeDefaultsMiddleware: LanguageModelMiddleware = defaultSettingsMiddleware({
  settings: {
    maxOutputTokens: doeverything_MAX_OUTPUT_TOKENS,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: GEMINI_THINKING_BUDGET,
          includeThoughts: false,
        },
      },
    },
  },
});
