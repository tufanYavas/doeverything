import { buildConversationReportHtml } from '../lib/conversation-report.js';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@doeverything/ui';
import { CheckCircle2, ChevronRight, FileText, Loader2, MessageSquare, RefreshCcw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';

/**
 * RunsTab — agent run telemetry surface.
 *
 * Pulls the IndexedDB-backed run log out of the SW (the SW owns the only
 * connection to that store) via the `doe/runs/list` message. Renders a
 * compact table you can use to spot failing tools, regressions in latency,
 * or tokens-per-task drift after switching models.
 */

interface TaskRunMetricsDTO {
  firstTokenLatencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

interface TaskRunRecordDTO {
  id: string;
  conversationId: string;
  startedAt: number;
  endedAt?: number;
  prompt: string;
  toolCalls: Array<{ name: string; ok: boolean }>;
  outcome: 'success' | 'error' | 'aborted' | 'running';
  errorMessage?: string;
  provider?: string;
  model?: string;
  metrics?: TaskRunMetricsDTO;
}

interface ChatGroup {
  conversationId: string;
  runs: TaskRunRecordDTO[];
  /** Earliest prompt in the chat — used as the chat title (matches ChatGPT/Claude convention). */
  title: string;
  /** When the most recent run in this chat started — used to sort groups newest-first. */
  lastStartedAt: number;
  /** Aggregate stats over the chat's runs. */
  totalTokens: number;
  cachedTokens: number;
  successCount: number;
  errorCount: number;
}

function groupByChat(runs: TaskRunRecordDTO[]): ChatGroup[] {
  const buckets = new Map<string, TaskRunRecordDTO[]>();
  for (const run of runs) {
    const list = buckets.get(run.conversationId);
    if (list) list.push(run);
    else buckets.set(run.conversationId, [run]);
  }

  return Array.from(buckets.entries())
    .map(([conversationId, list]) => {
      const sorted = [...list].sort((a, b) => b.startedAt - a.startedAt);
      const oldest = sorted[sorted.length - 1];
      let totalTokens = 0;
      let cachedTokens = 0;
      let successCount = 0;
      let errorCount = 0;
      for (const r of sorted) {
        totalTokens += r.metrics?.totalTokens ?? 0;
        cachedTokens += r.metrics?.cachedInputTokens ?? 0;
        if (r.outcome === 'success') successCount++;
        else if (r.outcome === 'error') errorCount++;
      }
      return {
        conversationId,
        runs: sorted,
        title: oldest?.prompt?.trim() || '(empty conversation)',
        lastStartedAt: sorted[0].startedAt,
        totalTokens,
        cachedTokens,
        successCount,
        errorCount,
      };
    })
    .sort((a, b) => b.lastStartedAt - a.lastStartedAt);
}

/**
 * Open a generated HTML report in a new tab. We use a Blob URL because the
 * report is a stand-alone artifact (no extension permissions needed once
 * loaded) and Chrome happily opens blob:chrome-extension URLs.
 *
 * Surfaces an alert on failure rather than silently swallowing — the user
 * needs to know the popup was blocked or the conversation has no transcripts.
 */
async function openConversationReport(group: ChatGroup) {
  try {
    const reply = await chrome.runtime.sendMessage({
      type: 'doe/runs/transcript',
      conversationId: group.conversationId,
    });
    if (!reply?.ok) throw new Error(reply?.error?.message ?? 'unknown error');
    const transcripts = (reply.result.transcripts ?? []) as Parameters<
      typeof buildConversationReportHtml
    >[0]['transcripts'];
    const html = buildConversationReportHtml({
      conversationId: group.conversationId,
      title: group.title,
      transcripts,
    });
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups for the doeverything options page.');
    }
    // Revoke after a short delay so the new window has time to load. Without
    // this, the Blob URL leaks for the lifetime of the options page.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Failed to generate report: ${msg}`);
  }
}

export function RunsTab() {
  const [runs, setRuns] = useState<TaskRunRecordDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'doe/runs/list', limit: 200 });
      if (!reply?.ok) throw new Error(reply?.error?.message ?? 'unknown error');
      setRuns(reply.result.runs as TaskRunRecordDTO[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => groupByChat(runs ?? []), [runs]);

  // Auto-open the most recent group on first load so the user always sees
  // *something* without having to click. Subsequent toggles are user-driven.
  useEffect(() => {
    if (groups.length === 0) return;
    setOpenGroups(prev => {
      if (prev.size > 0) return prev;
      return new Set([groups[0].conversationId]);
    });
  }, [groups]);

  const toggleGroup = (id: string) =>
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => setOpenGroups(new Set(groups.map(g => g.conversationId)));
  const collapseAll = () => setOpenGroups(new Set());

  const totals = aggregate(runs ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Runs</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Agent runs grouped by chat. Each group expands to show every turn — token usage, cached tokens, first-token
            latency, and tool calls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 1 && (
            <>
              <Button variant="ghost" size="sm" onClick={expandAll}>
                Expand all
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll}>
                Collapse all
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/25 bg-destructive/10">
          <CardContent className="text-destructive py-3 text-sm">Couldn't load runs: {error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Chats" value={groups.length} />
        <Stat label="Runs" value={totals.count} />
        <Stat label="Success rate" value={totals.successRate} suffix="%" />
        <Stat label="Avg first token" value={totals.avgFirstTokenMs} suffix=" ms" />
        <Stat label="Tokens used" value={totals.totalTokens} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conversations</CardTitle>
          <CardDescription>Most recent first. Up to 200 most recent runs across all chats.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-border divide-y">
            {runs === null ? (
              <div className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : groups.length === 0 ? (
              <div className="text-muted-foreground px-4 py-6 text-sm">No runs yet — talk to doeverything to populate.</div>
            ) : (
              groups.map(group => (
                <ChatGroupBlock
                  key={group.conversationId}
                  group={group}
                  open={openGroups.has(group.conversationId)}
                  onToggle={() => toggleGroup(group.conversationId)}
                  expandedRunId={expandedRunId}
                  onToggleRun={runId => setExpandedRunId(prev => (prev === runId ? null : runId))}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChatGroupBlock({
  group,
  open,
  onToggle,
  expandedRunId,
  onToggleRun,
}: {
  group: ChatGroup;
  open: boolean;
  onToggle: () => void;
  expandedRunId: string | null;
  onToggleRun: (id: string) => void;
}) {
  const [reportLoading, setReportLoading] = useState(false);

  const handleReport = async (e: MouseEvent) => {
    // Stop the click from bubbling into the row toggle button.
    e.stopPropagation();
    setReportLoading(true);
    try {
      await openConversationReport(group);
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div>
      <div className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight
            className={cn('text-muted-foreground h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')}
          />
          <MessageSquare className="text-primary h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{group.title}</div>
            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <span>{new Date(group.lastStartedAt).toLocaleString()}</span>
              <span>·</span>
              <span>
                {group.runs.length} run{group.runs.length === 1 ? '' : 's'}
              </span>
              {group.successCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-success">{group.successCount} ok</span>
                </>
              )}
              {group.errorCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-destructive">{group.errorCount} error</span>
                </>
              )}
            </div>
          </div>
          <div className="text-muted-foreground hidden text-right text-xs sm:block">
            {group.totalTokens > 0 && <div>{group.totalTokens.toLocaleString()} tok</div>}
            {group.cachedTokens > 0 && <div>{group.cachedTokens.toLocaleString()} cached</div>}
          </div>
        </button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReport}
          disabled={reportLoading}
          title="Open all requests/responses for this conversation as an HTML report in a new tab">
          {reportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          Report
        </Button>
      </div>
      {open && (
        <div className="bg-muted/20 border-border/50 divide-border/40 divide-y border-t">
          {group.runs.map(run => (
            <RunRow key={run.id} run={run} expanded={expandedRunId === run.id} onToggle={() => onToggleRun(run.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="border-border/70 bg-card shadow-soft rounded-xl border p-3">
      <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix && <span className="text-muted-foreground ml-1 text-sm font-normal">{suffix}</span>}
      </div>
    </div>
  );
}

function RunRow({ run, expanded, onToggle }: { run: TaskRunRecordDTO; expanded: boolean; onToggle: () => void }) {
  const duration = run.endedAt ? run.endedAt - run.startedAt : null;
  const totalTokens = run.metrics?.totalTokens;
  const firstToken = run.metrics?.firstTokenLatencyMs;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150">
        <ChevronRight
          className={cn('text-muted-foreground h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
        />
        <OutcomeBadge outcome={run.outcome} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{run.prompt || '(empty prompt)'}</div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span>{new Date(run.startedAt).toLocaleString()}</span>
            {run.provider && (
              <>
                <span>·</span>
                <span className="font-mono">
                  {run.provider}
                  {run.model ? ` / ${run.model}` : ''}
                </span>
              </>
            )}
            {run.toolCalls.length > 0 && (
              <>
                <span>·</span>
                <span>
                  {run.toolCalls.length} tool{run.toolCalls.length === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-muted-foreground hidden text-right text-xs sm:block">
          {firstToken !== undefined && <div>{firstToken} ms first</div>}
          {duration !== null && <div>{(duration / 1000).toFixed(1)}s total</div>}
          {totalTokens !== undefined && <div>{totalTokens.toLocaleString()} tok</div>}
        </div>
      </button>
      {expanded && <RunDetail run={run} />}
    </div>
  );
}

function RunDetail({ run }: { run: TaskRunRecordDTO }) {
  const cached = run.metrics?.cachedInputTokens;
  const input = run.metrics?.inputTokens;
  const cachePct =
    typeof cached === 'number' && typeof input === 'number' && input > 0 ? Math.round((cached / input) * 100) : null;
  return (
    <div className="bg-muted/30 grid grid-cols-1 gap-4 px-4 py-3 text-xs sm:grid-cols-2">
      <div>
        <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wider">Tokens</div>
        <div className="space-y-0.5">
          <KV k="Input" v={input} />
          {/* Indented to make clear that cached is a SUBSET of input,
              not an additional charge. Anthropic / Google / OpenAI all
              report it this way: total prompt tokens = noCache + cacheRead. */}
          <KV k="└ of which cached" v={cached} hint={cachePct !== null ? `${cachePct}% of input` : undefined} />
          <KV k="Output" v={run.metrics?.outputTokens} />
          <KV k="Total (input + output)" v={run.metrics?.totalTokens} />
        </div>
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wider">Tools called</div>
        {run.toolCalls.length === 0 ? (
          <div className="text-muted-foreground">None</div>
        ) : (
          <div className="space-y-0.5">
            {run.toolCalls.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 font-mono">
                {c.ok ? (
                  <CheckCircle2 className="text-success h-3 w-3" />
                ) : (
                  <XCircle className="text-destructive h-3 w-3" />
                )}
                {c.name}
              </div>
            ))}
          </div>
        )}
      </div>
      {run.errorMessage && (
        <div className="sm:col-span-2">
          <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wider">Error</div>
          <div className="text-destructive font-mono">{run.errorMessage}</div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v, hint }: { k: string; v?: number; hint?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">
        {v === undefined ? '—' : v.toLocaleString()}
        {hint && v !== undefined && <span className="text-muted-foreground/70 ml-2 font-sans text-[10px]">{hint}</span>}
      </span>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: TaskRunRecordDTO['outcome'] }) {
  if (outcome === 'success') return <Badge variant="success">ok</Badge>;
  if (outcome === 'error') return <Badge variant="destructive">error</Badge>;
  if (outcome === 'aborted') return <Badge variant="outline">aborted</Badge>;
  return (
    <Badge variant="default">
      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> running
    </Badge>
  );
}

function aggregate(runs: TaskRunRecordDTO[]) {
  if (runs.length === 0) {
    return { count: 0, successRate: '—' as const, avgFirstTokenMs: '—' as const, totalTokens: 0 };
  }
  const success = runs.filter(r => r.outcome === 'success').length;
  const firsts = runs.map(r => r.metrics?.firstTokenLatencyMs).filter((v): v is number => typeof v === 'number');
  const tokens = runs.reduce((sum, r) => sum + (r.metrics?.totalTokens ?? 0), 0);
  return {
    count: runs.length,
    successRate: Math.round((success / runs.length) * 100),
    avgFirstTokenMs:
      firsts.length === 0 ? ('—' as const) : Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length),
    totalTokens: tokens,
  };
}
