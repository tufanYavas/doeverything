import type { BuiltInLlmProviderId, LlmProviderDescriptor } from './types.js';

/**
 * Static metadata about each LLM provider doeverything can use.
 *
 * The Options UI reads `label`/`requiresBaseUrl`/`capabilities` to render
 * the provider picker and capability badges. The agent loop reads
 * `capabilities` to decide whether to enable tool calling, vision, or
 * prompt caching.
 *
 * Model lists are NOT stored here anymore — they are fetched at runtime
 * via `listModels()` from `model-discovery.ts` and cached in
 * `discoveredModelsStorage`. Each entry below keeps a single
 * `defaultModel` as a bootstrap fallback so a fresh install has something
 * to send before the first discovery; the cache replaces it as soon as
 * the user clicks Refresh in the Options page.
 *
 * Adding a new provider = add an entry here and a case to `factory.ts`
 * (and to the dispatch in `model-discovery.ts` if it doesn't speak
 * OpenAI-compatible).
 */
export const PROVIDER_REGISTRY: Readonly<Record<BuiltInLlmProviderId, LlmProviderDescriptor>> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-opus-4.8',
    defaultFastModel: 'claude-haiku-4-5',
    fallbackModels: [
      'claude-opus-4.8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-fable-5',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: true, promptCache: true },
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-5.5',
    defaultFastModel: 'gpt-4.1-nano',
    fallbackModels: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5',
      'gpt-4.1',
      'gpt-4o',
      'o3',
      'o4-mini',
      'o3-mini',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: true, promptCache: false },
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    defaultModel: 'gemini-2.5-pro',
    defaultFastModel: 'gemini-2.5-flash-lite',
    fallbackModels: [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: true, promptCache: true },
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    defaultModel: 'openai/gpt-oss-120b',
    defaultFastModel: 'openai/gpt-oss-20b',
    fallbackModels: [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.6-27b',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: false, promptCache: false },
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    defaultModel: 'mistral-medium-3-5',
    defaultFastModel: 'ministral-3b-latest',
    fallbackModels: [
      'mistral-medium-3-5',
      'magistral-medium-2509',
      'magistral-small-2509',
      'mistral-large-latest',
      'mistral-small-latest',
      'ministral-8b-latest',
      'ministral-3b-latest',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: false, promptCache: false },
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    defaultModel: 'grok-4.3',
    defaultFastModel: 'grok-4.3',
    fallbackModels: [
      'grok-4.3',
      'grok-420-reasoning',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: true, promptCache: false },
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    defaultModel: 'gpt-oss-120b',
    defaultFastModel: 'llama3.1-8b',
    fallbackModels: [
      'zai-glm-4.7',
      'gpt-oss-120b',
      'llama-3.3-70b',
      'llama3.1-8b',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: false, promptCache: false },
  },
  togetherai: {
    id: 'togetherai',
    label: 'Together',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultFastModel: 'LiquidAI/LFM2-24B-A2B',
    fallbackModels: [
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      'deepseek-ai/DeepSeek-V3.1',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen3.5-9B',
      'LiquidAI/LFM2-24B-A2B',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: false, promptCache: false },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'anthropic/claude-fable-5',
    defaultFastModel: 'google/gemini-2.5-flash-lite',
    fallbackModels: [
      'anthropic/claude-fable-5',
      'openai/gpt-5.5',
      'google/gemini-2.5-pro',
      'anthropic/claude-opus-4-8',
      'openai/gpt-5',
      'google/gemini-2.5-flash',
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-4.1',
      'google/gemini-2.5-flash-lite',
      'openai/gpt-4.1-mini',
    ],
    requiresBaseUrl: false,
    capabilities: { streaming: true, tools: true, vision: true, promptCache: false },
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (custom)',
    // No defaults — the endpoint (and its model ids) are user-defined.
    defaultModel: '',
    requiresBaseUrl: true,
    capabilities: { streaming: true, tools: true, vision: false, promptCache: false },
  },
};

export const PROVIDER_LIST: ReadonlyArray<LlmProviderDescriptor> = Object.values(PROVIDER_REGISTRY);

export const isBuiltInProviderId = (value: unknown): value is BuiltInLlmProviderId =>
  typeof value === 'string' && value in PROVIDER_REGISTRY;
