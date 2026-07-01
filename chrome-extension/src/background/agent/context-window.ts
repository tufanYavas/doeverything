/**
 * Per-model context window resolution â€” extension-side combinator.
 *
 * Priority: discovery metadata (exact, written by the Options page from the
 * provider's /models endpoint) â†’ static pattern table in
 * `@doeverything/llm-providers` (conservative) â†’ 120K fallback.
 *
 * Lives here (not in packages/llm-providers) so the providers package stays
 * storage-free. Custom `custom:<slug>` providers work transparently: the
 * discovery store is keyed by the same provider id the runner uses, and
 * self-hosted model ids usually pattern-match the static table.
 */

import {
  CONTEXT_WINDOW_COST_CAP,
  FALLBACK_CONTEXT_WINDOW,
  resolveStaticContextWindow,
} from '@doeverything/llm-providers';
import { discoveredModelsStorage } from '@doeverything/storage';
import type { LlmProviderId } from '@doeverything/llm-providers';

export async function resolveContextWindow(provider: LlmProviderId, modelId: string): Promise<number> {
  const id = modelId.trim();
  let window = FALLBACK_CONTEXT_WINDOW;
  if (id) {
    const entry = await discoveredModelsStorage.getForProvider(provider).catch(() => undefined);
    const discovered = entry?.contextWindows?.[id];
    if (typeof discovered === 'number' && Number.isFinite(discovered) && discovered > 0) {
      window = discovered;
    } else {
      const fromStatic = resolveStaticContextWindow(id);
      if (fromStatic !== undefined) window = fromStatic;
    }
  }
  // Effective budget is cost-capped: 1M-window models compact at the cap
  // instead of filling the (expensive, slow, recall-degrading) far end.
  // See CONTEXT_WINDOW_COST_CAP for the price math.
  return Math.min(window, CONTEXT_WINDOW_COST_CAP);
}
