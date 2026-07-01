import { isBuiltInProviderId } from './registry.js';
import type { BuiltInLlmProviderId, LlmProviderId } from './types.js';

/**
 * Runtime model discovery — fetches each provider's `/models` endpoint so
 * the Options UI can populate the model picker without hardcoded lists.
 *
 * Most providers expose an OpenAI-compatible `GET /v1/models` returning
 * `{ data: [{ id }] }`. Anthropic uses the same shape but a different auth
 * header. Google Gemini uses a separate `models/` array with capability
 * tags. OpenRouter is OpenAI-compatible and works without a key.
 *
 * The Options page calls this directly — Chrome extension host permissions
 * (`<all_urls>` in manifest) bypass page-level CORS, so cross-origin fetches
 * succeed from extension contexts. Errors are surfaced as plain `Error`s
 * with the provider's response status/text for the UI to render.
 */

export interface ListModelsOptions {
  apiKey: string;
  /** Override base URL (custom proxies, openai-compatible endpoints). */
  baseUrl?: string;
  /** Abort signal — wired to a timeout in the UI layer. */
  signal?: AbortSignal;
}

export interface DiscoveredModels {
  /** Model ids the provider returned. Order preserved. */
  models: string[];
  /** Provider's preferred default if it surfaces one (rare). */
  defaultModel?: string;
  /**
   * modelId → input context window (tokens), when the /models endpoint
   * reports it (Google: inputTokenLimit; OpenRouter/Together and some
   * openai-compatible servers: context_length). Absent when the provider
   * exposes nothing — the agent falls back to a static pattern table.
   */
  contextWindows?: Record<string, number>;
}

const BUILTIN_BASE_URLS: Record<BuiltInLlmProviderId, string | null> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  togetherai: 'https://api.together.xyz/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  // openai-compatible has no built-in base — caller must supply one.
  'openai-compatible': null,
};

/**
 * Public entry point. Routes a built-in id to its provider-specific fetcher
 * or, for `openai-compatible` / unknown ids, falls back to the generic
 * OpenAI-compat fetcher against `opts.baseUrl`.
 */
export async function listModels(provider: LlmProviderId, opts: ListModelsOptions): Promise<DiscoveredModels> {
  if (!isBuiltInProviderId(provider)) {
    if (!opts.baseUrl) {
      throw new Error(`Custom provider "${provider}" needs a base URL to list models`);
    }
    return listOpenAICompatModels(opts.baseUrl, opts);
  }

  switch (provider) {
    case 'anthropic':
      return listAnthropicModels(opts);
    case 'google':
      return listGoogleModels(opts);
    case 'openai':
      return filterOpenAIChat(await listOpenAICompatModels(opts.baseUrl ?? BUILTIN_BASE_URLS.openai!, opts));
    case 'openai-compatible':
      if (!opts.baseUrl) {
        throw new Error('OpenAI-compatible provider needs a base URL to list models');
      }
      return listOpenAICompatModels(opts.baseUrl, opts);
    case 'groq':
    case 'mistral':
    case 'xai':
    case 'cerebras':
    case 'togetherai':
    case 'openrouter':
      return listOpenAICompatModels(opts.baseUrl ?? BUILTIN_BASE_URLS[provider]!, opts);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown built-in provider "${_exhaustive as string}"`);
    }
  }
}

/**
 * Generic OpenAI-style `/models` fetcher. Used for OpenAI itself and every
 * built-in that speaks the same wire format (Groq, Mistral, xAI, …).
 *
 * The base URL is expected to already include the API version (`/v1`); this
 * function appends `/models`. Both `https://x/v1` and `https://x/v1/` work.
 */
export async function listOpenAICompatModels(baseUrl: string, opts: ListModelsOptions): Promise<DiscoveredModels> {
  const url = joinUrl(baseUrl, 'models');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok) throw await asError(res, baseUrl);
  // Most OpenAI-compat providers return `{ data: [...] }`. Together AI
  // (and a few others) return the array directly at the top level, so
  // accept both shapes. OpenRouter/Together (and some self-hosted servers)
  // also report `context_length` per model — collect it when present so
  // the agent's compaction gates can use the exact window.
  type CompatModelEntry = { id?: string; context_length?: number };
  const json = (await res.json()) as { data?: CompatModelEntry[] } | CompatModelEntry[];
  const list = Array.isArray(json) ? json : (json.data ?? []);
  const models: string[] = [];
  const contextWindows: Record<string, number> = {};
  for (const m of list) {
    const id = m?.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    models.push(id);
    const window = m?.context_length;
    if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
      contextWindows[id] = Math.floor(window);
    }
  }
  return Object.keys(contextWindows).length > 0 ? { models, contextWindows } : { models };
}

async function listAnthropicModels(opts: ListModelsOptions): Promise<DiscoveredModels> {
  if (!opts.apiKey) throw new Error('Anthropic requires an API key to list models');
  const url = joinUrl(opts.baseUrl ?? BUILTIN_BASE_URLS.anthropic!, 'v1/models');
  const res = await fetch(url, {
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic's API blocks browser-origin requests by default; this header
      // opts the request in. Extension contexts are still browser fetches.
      'anthropic-dangerous-direct-browser-access': 'true',
      Accept: 'application/json',
    },
    signal: opts.signal,
  });
  if (!res.ok) throw await asError(res, url);
  const json = (await res.json()) as {
    data?: Array<{ id?: string; type?: string }>;
  };
  const models = (json.data ?? [])
    .filter(m => !m.type || m.type === 'model')
    .map(m => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return { models };
}

async function listGoogleModels(opts: ListModelsOptions): Promise<DiscoveredModels> {
  if (!opts.apiKey) throw new Error('Google Gemini requires an API key to list models');
  const base = opts.baseUrl ?? BUILTIN_BASE_URLS.google!;
  const url = `${joinUrl(base, 'models')}?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: opts.signal });
  if (!res.ok) throw await asError(res, base);
  const json = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }>;
  };
  const models: string[] = [];
  // Keyed by the STRIPPED id (`models/` prefix removed) — the same form the
  // user's config stores, so runtime lookups by model id match.
  const contextWindows: Record<string, number> = {};
  for (const m of json.models ?? []) {
    if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
    const id = m?.name?.replace(/^models\//, '');
    if (typeof id !== 'string' || id.length === 0) continue;
    models.push(id);
    if (typeof m.inputTokenLimit === 'number' && Number.isFinite(m.inputTokenLimit) && m.inputTokenLimit > 0) {
      contextWindows[id] = Math.floor(m.inputTokenLimit);
    }
  }
  return Object.keys(contextWindows).length > 0 ? { models, contextWindows } : { models };
}

/**
 * OpenAI's `/models` returns embeddings, TTS, image, and moderation models
 * alongside chat-capable ones. The picker only feeds chat-completions calls
 * so we drop everything else by id prefix. New chat families (`gpt-`, `o\d`,
 * `chatgpt-`) are matched generously; if a future family slips through, the
 * user can still type the id manually.
 */
function filterOpenAIChat(d: DiscoveredModels): DiscoveredModels {
  const re = /^(gpt|o\d|chatgpt)/i;
  const models = d.models.filter(id => re.test(id));
  if (!d.contextWindows) return { ...d, models };
  const surviving = new Set(models);
  const contextWindows: Record<string, number> = {};
  for (const [id, window] of Object.entries(d.contextWindows)) {
    if (surviving.has(id)) contextWindows[id] = window;
  }
  return {
    ...d,
    models,
    contextWindows: Object.keys(contextWindows).length > 0 ? contextWindows : undefined,
  };
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path.slice(1) : path;
  return `${b}/${p}`;
}

async function asError(res: Response, context: string): Promise<Error> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    // ignore
  }
  const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
  return new Error(`Models endpoint failed (${res.status} ${res.statusText}) at ${context}${snippet ? `: ${snippet}` : ''}`);
}
