/**
 * doeverything LLM provider abstraction.
 *
 * The runtime never imports a provider SDK directly — it asks for a
 * language model by id, and the factory in `factory.ts` resolves it via the
 * Vercel AI SDK. This keeps the agent loop, tool runner, and UI completely
 * decoupled from "which model is talking right now."
 */

import type { LanguageModel } from 'ai';

export type BuiltInLlmProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'cerebras'
  | 'togetherai'
  | 'openrouter'
  | 'openai-compatible';

/**
 * Provider id stored in user config. Built-ins listed above; custom
 * providers stored in `customProvidersStorage` use the `custom:<slug>`
 * form. The factory (`factory.ts`) routes both transparently.
 */
export type LlmProviderId = BuiltInLlmProviderId | (string & {});

export interface LlmProviderDescriptor {
  /** Stable identifier used in storage and env. */
  id: LlmProviderId;
  /** Human-readable label for the Options UI. */
  label: string;
  /**
   * Bootstrap default model id — used until the user runs model discovery
   * (`listModels` from `model-discovery.ts`) and a fresher list is cached
   * in `discoveredModelsStorage`. Once the user fetches, the cache wins.
   * Empty for providers without a sane fallback (e.g. openai-compatible).
   */
  defaultModel: string;
  /**
   * Curated static model list, newest first, shown in the model picker
   * when the user hasn't run discovery yet. Kept short (key models only);
   * the live /models endpoint fills in the rest after a Refresh.
   */
  fallbackModels?: string[];
  /**
   * Cheap/light model used for helper calls (page search, conversation
   * summaries) when the user hasn't configured an explicit fast model.
   * Reuses the provider's main API key. Empty/absent for providers where
   * no universal cheap model exists (openai-compatible endpoints).
   */
  defaultFastModel?: string;
  /**
   * Whether this provider needs a base URL (e.g. openai-compatible / self-host).
   * Other providers can still accept `baseURL` overrides for proxies.
   */
  requiresBaseUrl: boolean;
  /** Capability hints; the agent loop reads these to gate features. */
  capabilities: {
    streaming: boolean;
    tools: boolean;
    /** Provider supports an image content block in user messages. */
    vision: boolean;
    /** Provider supports prompt caching (Anthropic, Google) — agent uses it. */
    promptCache: boolean;
  };
}

/**
 * When `provider` is a custom id (`custom:<slug>`), the caller resolves the
 * stored details and passes them through here so the factory stays free of
 * any storage dependency.
 */
export interface CustomProviderResolved {
  kind: 'openai-compat';
  baseUrl: string;
  defaultModel: string;
}

export interface LlmProviderConfig {
  provider: LlmProviderId;
  /** Model id (e.g. `claude-opus-4-7`, `gpt-5-codex`). Empty → provider default. */
  model: string;
  apiKey: string;
  /** Optional. Provider-specific override (proxies, self-hosted, openrouter). */
  baseUrl?: string;
  /** Required when `provider` starts with `custom:`. Resolved by the caller. */
  customProvider?: CustomProviderResolved;
}

/**
 * The factory returns the SDK's canonical `LanguageModel` union — the same
 * type accepted by every `ai` entry point (`streamText`, `generateText`,
 * `generateObject`, `wrapLanguageModel`). Pinning to a specific
 * `LanguageModelVN` would force us to chase spec-version churn; using the
 * re-exported alias tracks whatever the installed SDK considers current.
 */
export type DoeLanguageModel = LanguageModel;
