import { doeDefaultsMiddleware } from './middleware.js';
import { isBuiltInProviderId, PROVIDER_REGISTRY } from './registry.js';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { wrapLanguageModel } from 'ai';
import type { BuiltInLlmProviderId, LlmProviderConfig, DoeLanguageModel } from './types.js';

/**
 * Wrap any provider-returned model with the doeverything defaults middleware
 * so every code path (`streamText`, `generateText`, `generateObject`)
 * inherits the same per-call settings. `wrapLanguageModel` requires the
 * provider's `LanguageModelV3` type, which `ai` doesn't re-export — we
 * introspect it from the function's own parameter type to avoid pulling
 * `@ai-sdk/provider` into our dependency graph.
 */
type WrapInput = Parameters<typeof wrapLanguageModel>[0]['model'];

function withDefaults(model: unknown): DoeLanguageModel {
  return wrapLanguageModel({
    model: model as WrapInput,
    middleware: doeDefaultsMiddleware,
  }) as DoeLanguageModel;
}

/**
 * Build a language model for the given config.
 *
 * Two paths:
 *
 *   1. Built-in providers (anthropic, openai, …) — switch on the literal
 *      id and call the matching @ai-sdk adapter.
 *   2. Custom providers (`provider` starts with `custom:`) — caller must
 *      supply `customProvider` with `kind` + `baseUrl` + `defaultModel`.
 *      Today only `openai-compat` is implemented (vLLM, Ollama, LM Studio,
 *      Fireworks, DeepInfra, Perplexity, Together, …); add another kind
 *      here when a new wire protocol shows up.
 *
 * All provider SDKs are imported statically because dynamic `import()` is
 * disallowed inside Chrome service workers (W3C ServiceWorker spec — see
 * https://github.com/w3c/ServiceWorker/issues/1356). Vite's tree-shaker
 * keeps unused providers out of consumer bundles, but the service-worker
 * bundle itself ends up holding every adapter. That's a few hundred KB of
 * extra code for a feature that lets the user pick any LLM at runtime —
 * a fair trade.
 */
export async function createLanguageModel(config: LlmProviderConfig): Promise<DoeLanguageModel> {
  // ───────── Custom providers (runtime-defined) ─────────
  if (!isBuiltInProviderId(config.provider)) {
    const custom = config.customProvider;
    if (!custom) {
      throw new Error(
        `doeverything: provider "${config.provider}" is not built-in and no customProvider details were supplied`,
      );
    }
    if (!custom.baseUrl) {
      throw new Error(`doeverything: custom provider "${config.provider}" is missing baseUrl`);
    }
    const model = config.model?.trim() || custom.defaultModel;
    if (!model) {
      throw new Error(`doeverything: no model specified for "${config.provider}"`);
    }
    const apiKey = config.apiKey?.trim() || 'sk-not-required';

    switch (custom.kind) {
      case 'openai-compat':
        // v6 split out OpenAI-compat into a dedicated package — the legacy
        // `compatibility: 'compatible'` flag on createOpenAI was removed.
        return withDefaults(
          createOpenAICompatible({
            name: config.provider,
            apiKey,
            baseURL: custom.baseUrl,
          })(model),
        );
      default: {
        const _exhaustive: never = custom.kind;
        throw new Error(`doeverything: unhandled custom provider kind "${_exhaustive as string}"`);
      }
    }
  }

  // ───────── Built-in providers ─────────
  const provider: BuiltInLlmProviderId = config.provider;
  const descriptor = PROVIDER_REGISTRY[provider];

  const apiKey = config.apiKey?.trim();
  if (!apiKey && provider !== 'openai-compatible') {
    throw new Error(`doeverything: missing API key for provider "${provider}"`);
  }

  const model = config.model?.trim() || descriptor.defaultModel;
  if (!model) {
    throw new Error(`doeverything: no model specified for provider "${provider}"`);
  }

  const baseURL = config.baseUrl?.trim() || undefined;
  if (descriptor.requiresBaseUrl && !baseURL) {
    throw new Error(`doeverything: provider "${provider}" requires a base URL`);
  }

  switch (provider) {
    case 'anthropic':
      // Anthropic's API blocks browser origins via CORS by default;
      // this header enables direct calls from within the extension.
      return withDefaults(
        createAnthropic({
          apiKey,
          baseURL,
          headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
        })(model),
      );
    case 'openai':
      return withDefaults(createOpenAI({ apiKey, baseURL })(model));
    case 'google':
      return withDefaults(createGoogleGenerativeAI({ apiKey, baseURL })(model));
    case 'groq':
      return withDefaults(createGroq({ apiKey, baseURL })(model));
    case 'mistral':
      return withDefaults(createMistral({ apiKey, baseURL })(model));
    case 'xai':
      return withDefaults(createXai({ apiKey, baseURL })(model));
    case 'cerebras':
      return withDefaults(createCerebras({ apiKey, baseURL })(model));
    case 'togetherai':
      return withDefaults(createTogetherAI({ apiKey, baseURL })(model));
    case 'openrouter':
      // appName/appUrl causes OpenRouter to set `X-OpenRouter-Title` and `HTTP-Referer`
      // headers. Optional, but provides attribution and lifts us out of the
      // anonymous traffic rate-limit tier.
      return withDefaults(
        createOpenRouter({
          apiKey,
          baseURL,
          appName: 'doeverything',
          appUrl: 'https://doeverythi.ng',
        })(model),
      );
    case 'openai-compatible':
      // Single-config OpenAI-compat mode (legacy). For multiple endpoints
      // each with its own key + label, use Custom Providers in Settings.
      // v6 routes this through @ai-sdk/openai-compatible (separate package).
      return withDefaults(
        createOpenAICompatible({
          name: 'openai-compatible',
          apiKey: apiKey || 'sk-not-required',
          baseURL: baseURL ?? '',
        })(model),
      );
    default: {
      const _exhaustive: never = provider;
      throw new Error(`doeverything: unhandled provider "${_exhaustive as string}"`);
    }
  }
}
