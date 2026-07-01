/** doeverything storage shapes. */

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
 * Effective provider id stored in config. Built-in ids are listed above;
 * runtime-defined custom providers use the `custom:<slug>` form so the
 * factory can route them through `customProvidersStorage`.
 */
export type LlmProviderId = BuiltInLlmProviderId | (string & {});

/**
 * Optional secondary model used by helper tools that don't need the main
 * agent's reasoning power (currently `find`'s DOM-scanning LLM call).
 * Reuses the per-provider API key already in `apiKeys` (or the custom
 * provider's own key) — no separate credential storage. When `null` /
 * empty, helper tools fall back to the main `provider` + `model`.
 */
export interface FastModelConfig {
  provider: LlmProviderId;
  model: string;
}

export interface RecentModel {
  provider: LlmProviderId;
  /** Model id — empty string means the provider's default was used. */
  model: string;
}

export interface LlmConfigState {
  provider: LlmProviderId;
  /**
   * Per-provider chosen model id, keyed by provider id — the SAME scoping as
   * `apiKeys` and `baseUrls`, so a model picked for one provider can never be
   * sent to another. Read through `activeModel(cfg)`; empty → provider's
   * bootstrap `defaultModel`.
   */
  models: Record<string, string>;
  /**
   * Per-provider API keys keyed by provider id. Built-in providers store
   * keys here; custom providers store their own key inside the
   * `customProvidersStorage` record (so a user can keep multiple Fireworks
   * tenants, each with its own key).
   */
  apiKeys: Record<string, string>;
  /**
   * Per-provider base-URL override, keyed by provider id. Same scoping as
   * `apiKeys` / `models`, so an endpoint entered for one provider can never
   * be handed to another's SDK. Read through `activeBaseUrl(cfg)`; empty →
   * the provider's canonical endpoint.
   */
  baseUrls: Record<string, string>;
  /**
   * Optional fast/aux model. Can point to a different provider than the
   * main one — e.g. main = Opus, fast = Gemini Flash. `null` when
   * not configured; helpers fall back to the main model.
   */
  fastModel: FastModelConfig | null;
  /**
   * Up to 5 recently used provider+model combos that produced a successful
   * response, most recent first. Shown as quick-picks in the ModelSelector.
   */
  recentModels: RecentModel[];
}

export type PermissionMode = 'ask' | 'follow_a_plan' | 'allow_for_site' | 'skip_all_permission_checks';

export interface PreferencesState {
  permissionMode: PermissionMode;
  screenshotMode: 'auto' | 'always' | 'never';
  locale: string;
}

/**
 * State of the MCP connection.
 *
 * doeverything exposes its browser tools as an MCP server. The user pastes the
 * `connectorUrl` shown by the extension into their MCP client's custom
 * connector settings; from then on, the client runs the model and calls our
 * tools through the relay. We only hold
 * one persistent identity — the per-install `token` — and the live
 * WebSocket status.
 */
export interface ConnectionState {
  /** Persistent per-install token, embedded in the relay URL path. */
  token: string | null;
  /** Relay base URL, e.g. `https://relay.doeverythi.ng`. Null → use the build-time default. */
  relayBaseUrl: string | null;
  /** Last observed WebSocket status to the relay. */
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  /** Last error string, transient. */
  lastError: string | null;
  /** Epoch ms of last successful connect. */
  lastConnectedAt: number | null;
  /**
   * Whether the user has explicitly enabled the relay connection.
   * False by default — the bridge never auto-connects until the user
   * clicks Connect at least once.
   */
  userEnabled: boolean;
}
