import { Badge, cn } from '@doeverything/ui';
import { useChatStore } from '@src/stores/chat-store';
import { Layers, X } from 'lucide-react';

/**
 * ContextStrip — thin status strip directly above the composer.
 *
 * Two modes, in priority order:
 *   1. Compaction notice — the SW folded earlier turns into a summary
 *      (retrospective: the summary is already applied). Dismissible; a NEW
 *      compaction re-shows it.
 *   2. Fill indicator — no pending notice, but the last run reported the
 *      context at ≥75% of the model's window. Not dismissible (live
 *      state); disappears when a later run reports lower or on clear().
 *
 * Renders nothing in the common case so the composer area stays quiet.
 */

const FILL_VISIBLE_RATIO = 0.75;
const FILL_CRITICAL_RATIO = 0.9;

export function ContextStrip() {
  const lastCompaction = useChatStore(s => s.lastCompaction);
  const contextUsage = useChatStore(s => s.contextUsage);
  const dismissCompaction = useChatStore(s => s.dismissCompaction);

  const showCompaction = lastCompaction !== null && !lastCompaction.dismissed;

  const usageRatio =
    contextUsage && contextUsage.contextWindow > 0 ? contextUsage.estimatedTokens / contextUsage.contextWindow : null;
  const showFill = !showCompaction && usageRatio !== null && usageRatio >= FILL_VISIBLE_RATIO;

  if (!showCompaction && !showFill) return null;

  const fillPct = (ratio: number) => `${Math.min(100, Math.round(ratio * 100))}%`;

  if (showCompaction) {
    const window = lastCompaction.contextWindow;
    const ratio = window && window > 0 ? lastCompaction.estimatedTokens / window : null;
    const critical = lastCompaction.stage === 'critical';
    return (
      <div className="border-border/60 bg-secondary/60 text-secondary-foreground flex items-center gap-2 border-t px-3 py-1.5 text-xs">
        <Layers className="text-primary h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Context compacted — earlier messages were summarized.</span>
        {ratio !== null && (
          <Badge
            variant="outline"
            className={cn('shrink-0 border-0', critical ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary')}>
            {fillPct(ratio)} full
          </Badge>
        )}
        <button
          type="button"
          onClick={dismissCompaction}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 transition-colors duration-150">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const critical = usageRatio !== null && usageRatio >= FILL_CRITICAL_RATIO;
  return (
    <div className="border-border/60 bg-secondary/60 text-secondary-foreground flex items-center gap-2 border-t px-3 py-1.5 text-xs">
      <Layers className="text-primary h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Context {usageRatio !== null ? fillPct(usageRatio) : '—'} full — older messages will be summarized soon.
      </span>
      <Badge
        variant="outline"
        className={cn('shrink-0 border-0', critical ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary')}>
        {usageRatio !== null ? fillPct(usageRatio) : '—'}
      </Badge>
    </div>
  );
}
