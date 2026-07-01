import { PermissionManager } from '../../permissions/manager.js';
import { isSkillAllowedTool } from '../../skills/runtime-overrides.js';
import { createLanguageModel, isBuiltInProviderId, PROVIDER_REGISTRY } from '@doeverything/llm-providers';
import {
  activeBaseUrl,
  activeModel,
  customIdFromProvider,
  customProvidersStorage,
  isCustomProviderId,
  llmConfigStorage,
} from '@doeverything/storage';
import type { AgentToolContext } from '../context.js';
import type { LlmConfigState } from '@doeverything/storage';

/**
 * Wraps `PermissionManager.ensure` with skill-granted bypass.
 *
 * If the active doeverything conversation has had a skill fire whose
 * `allowed-tools` frontmatter listed this kind (or a tool that maps to
 * it), the gate is skipped — the session-scoped allow-list is owned by
 * `applySkillOverrides` / `isSkillAllowedTool` in
 * `background/skills/runtime-overrides.ts`.
 */
export async function gateOnHost(
  ctx: AgentToolContext,
  tabId: number,
  kind: Parameters<typeof PermissionManager.ensure>[1],
  opts: { reason?: string; preview?: string; toolName?: string } = {},
) {
  // MCP sessions have no permission UI — skip the interactive prompt entirely.
  // The user explicitly opted in to MCP, which serves as the blanket consent.
  if (ctx.isMcpSession) return;
  // Skill-granted bypass: match on the gate `kind` first (most skills list
  // gate names like 'navigate', 'click', 'type'), then on the tool name as
  // a fallback (so `allowed-tools: [computer]` covers the 'click' gate).
  if (await isSkillAllowedTool(ctx.conversationId, kind)) return;
  if (opts.toolName && (await isSkillAllowedTool(ctx.conversationId, opts.toolName))) return;
  const tab = await chrome.tabs.get(tabId);
  const host = tab.url ? PermissionManager.hostFromUrl(tab.url) : '*';
  await PermissionManager.ensure(host, kind, opts);
}

/**
 * Resolve a `[N]` ref id to viewport coordinates by scrolling it into view
 * via the MAIN-world DOM walker (`___oadp.getElement`). Mirrors the reference
 * `scrollToRefElement` helper. Returns `{ ok, x, y }` on success, or
 * `{ ok: false, error }` describing why resolution failed (most often: the
 * agent didn't call `read_page` first, so the selectorMap is empty).
 */
export async function scrollRefIntoView(
  tabId: number,
  ref: string,
): Promise<{ ok: true; x: number; y: number; href?: string } | { ok: false; error: string }> {
  try {
    const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [ref],
      func: (refId: string) => {
        const win = window as Window & {
          ___oadp?: { getElement: (id: number) => HTMLElement | null };
        };
        if (!win.___oadp || typeof win.___oadp.getElement !== 'function') {
          return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
        }
        const id = parseInt(refId, 10);
        if (Number.isNaN(id)) return { ok: false as const, error: `Invalid ref "${refId}".` };
        const el = win.___oadp.getElement(id);
        if (!el) {
          return {
            ok: false as const,
            error: `No element found for ref [${id}]. The DOM may have changed; call \`read_page\` again to refresh refs.`,
          };
        }
        try {
          el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center', inline: 'center' });
          // Force reflow so getBoundingClientRect reads the post-scroll layout.
          void (el as HTMLElement).offsetHeight;
        } catch {
          /* ignore */
        }
        const rect = el.getBoundingClientRect();
        const anchorEl = el.tagName === 'A' ? el : el.closest('a');
        const href =
          anchorEl &&
          'href' in anchorEl &&
          typeof anchorEl.href === 'string' &&
          !anchorEl.href.startsWith('javascript:')
            ? anchorEl.href
            : undefined;
        return {
          ok: true as const,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          href,
        };
      },
    });
    if (!result) return { ok: false, error: 'No result from page script' };
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildTabContext(
  ctx: AgentToolContext,
  executedOnTabId: number,
): Promise<{
  currentTabId: number;
  executedOnTabId: number;
  availableTabs: Array<{ tabId: number; title: string; url: string }>;
  tabCount: number;
}> {
  const tabs = await ctx.listGroupTabs();
  const current = tabs.find(t => t.active)?.id ?? tabs[0]?.id ?? executedOnTabId;
  return {
    currentTabId: current,
    executedOnTabId,
    availableTabs: tabs.map(t => ({ tabId: t.id, title: t.title, url: t.url })),
    tabCount: tabs.length,
  };
}

/**
 * Per-tab screenshot context that maps model-returned coordinates measured
 * against the most recent optimised screenshot back into viewport CSS-pixel
 * space.
 *
 *   scaleX = viewportWidth  / screenshotWidth
 *   scaleY = viewportHeight / screenshotHeight
 *
 * The LLM reads coordinates off the resized image (e.g. 1479×832) and
 * returns them in THAT pixel grid. The page's mouse APIs
 * (`Input.dispatchMouseEvent`, `document.elementFromPoint`) operate in
 * viewport CSS-pixel space (e.g. 1920×1080). `mapScreenshotToViewport`
 * does the inverse-scale. globalThis-keyed so an SW eviction replaying
 * the singleton doesn't lose the mapping mid-conversation.
 *
 * INVARIANT: every tool that takes a `coordinate` from the model MUST
 * map through `mapScreenshotToViewport` (or the `applyCoordScale`
 * convenience wrapper) before invoking page-side mouse APIs.
 */
export interface ScreenshotContext {
  viewportWidth: number;
  viewportHeight: number;
  screenshotWidth: number;
  screenshotHeight: number;
}

function screenshotContextMap(): Map<number, ScreenshotContext> {
  const G = globalThis as unknown as { __doe_screenshot_ctx?: Map<number, ScreenshotContext> };
  if (!G.__doe_screenshot_ctx) G.__doe_screenshot_ctx = new Map();
  return G.__doe_screenshot_ctx;
}

function isScreenshotContext(v: unknown): v is ScreenshotContext {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['viewportWidth'] === 'number' &&
    typeof obj['viewportHeight'] === 'number' &&
    typeof obj['screenshotWidth'] === 'number' &&
    typeof obj['screenshotHeight'] === 'number'
  );
}

export const screenshotContextStore = {
  setContext(tabId: number, ctx: ScreenshotContext): void {
    if (ctx.viewportWidth > 0 && ctx.viewportHeight > 0 && ctx.screenshotWidth > 0 && ctx.screenshotHeight > 0) {
      screenshotContextMap().set(tabId, ctx);
      // Persist so coordinate clicks work even after SW eviction between screenshot and click.
      void chrome.storage.session.set({ [`doe_sctx_${tabId}`]: ctx }).catch(() => {});
    }
  },
  async getContext(tabId: number): Promise<ScreenshotContext | undefined> {
    const cached = screenshotContextMap().get(tabId);
    if (cached) return cached;
    try {
      const key = `doe_sctx_${tabId}`;
      const stored = await chrome.storage.session.get(key);
      const entry = stored[key];
      if (isScreenshotContext(entry)) {
        screenshotContextMap().set(tabId, entry);
        return entry;
      }
    } catch {
      // chrome.storage unavailable in test environment
    }
    return undefined;
  },
  clearContext(tabId: number): void {
    screenshotContextMap().delete(tabId);
    void chrome.storage.session.remove(`doe_sctx_${tabId}`).catch(() => {});
  },
};

/**
 * Given a screenshot-space coordinate, return viewport CSS-pixel space.
 * Returns rounded integers because `Input.dispatchMouseEvent` and
 * `document.elementFromPoint` both snap to integers.
 */
export function mapScreenshotToViewport(
  screenshotX: number,
  screenshotY: number,
  ctx: ScreenshotContext,
): { x: number; y: number } {
  const scaleX = ctx.viewportWidth / ctx.screenshotWidth;
  const scaleY = ctx.viewportHeight / ctx.screenshotHeight;
  return { x: Math.round(screenshotX * scaleX), y: Math.round(screenshotY * scaleY) };
}

/**
 * Coordinate-space families that vision models output, with the
 * known-vendor list per family. Each family converts to viewport CSS
 * pixels with a *different* denormalisation formula. Refs:
 *
 *   - `pixel` — image-pixel space, 1:1 with the screenshot grid. The
 *     classical case; nothing special needed beyond
 *     `mapScreenshotToViewport`.
 *     • **Anthropic Claude** (computer-use docs:
 *       https://docs.anthropic.com/en/docs/build-with-claude/computer-use)
 *     • **OpenAI GPT-4o / GPT-5** (prompt-driven; falls back to pixel
 *       when the tool description says "pixel grid").
 *     • **xAI Grok**, **Meta Llama Vision**, **Mistral Pixtral** —
 *       no public coord-space contract; default to pixel and rely on
 *       the tool description.
 *
 *   - `norm-1000` — coordinates on a 0–1000 grid, training-baked.
 *     Formula:  pixel = (coord / 1000) × image_dim
 *     • **Google Gemini 3+** (https://ai.google.dev/gemini-api/docs/computer-use,
 *       https://geminibyexample.com/007-bounding-boxes)
 *     • **Alibaba Qwen-VL / Qwen2-VL / Qwen3-VL**
 *       (https://github.com/QwenLM/Qwen3-VL/issues/1486)
 *
 *   - `norm-999` — coordinates on a 0–999 grid (off-by-one variant).
 *     Formula:  pixel = (coord / 999) × image_dim
 *     • **DeepSeek-VL2**
 *       (https://github.com/deepseek-ai/DeepSeek-VL2 — `[0, 999]` range)
 *
 *   - `norm-unit` — coordinates as floats in [0, 1].
 *     Formula:  pixel = coord × image_dim
 *     • **Moonshot Kimi-VL**
 *       (https://github.com/MoonshotAI/Kimi-VL/issues/56 — bbox_2d
 *       returned as `[0.280, 0.500, …]`)
 *
 * The detection is **model-id-based**, not provider-id-based, because
 * users frequently access these models through gateways (OpenRouter,
 * Vertex, OpenAI-compatible proxies, custom endpoints). The gateway
 * doesn't change the model's training-baked coord output — only the
 * underlying weights do. So `cfg.model.includes('qwen-vl')` is a
 * stronger signal than `cfg.provider`.
 */
type CoordSystem = 'pixel' | 'norm-1000' | 'norm-999' | 'norm-unit';

/**
 * Cached coord-system detection. Provider/model rarely changes
 * mid-task; a 5-second TTL keeps the hot click path off `chrome.storage`
 * while still picking up settings changes within seconds.
 */
const COORD_SYSTEM_CACHE_TTL_MS = 5_000;
async function detectCoordSystem(): Promise<CoordSystem> {
  const G = globalThis as unknown as {
    __doe_coord_system_cache?: { system: CoordSystem; expires: number };
  };
  const now = Date.now();
  if (G.__doe_coord_system_cache && G.__doe_coord_system_cache.expires > now) {
    return G.__doe_coord_system_cache.system;
  }
  const cfg = await llmConfigStorage.get();
  const model = activeModel(cfg).toLowerCase();
  let system: CoordSystem;
  // Gemini family: built-in provider OR any gateway whose model id
  // contains "gemini" (OpenRouter, Vertex, etc.).
  if (cfg.provider === 'google' || /gemini/i.test(model)) {
    system = 'norm-1000';
  }
  // Qwen-VL family: any "qwen" model with a "-vl" suffix (Qwen-VL,
  // Qwen2-VL, Qwen3-VL, Qwen2.5-VL, …). Plain Qwen text models don't
  // match — they don't output coords.
  else if (/qwen[\d.-]*-?vl/i.test(model)) {
    system = 'norm-1000';
  }
  // DeepSeek-VL family: 0-999 grid (off-by-one).
  else if (/deepseek[\w-]*-vl/i.test(model)) {
    system = 'norm-999';
  }
  // Kimi-VL family: [0, 1] float grid.
  else if (/kimi[\w-]*-vl/i.test(model)) {
    system = 'norm-unit';
  } else {
    // Default: pixel space. Covers Claude, GPT, Grok, Llama Vision,
    // Pixtral, InternVL, and anything else not explicitly listed.
    // If a future model needs special handling, add a branch above.
    system = 'pixel';
  }
  G.__doe_coord_system_cache = { system, expires: now + COORD_SYSTEM_CACHE_TTL_MS };
  return system;
}

/**
 * Convert a model-returned coord into viewport CSS pixels per the
 * detected coord system. Goes directly to viewport (skipping the
 * screenshot intermediate) because viewport_size already accounts for
 * DPR adjustments — saves a rounding step versus a two-stage transform.
 */
function denormaliseByCoordSystem(
  modelX: number,
  modelY: number,
  ctx: ScreenshotContext,
  system: CoordSystem,
): { x: number; y: number } {
  switch (system) {
    case 'norm-1000':
      return {
        x: Math.round((modelX / 1000) * ctx.viewportWidth),
        y: Math.round((modelY / 1000) * ctx.viewportHeight),
      };
    case 'norm-999':
      return {
        x: Math.round((modelX / 999) * ctx.viewportWidth),
        y: Math.round((modelY / 999) * ctx.viewportHeight),
      };
    case 'norm-unit':
      return {
        x: Math.round(modelX * ctx.viewportWidth),
        y: Math.round(modelY * ctx.viewportHeight),
      };
    case 'pixel':
      return mapScreenshotToViewport(modelX, modelY, ctx);
  }
}

/**
 * Look up the latest screenshot context for `tabId` and map the model's
 * coord into viewport space, applying the per-model coord-system
 * conversion (Gemini/Qwen 0-1000, DeepSeek 0-999, Kimi 0-1 float, or
 * native pixel). If no screenshot has been taken yet (no context),
 * pass-through with integer rounding — there's nothing to scale against.
 */
export async function applyCoordScale(
  tabId: number,
  coord: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const ctx = await screenshotContextStore.getContext(tabId);
  if (!ctx) return { x: Math.round(coord.x), y: Math.round(coord.y) };
  const system = await detectCoordSystem();
  return denormaliseByCoordSystem(coord.x, coord.y, ctx, system);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolve the currently configured LLM into a Vercel AI SDK `LanguageModelV1`.
 * Mirrors the resolution logic used by `runner.ts` so in-tool LLM calls (e.g.
 * the `find` tool's semantic search) hit the same provider/model the agent is
 * already using.
 */
export async function resolveActiveModel() {
  const cfg = await llmConfigStorage.get();
  if (isCustomProviderId(cfg.provider)) {
    const slug = customIdFromProvider(cfg.provider);
    const custom = await customProvidersStorage.byId(slug);
    if (!custom) throw new Error(`Custom provider "${slug}" not found in storage`);
    return createLanguageModel({
      provider: cfg.provider,
      model: (activeModel(cfg) || custom.defaultModel || '').trim(),
      apiKey: custom.apiKey,
      baseUrl: custom.baseUrl,
      customProvider: { kind: custom.kind, baseUrl: custom.baseUrl, defaultModel: custom.defaultModel },
    });
  }
  return createLanguageModel({
    provider: cfg.provider,
    model: activeModel(cfg),
    apiKey: cfg.apiKeys[cfg.provider] ?? '',
    baseUrl: activeBaseUrl(cfg) || undefined,
  });
}

/**
 * Resolve the user's optional fast/aux model — the cheaper, lighter model
 * helper tools (the `find` DOM scanner, conversation summaries) prefer
 * when they don't need full agent reasoning. Behaviour:
 *
 *   1. If `cfg.fastModel` is set with a model id → build it, reusing the
 *      same per-provider API key the user already entered for the main
 *      config (or the custom provider's stored key).
 *   2. If it's unset (the user never opted in / forgot) → use the ACTIVE
 *      provider's registry `defaultFastModel` with the main API key, so
 *      helper calls stay cheap by default.
 *   3. Only when no default exists (custom providers, openai-compatible)
 *      or the needed key is missing → fall back to the main model with a
 *      console warn. The Options Fast-model card surfaces the same state
 *      to the user.
 *
 * The fast provider can differ from the main provider — e.g. main =
 * Anthropic Opus, fast = Google Gemini Flash. As long as the user
 * has the relevant API key set somewhere in `apiKeys`, both work.
 */
/**
 * Returns true if the fast-model path (used by `find`) is fully configured:
 * key present AND a model id available (either explicit or from registry defaults).
 *
 * Built-in providers always have a `defaultFastModel` in the registry, so only
 * the API key is checked. Custom providers require both a key AND a model id
 * (either the user-chosen model or the custom provider's `defaultModel`).
 */
export async function hasLlmConfigured(): Promise<boolean> {
  const cfg = await llmConfigStorage.get();
  const fast = cfg.fastModel;

  // If an explicit fast provider is configured, check that path first.
  if (fast?.provider) {
    if (isCustomProviderId(fast.provider)) {
      const custom = await customProvidersStorage.byId(customIdFromProvider(fast.provider));
      return !!(custom?.apiKey && (fast.model.trim() || custom.defaultModel));
    }
    if (isBuiltInProviderId(fast.provider)) {
      // Built-in fast provider: defaultFastModel always exists, only key matters.
      return !!(cfg.apiKeys[fast.provider]);
    }
    return false;
  }

  // No explicit fast provider → mirrors resolveDefaultFast fallback logic.
  if (isCustomProviderId(cfg.provider)) {
    const custom = await customProvidersStorage.byId(customIdFromProvider(cfg.provider));
    return !!(custom?.apiKey && (activeModel(cfg) || custom.defaultModel));
  }

  if (isBuiltInProviderId(cfg.provider)) {
    // Built-in main provider: defaultFastModel always exists, only key matters.
    return !!(cfg.apiKeys[cfg.provider] && PROVIDER_REGISTRY[cfg.provider]?.defaultFastModel);
  }

  return false;
}

export async function resolveFastModel() {
  const cfg = await llmConfigStorage.get();
  const fast = cfg.fastModel;
  if (!fast || !fast.provider) return resolveDefaultFast(cfg);

  if (isCustomProviderId(fast.provider)) {
    const slug = customIdFromProvider(fast.provider);
    const custom = await customProvidersStorage.byId(slug);
    if (!custom) {
      console.warn(`[doeverything] fast model: custom provider "${slug}" missing — falling back`);
      return resolveDefaultFast(cfg);
    }
    // Empty model id on a custom fast provider → its own default model.
    const model = fast.model.trim() || custom.defaultModel.trim();
    if (!model) return resolveDefaultFast(cfg);
    return createLanguageModel({
      provider: fast.provider,
      model,
      apiKey: custom.apiKey,
      baseUrl: custom.baseUrl,
      customProvider: { kind: custom.kind, baseUrl: custom.baseUrl, defaultModel: custom.defaultModel },
    });
  }

  // Empty model id on a built-in fast provider → that provider's fast
  // default (the user picked WHO, we pick the cheap WHAT).
  const model =
    fast.model.trim() ||
    (isBuiltInProviderId(fast.provider) ? (PROVIDER_REGISTRY[fast.provider].defaultFastModel ?? '') : '');
  if (!model) return resolveDefaultFast(cfg);

  const apiKey = cfg.apiKeys[fast.provider] ?? '';
  if (!apiKey) {
    console.warn(`[doeverything] fast model: no API key for provider "${fast.provider}" — falling back`);
    return resolveDefaultFast(cfg);
  }
  return createLanguageModel({
    provider: fast.provider,
    model,
    apiKey,
    // Fast model on a built-in provider reuses the main config's base-URL
    // override ONLY when main+fast are the same provider (the cheap-tier-of-
    // same-provider case). For a different provider, leave it undefined so
    // the factory uses that provider's canonical endpoint — never the main
    // provider's override.
    baseUrl: cfg.provider === fast.provider ? activeBaseUrl(cfg) || undefined : undefined,
  });
}

/**
 * No explicit fast tier: try the ACTIVE provider's registry default
 * (same API key, same base-URL override) before resorting to the main —
 * expensive — model.
 */
async function resolveDefaultFast(cfg: LlmConfigState) {
  if (isBuiltInProviderId(cfg.provider)) {
    const fallback = PROVIDER_REGISTRY[cfg.provider].defaultFastModel;
    const apiKey = cfg.apiKeys[cfg.provider] ?? '';
    if (fallback && apiKey) {
      return createLanguageModel({
        provider: cfg.provider,
        model: fallback,
        apiKey,
        baseUrl: activeBaseUrl(cfg) || undefined,
      });
    }
  }
  console.warn('[doeverything] no fast model available — helper calls will use the main model');
  return resolveActiveModel();
}
