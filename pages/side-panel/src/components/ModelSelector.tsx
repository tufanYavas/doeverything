import { isBuiltInProviderId, PROVIDER_LIST, PROVIDER_REGISTRY } from '@doeverything/llm-providers';
import { useStorage } from '@doeverything/shared';
import {
  activeModel,
  customIdFromProvider,
  customProvidersStorage,
  discoveredModelsStorage,
  isCustomProviderId,
  llmConfigStorage,
  providerKeyFromCustomId,
} from '@doeverything/storage';
import { cn } from '@doeverything/ui';
import { Check, Clock, Cpu, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ModelSelector.
 *
 * Inline model combobox in the composer button row. Typing filters the
 * provider/model list (case-insensitive substring over provider label and
 * model id); free text can be committed as a custom model id for the
 * current provider. Persists via `llmConfigStorage.setProviderModel`
 * (single atomic write — setProvider + setModel separately would race on a
 * shared snapshot and land the model under the wrong provider key).
 *
 * Suggestions come from `discoveredModelsStorage` (populated by the
 * Options page "Refresh models" button); providers with no cache fall
 * back to their bootstrap `defaultModel`. Custom providers are listed too.
 */

interface ModelOption {
  provider: string;
  model: string;
  providerLabel: string;
}

/**
 * Sort model IDs newest → oldest using a numeric version tuple heuristic.
 * Extracts all digit sequences and compares them descending; equal versions
 * fall back to shorter-id-first (base > variant) then alphabetical.
 */
function sortModelIds(ids: string[]): string[] {
  const nums = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
  return [...ids].sort((a, b) => {
    const va = nums(a);
    const vb = nums(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const d = (vb[i] ?? 0) - (va[i] ?? 0);
      if (d !== 0) return d;
    }
    return a.length - b.length || a.localeCompare(b);
  });
}

interface Props {
  className?: string;
}

export function ModelSelector({ className }: Props) {
  const cfg = useStorage(llmConfigStorage);
  const discovered = useStorage(discoveredModelsStorage);
  const customState = useStorage(customProvidersStorage);
  const recentModels = cfg.recentModels ?? [];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentProviderLabel = useMemo(() => {
    if (isCustomProviderId(cfg.provider)) {
      const slug = customIdFromProvider(cfg.provider);
      const custom = customState.providers.find(p => p.id === slug);
      return custom?.label || slug;
    }
    return isBuiltInProviderId(cfg.provider) ? PROVIDER_REGISTRY[cfg.provider].label : cfg.provider;
  }, [cfg.provider, customState.providers]);

  const currentModel =
    activeModel(cfg) ||
    (isCustomProviderId(cfg.provider)
      ? customState.providers.find(p => p.id === customIdFromProvider(cfg.provider))?.defaultModel ?? ''
      : isBuiltInProviderId(cfg.provider)
        ? PROVIDER_REGISTRY[cfg.provider].defaultModel
        : '');

  const allOptions = useMemo(() => {
    const options: ModelOption[] = [];
    for (const p of PROVIDER_LIST) {
      // Hide providers with no configured API key — the user hasn't set them up.
      if (!cfg.apiKeys[p.id] && p.id !== cfg.provider) continue;
      const cached = discovered.byProvider[p.id]?.models ?? [];
      // Discovered list: sort newest → oldest. Fallback: use curated order from registry.
      const models =
        cached.length > 0
          ? sortModelIds(cached)
          : (p.fallbackModels ?? (p.defaultModel ? [p.defaultModel] : []));
      for (const m of models) options.push({ provider: p.id, model: m, providerLabel: p.label });
    }
    for (const c of customState.providers) {
      const key = providerKeyFromCustomId(c.id);
      const cached = discovered.byProvider[key]?.models ?? [];
      const models = cached.length > 0 ? sortModelIds(cached) : c.defaultModel ? [c.defaultModel] : [];
      for (const m of models) options.push({ provider: key, model: m, providerLabel: c.label || c.id });
    }
    return options;
  }, [discovered, customState.providers, cfg.apiKeys, cfg.provider]);

  const trimmedQuery = query.trim();
  const filtered = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(o => `${o.providerLabel} ${o.model}`.toLowerCase().includes(q));
  }, [allOptions, trimmedQuery]);

  // Free-text row: lets the user run a model id the discovery list doesn't
  // know about, on the currently selected provider.
  const customRow = trimmedQuery.length > 0 && !filtered.some(o => o.model === trimmedQuery);
  const rowCount = filtered.length + (customRow ? 1 : 0);

  useEffect(() => {
    setHighlight(h => Math.min(h, Math.max(0, rowCount - 1)));
  }, [rowCount]);

  // Close on click outside the combobox.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openPanel = () => {
    setQuery('');
    setHighlight(0);
    setOpen(true);
    // Focus after the panel renders.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pick = (provider: string, model: string) => {
    setOpen(false);
    void llmConfigStorage.setProviderModel(provider, model);
  };

  const pickRow = (index: number) => {
    if (index < filtered.length) {
      const opt = filtered[index];
      pick(opt.provider, opt.model);
    } else if (customRow) {
      pick(cfg.provider, trimmedQuery);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, rowCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rowCount > 0) pickRow(highlight);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${currentProviderLabel} · ${currentModel || 'default'}. Click to change.`}
        title={`${currentProviderLabel} · ${currentModel || 'default'}`}
        className="hover:bg-accent text-foreground flex h-7 max-w-full items-center gap-1 overflow-hidden rounded-md px-2 text-[11px] font-medium transition-colors duration-150">
        <Cpu className="text-primary h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{currentModel || currentProviderLabel}</span>
      </button>

      {open && (
        // right-0: the trigger is the right-most item of the composer's
        // button group, so anchoring left would push the 288px panel past
        // the side panel's right edge and grow a horizontal scrollbar.
        <div className="border-border/70 bg-popover text-popover-foreground shadow-lifted absolute bottom-full right-0 z-50 mb-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border">
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search models or type a model id…"
            className="border-border/60 placeholder:text-muted-foreground w-full border-b bg-transparent px-2.5 py-2 text-xs outline-none"
          />
          {/* mousedown preventDefault: scrollbar clicks must not blur the search input. */}
          <div role="listbox" onMouseDown={e => e.preventDefault()} className="max-h-64 overflow-y-auto py-1">
            {!trimmedQuery && recentModels.length > 0 && (
              <>
                <div className="text-muted-foreground flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide">
                  <Clock className="h-3 w-3" />
                  Recent
                </div>
                {recentModels.map(r => {
                  const isCurrent = r.provider === cfg.provider && r.model === currentModel;
                  const providerLabel = isBuiltInProviderId(r.provider)
                    ? PROVIDER_REGISTRY[r.provider].label
                    : r.provider;
                  const displayModel =
                    r.model ||
                    (isBuiltInProviderId(r.provider) ? PROVIDER_REGISTRY[r.provider].defaultModel : '');
                  return (
                    <button
                      key={`recent::${r.provider}::${r.model}`}
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      onMouseDown={e => {
                        e.preventDefault();
                        pick(r.provider, r.model);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors duration-150',
                        isCurrent ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                      )}>
                      <Check className={cn('h-3 w-3 shrink-0', isCurrent ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono">{displayModel}</span>
                        <span className="text-muted-foreground block truncate text-[10px]">{providerLabel}</span>
                      </span>
                    </button>
                  );
                })}
                <div className="border-border/40 mx-2 my-1 border-t" />
              </>
            )}
            {filtered.map((opt, i) => {
              const isCurrent = opt.provider === cfg.provider && opt.model === currentModel;
              return (
                <button
                  key={`${opt.provider}::${opt.model}`}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  onMouseDown={e => {
                    e.preventDefault();
                    pickRow(i);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors duration-150',
                    i === highlight ? 'bg-accent text-accent-foreground' : '',
                  )}>
                  <Check className={cn('h-3 w-3 shrink-0', isCurrent ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{opt.model}</span>
                    <span className="text-muted-foreground block truncate text-[10px]">{opt.providerLabel}</span>
                  </span>
                </button>
              );
            })}
            {customRow && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={e => {
                  e.preventDefault();
                  pickRow(filtered.length);
                }}
                onMouseEnter={() => setHighlight(filtered.length)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors duration-150',
                  highlight === filtered.length ? 'bg-accent text-accent-foreground' : '',
                )}>
                <Plus className="text-primary h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono">{trimmedQuery}</span>
                  <span className="text-muted-foreground block truncate text-[10px]">
                    Use with {currentProviderLabel}
                  </span>
                </span>
              </button>
            )}
            {rowCount === 0 && (
              <div className="text-muted-foreground px-2.5 py-2 text-xs">No models found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
