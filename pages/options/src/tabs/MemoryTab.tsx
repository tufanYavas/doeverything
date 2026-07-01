/**
 * Memory tab — manages doeverything's persistent agent memory store.
 *
 * Three-column layout:
 *   1. Domains   — every namespace the agent has written to (`*` first,
 *                  then alpha by registrable domain).
 *   2. Buckets   — bucket roster for the selected domain.
 *   3. Items     — paged item list for the selected bucket, with raw JSON
 *                  view, per-item edit/delete, and a "edit raw" escape hatch.
 *
 * Sticky header carries: totals (domains/buckets/items/size), export-all,
 * import (with merge strategy), and wipe-all (with the "type DELETE
 * EVERYTHING" confirmation).
 *
 * Live updates: subscribes to the `doe:agent-memory` BroadcastChannel
 * via `subscribePersistentMemory` so writes from the agent (or another
 * Options window) refresh this view without polling.
 */

import { subscribePersistentMemory } from '@doeverything/storage';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@doeverything/ui';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileJson,
  Globe2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PersistentDomainSummary, PersistentMemorySnapshot } from '@doeverything/storage';

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------------ */
/*  Message helpers                                                          */
/* ------------------------------------------------------------------------ */

interface RpcReply<T> {
  ok: boolean;
  result?: T;
  error?: { name: string; message: string };
}

async function send<T>(payload: object): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(payload)) as RpcReply<T> | undefined;
  if (!reply?.ok) throw new Error(reply?.error?.message ?? 'memory RPC failed');
  return reply.result as T;
}

/* ------------------------------------------------------------------------ */
/*  Tab root                                                                 */
/* ------------------------------------------------------------------------ */

export function MemoryTab() {
  const [domains, setDomains] = useState<PersistentDomainSummary[] | null>(null);
  const [domainFilter, setDomainFilter] = useState('');
  const [bucketFilter, setBucketFilter] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [bucketItems, setBucketItems] = useState<unknown[] | null>(null);
  const [bucketTotal, setBucketTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [editingBucketRaw, setEditingBucketRaw] = useState(false);
  const [importing, setImporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDomains = useCallback(async () => {
    try {
      const { domains: result } = await send<{ domains: PersistentDomainSummary[] }>({
        type: 'doe/memory/list-domains',
      });
      setDomains(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadBucket = useCallback(
    async (domain: string, bucket: string, atPage: number) => {
      try {
        const { items, total } = await send<{ items: unknown[]; total: number }>({
          type: 'doe/memory/read-bucket',
          domain,
          bucket,
          offset: atPage * PAGE_SIZE,
          limit: PAGE_SIZE,
        });
        setBucketItems(items);
        setBucketTotal(total);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // Initial load + live updates from the agent or other Options windows.
  useEffect(() => {
    void loadDomains();
    const unsubscribe = subscribePersistentMemory(() => {
      void loadDomains();
      // Also refresh the open bucket view when the broadcast hits.
      if (selectedDomain && selectedBucket) {
        void loadBucket(selectedDomain, selectedBucket, page);
      }
    });
    return unsubscribe;
    // We deliberately want a stable subscription that re-reads selected items;
    // re-subscribing on every state change would tear down the BroadcastChannel
    // listener too aggressively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedDomain && selectedBucket) void loadBucket(selectedDomain, selectedBucket, page);
  }, [selectedDomain, selectedBucket, page, loadBucket]);

  const totals = useMemo(() => {
    if (!domains) return { domains: 0, buckets: 0, items: 0, sizeBytes: 0 };
    return domains.reduce(
      (acc, d) => ({
        domains: acc.domains + 1,
        buckets: acc.buckets + d.bucketCount,
        items: acc.items + d.totalItems,
        sizeBytes: acc.sizeBytes + d.totalSize,
      }),
      { domains: 0, buckets: 0, items: 0, sizeBytes: 0 },
    );
  }, [domains]);

  const filteredDomains = useMemo(() => {
    if (!domains) return [];
    const q = domainFilter.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter(d => d.domain.toLowerCase().includes(q));
  }, [domains, domainFilter]);

  const activeDomain = useMemo(
    () => domains?.find(d => d.domain === selectedDomain) ?? null,
    [domains, selectedDomain],
  );

  const filteredBuckets = useMemo(() => {
    if (!activeDomain) return [];
    const q = bucketFilter.trim().toLowerCase();
    if (!q) return activeDomain.buckets;
    return activeDomain.buckets.filter(b => b.bucket.toLowerCase().includes(q));
  }, [activeDomain, bucketFilter]);

  const onDeleteBucket = async (domain: string, bucket: string) => {
    if (!confirm(`Delete bucket "${bucket}" from "${domain}"?`)) return;
    await send({ type: 'doe/memory/delete-bucket', domain, bucket });
    if (selectedBucket === bucket) setSelectedBucket(null);
  };

  const onDeleteDomain = async (domain: string) => {
    const confirmed = prompt(
      `Delete every bucket under "${domain}"? Type the domain name to confirm:`,
    );
    if (confirmed !== domain) return;
    await send({ type: 'doe/memory/delete-domain', domain });
    if (selectedDomain === domain) {
      setSelectedDomain(null);
      setSelectedBucket(null);
    }
  };

  const onDeleteItem = async (index: number) => {
    if (!selectedDomain || !selectedBucket) return;
    if (!confirm(`Delete item #${index}?`)) return;
    await send({
      type: 'doe/memory/delete-item',
      domain: selectedDomain,
      bucket: selectedBucket,
      index: index + page * PAGE_SIZE,
    });
  };

  const onSaveItem = async (index: number, raw: string) => {
    if (!selectedDomain || !selectedBucket) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      alert('Invalid JSON');
      return;
    }
    await send({
      type: 'doe/memory/replace-item',
      domain: selectedDomain,
      bucket: selectedBucket,
      index: index + page * PAGE_SIZE,
      item: parsed,
    });
    setEditingItemIdx(null);
  };

  const onSaveBucketRaw = async (raw: string) => {
    if (!selectedDomain || !selectedBucket) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      alert('Invalid JSON — top-level value must be an array.');
      return;
    }
    if (!Array.isArray(parsed)) {
      alert('Top-level value must be an array.');
      return;
    }
    await send({
      type: 'doe/memory/replace-bucket',
      domain: selectedDomain,
      bucket: selectedBucket,
      items: parsed,
    });
    setEditingBucketRaw(false);
  };

  const onExportDomain = async (domain: string) => {
    const { snapshot } = await send<{ snapshot: PersistentMemorySnapshot }>({
      type: 'doe/memory/export-domain',
      domain,
    });
    downloadSnapshot(snapshot, `doe-memory-${sanitize(domain)}.json`);
  };

  const onExportAll = async () => {
    const { snapshot } = await send<{ snapshot: PersistentMemorySnapshot }>({
      type: 'doe/memory/export-all',
    });
    downloadSnapshot(snapshot, `doe-memory-all.json`);
  };

  const onWipeAll = async () => {
    setWiping(false);
    await send({ type: 'doe/memory/wipe-all' });
    setSelectedDomain(null);
    setSelectedBucket(null);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <Header
          totals={totals}
          onRefresh={() => void loadDomains()}
          onExportAll={onExportAll}
          onImport={() => setImporting(true)}
          onWipe={() => setWiping(true)}
        />

        {error && (
          <Card className="border-destructive/25 bg-destructive/10">
            <CardContent className="text-destructive flex items-center gap-2 py-3 text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span className="flex-1">{error}</span>
              <Button variant="ghost" size="sm" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {!domains ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">Loading…</CardContent>
          </Card>
        ) : domains.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DomainColumn
              domains={filteredDomains}
              selected={selectedDomain}
              filter={domainFilter}
              onFilterChange={setDomainFilter}
              onSelect={d => {
                setSelectedDomain(d);
                setSelectedBucket(null);
                setPage(0);
              }}
              onExport={onExportDomain}
              onDelete={onDeleteDomain}
            />

            {selectedDomain ? (
              <BucketColumn
                domain={selectedDomain}
                buckets={filteredBuckets}
                selected={selectedBucket}
                filter={bucketFilter}
                onFilterChange={setBucketFilter}
                onSelect={b => {
                  setSelectedBucket(b);
                  setPage(0);
                }}
                onDelete={b => void onDeleteBucket(selectedDomain, b)}
              />
            ) : (
              <PlaceholderColumn icon={Database} text="Pick a domain to see its buckets" />
            )}

            <div className="md:col-span-2">
              {selectedDomain && selectedBucket ? (
                <ItemColumn
                  domain={selectedDomain}
                  bucket={selectedBucket}
                  items={bucketItems}
                  total={bucketTotal}
                  page={page}
                  onPage={setPage}
                  onEditItem={setEditingItemIdx}
                  onDeleteItem={onDeleteItem}
                  onEditBucket={() => setEditingBucketRaw(true)}
                />
              ) : (
                <PlaceholderColumn icon={FileJson} text="Pick a bucket to see its items" />
              )}
            </div>
          </div>
        )}

        <ItemEditDialog
          open={editingItemIdx !== null}
          item={
            editingItemIdx !== null && bucketItems ? bucketItems[editingItemIdx] : undefined
          }
          onClose={() => setEditingItemIdx(null)}
          onSave={raw => editingItemIdx !== null && void onSaveItem(editingItemIdx, raw)}
        />

        <BucketEditDialog
          open={editingBucketRaw}
          domain={selectedDomain}
          bucket={selectedBucket}
          onClose={() => setEditingBucketRaw(false)}
          onSave={onSaveBucketRaw}
        />

        <ImportDialog open={importing} onClose={() => setImporting(false)} />

        <WipeDialog open={wiping} onCancel={() => setWiping(false)} onConfirm={onWipeAll} />
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------------ */
/*  Sub-components                                                           */
/* ------------------------------------------------------------------------ */

function Header({
  totals,
  onRefresh,
  onExportAll,
  onImport,
  onWipe,
}: {
  totals: { domains: number; buckets: number; items: number; sizeBytes: number };
  onRefresh: () => void;
  onExportAll: () => void;
  onImport: () => void;
  onWipe: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Memory</h2>
          <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
            Persistent
          </span>
        </div>
        <p className="text-muted-foreground max-w-2xl text-sm">
          doeverything's long-term memory store. Survives across conversations and browser restarts. Each domain owns its
          buckets; <code className="bg-muted/60 rounded px-1 text-[11px]">*</code> holds globally relevant facts.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Stat icon={Globe2} label="Domains" value={totals.domains} />
          <Stat icon={Database} label="Buckets" value={totals.buckets} />
          <Stat icon={FileJson} label="Items" value={totals.items} />
          <Stat icon={Brain} label="Size" value={formatBytes(totals.sizeBytes)} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Button variant="outline" size="sm" onClick={onExportAll}>
          <Download className="h-3.5 w-3.5" /> Export all
        </Button>
        <Button variant="outline" size="sm" onClick={onImport}>
          <Upload className="h-3.5 w-3.5" /> Import
        </Button>
        <Button variant="outline" size="sm" onClick={onWipe} className="text-destructive hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Wipe everything
        </Button>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-muted/40 border-border/60 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
      <Icon className="text-muted-foreground h-3 w-3" />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function DomainColumn({
  domains,
  selected,
  filter,
  onFilterChange,
  onSelect,
  onExport,
  onDelete,
}: {
  domains: PersistentDomainSummary[];
  selected: string | null;
  filter: string;
  onFilterChange: (v: string) => void;
  onSelect: (domain: string) => void;
  onExport: (domain: string) => void;
  onDelete: (domain: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-border/60 border-b p-3">
        <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wider">Domains</div>
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder="Filter…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <CardContent className="max-h-[55vh] overflow-y-auto p-0">
        {domains.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-xs">No matches.</div>
        ) : (
          <ul className="divide-border/60 divide-y">
            {domains.map(d => (
              <li key={d.domain}>
                <button
                  type="button"
                  onClick={() => onSelect(d.domain)}
                  className={cn(
                    'group hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150',
                    selected === d.domain && 'bg-primary/10',
                  )}>
                  <Globe2 className={cn('h-3.5 w-3.5 shrink-0', d.domain === '*' ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{d.domain === '*' ? '* (global)' : d.domain}</div>
                    <div className="text-muted-foreground text-[10px] tabular-nums">
                      {d.bucketCount} bucket{d.bucketCount === 1 ? '' : 's'} · {d.totalItems} item{d.totalItems === 1 ? '' : 's'} ·{' '}
                      {formatBytes(d.totalSize)}
                    </div>
                  </div>
                  <span className="opacity-0 transition group-hover:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => {
                            e.stopPropagation();
                            onExport(d.domain);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              onExport(d.domain);
                            }
                          }}
                          className="text-muted-foreground hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded">
                          <Download className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Export</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => {
                            e.stopPropagation();
                            onDelete(d.domain);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              onDelete(d.domain);
                            }
                          }}
                          className="text-muted-foreground hover:text-destructive inline-flex h-5 w-5 items-center justify-center rounded">
                          <Trash2 className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Delete domain</TooltipContent>
                    </Tooltip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BucketColumn({
  domain,
  buckets,
  selected,
  filter,
  onFilterChange,
  onSelect,
  onDelete,
}: {
  domain: string;
  buckets: PersistentDomainSummary['buckets'];
  selected: string | null;
  filter: string;
  onFilterChange: (v: string) => void;
  onSelect: (b: string) => void;
  onDelete: (b: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-border/60 border-b p-3">
        <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wider">
          Buckets
        </div>
        <div className="text-foreground mb-2 truncate text-xs font-medium">
          {domain === '*' ? '* (global)' : domain}
        </div>
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            placeholder="Filter…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <CardContent className="max-h-[55vh] overflow-y-auto p-0">
        {buckets.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-xs">No buckets here yet.</div>
        ) : (
          <ul className="divide-border/60 divide-y">
            {buckets.map(b => (
              <li key={b.bucket}>
                <button
                  type="button"
                  onClick={() => onSelect(b.bucket)}
                  className={cn(
                    'group hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150',
                    selected === b.bucket && 'bg-primary/10',
                  )}>
                  <Database className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">{b.bucket}</div>
                    <div className="text-muted-foreground text-[10px] tabular-nums">
                      {b.count} item{b.count === 1 ? '' : 's'} · {formatBytes(b.sizeBytes)} · updated{' '}
                      {formatRelative(b.updatedAt)}
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      onDelete(b.bucket);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        onDelete(b.bucket);
                      }
                    }}
                    className="text-muted-foreground hover:text-destructive opacity-0 transition group-hover:opacity-100">
                    <Trash2 className="h-3 w-3" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ItemColumn({
  domain,
  bucket,
  items,
  total,
  page,
  onPage,
  onEditItem,
  onDeleteItem,
  onEditBucket,
}: {
  domain: string;
  bucket: string;
  items: unknown[] | null;
  total: number;
  page: number;
  onPage: (p: number) => void;
  onEditItem: (idx: number) => void;
  onDeleteItem: (idx: number) => void;
  onEditBucket: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Card className="overflow-hidden">
      <div className="border-border/60 flex items-center gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">Items</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs">{bucket}</span>
            <Badge variant="secondary" className="text-[10px]">
              {domain === '*' ? '* (global)' : domain}
            </Badge>
            <span className="text-muted-foreground text-[10px] tabular-nums">
              {total} item{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onEditBucket}>
          <Pencil className="h-3.5 w-3.5" /> Edit raw
        </Button>
      </div>
      <CardContent className="max-h-[55vh] overflow-y-auto p-0">
        {items === null ? (
          <div className="text-muted-foreground p-4 text-center text-xs">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-xs">Bucket is empty.</div>
        ) : (
          <ul className="divide-border/60 divide-y">
            {items.map((item, i) => {
              const globalIdx = page * PAGE_SIZE + i;
              return (
                <li key={globalIdx} className="group flex items-start gap-2 px-3 py-2">
                  <span className="text-muted-foreground mt-0.5 w-10 shrink-0 text-right text-[10px] tabular-nums">
                    #{globalIdx}
                  </span>
                  <pre className="bg-muted/30 min-w-0 flex-1 overflow-x-auto rounded-md p-2 font-mono text-[11px] leading-snug">
                    {previewItem(item)}
                  </pre>
                  <div className="flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => onEditItem(i)} aria-label="Edit">
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit JSON</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDeleteItem(i)}
                          aria-label="Delete"
                          className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete item</TooltipContent>
                    </Tooltip>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {totalPages > 1 && (
        <div className="border-border/60 flex items-center justify-between gap-2 border-t p-2 text-xs">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <span className="text-muted-foreground tabular-nums">
            page {page + 1} / {totalPages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </Card>
  );
}

function PlaceholderColumn({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="text-muted-foreground flex h-full min-h-[200px] flex-col items-center justify-center gap-2 py-12 text-center text-xs">
        <Icon className="h-6 w-6 opacity-50" />
        <span>{text}</span>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="bg-primary/10 ring-primary/20 flex h-14 w-14 items-center justify-center rounded-2xl ring-1">
          <Brain className="text-primary h-6 w-6" />
        </div>
        <h3 className="text-base font-semibold">No persistent memory yet</h3>
        <p className="text-muted-foreground max-w-xs text-sm">
          doeverything hasn't saved anything for the long term. The first time the agent learns something reusable —
          a stable selector, your preferences, listing IDs to track — it'll show up here.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/*  Dialogs                                                                  */
/* ------------------------------------------------------------------------ */

function ItemEditDialog({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean;
  item: unknown | undefined;
  onClose: () => void;
  onSave: (raw: string) => void;
}) {
  const [raw, setRaw] = useState('');
  useEffect(() => {
    if (open && item !== undefined) setRaw(JSON.stringify(item, null, 2));
  }, [open, item]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>Top-level value can be any JSON.</DialogDescription>
        </DialogHeader>
        <Textarea value={raw} onChange={e => setRaw(e.target.value)} className="min-h-[300px] font-mono text-xs" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(raw)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BucketEditDialog({
  open,
  domain,
  bucket,
  onClose,
  onSave,
}: {
  open: boolean;
  domain: string | null;
  bucket: string | null;
  onClose: () => void;
  onSave: (raw: string) => void;
}) {
  const [raw, setRaw] = useState('');
  useEffect(() => {
    if (!open || !domain || !bucket) return;
    void send<{ items: unknown[]; total: number }>({
      type: 'doe/memory/read-bucket',
      domain,
      bucket,
      offset: 0,
      limit: 10_000,
    }).then(res => setRaw(JSON.stringify(res.items, null, 2)));
  }, [open, domain, bucket]);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit bucket — {bucket}</DialogTitle>
          <DialogDescription>
            Top-level value MUST be an array. Buckets larger than 10 000 items get truncated in this editor — use the
            per-item editor instead.
          </DialogDescription>
        </DialogHeader>
        <Textarea value={raw} onChange={e => setRaw(e.target.value)} className="min-h-[400px] font-mono text-xs" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(raw)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [strategy, setStrategy] = useState<'overwrite' | 'skip' | 'append'>('overwrite');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  const onPick = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      const { merged } = await send<{ merged: number }>({
        type: 'doe/memory/import',
        snapshot,
        strategy,
      });
      setResult(`Merged ${merged} bucket${merged === 1 ? '' : 's'}.`);
    } catch (err) {
      setResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import memory snapshot</DialogTitle>
          <DialogDescription>
            Pick a JSON file previously exported from this Memory tab. Choose a merge strategy below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept="application/json,.json" className="text-xs" />
          <div className="flex flex-wrap gap-2 text-xs">
            {(['overwrite', 'skip', 'append'] as const).map(s => (
              <label key={s} className="bg-muted/40 flex items-center gap-1.5 rounded-md px-2 py-1">
                <input type="radio" checked={strategy === s} onChange={() => setStrategy(s)} />
                <span className="font-medium capitalize">{s}</span>
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-[11px] leading-snug">
            <strong>overwrite</strong>: replaces existing buckets with the imported version. <strong>skip</strong>:
            keeps existing buckets, only adds new ones. <strong>append</strong>: concatenates items into existing
            buckets (creates if missing).
          </p>
          {result && <div className="bg-muted/40 rounded-md p-2 text-xs">{result}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onPick} disabled={busy}>
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WipeDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  useEffect(() => {
    if (!open) setConfirmText('');
  }, [open]);
  const armed = confirmText === 'DELETE EVERYTHING';
  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Wipe all persistent memory?
          </DialogTitle>
          <DialogDescription>
            This deletes every bucket from every domain — including all globally-shared facts, site know-how, and
            tracked listings. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs">
            Type <code className="bg-muted/60 rounded px-1 font-mono">DELETE EVERYTHING</code> below to confirm:
          </p>
          <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="DELETE EVERYTHING" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <ArrowLeft className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button variant="outline" disabled={!armed} onClick={onConfirm} className="text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Wipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/*  Helpers                                                                  */
/* ------------------------------------------------------------------------ */

function previewItem(item: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(item, null, 2);
  } catch {
    s = String(item);
  }
  if (s.length > 800) return s.slice(0, 800) + '…';
  return s;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, '_').slice(0, 64);
}

function downloadSnapshot(snapshot: PersistentMemorySnapshot, filename: string): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
