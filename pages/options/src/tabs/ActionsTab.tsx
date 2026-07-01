import { useStorage } from '@doeverything/shared';
import { savedPromptsStorage, scheduledTasksStorage } from '@doeverything/storage';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  SaveActionDialog,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@doeverything/ui';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  Hash,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RepeatKind, SavedPrompt, ScheduledTask } from '@doeverything/storage';

/**
 * Actions library — every saved prompt the user can launch by slash
 * command, schedule, or both. The card list is the single source of
 * truth: clicking an action opens the same `SaveActionDialog` the side
 * panel uses, so create + edit share one form. Deletes cascade across
 * `savedPromptsStorage` and `scheduledTasksStorage` automatically.
 */
export function ActionsTab() {
  const savedState = useStorage(savedPromptsStorage);
  const scheduledState = useStorage(scheduledTasksStorage);

  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  // Index scheduled tasks by id so we can render schedule chips on each
  // action card without two separate maps. Same id is used in both stores
  // (see SaveActionDialog) so this is a 1:1 join.
  const scheduleById = useMemo(() => {
    const map = new Map<string, ScheduledTask>();
    for (const t of scheduledState.tasks) map.set(t.id, t);
    return map;
  }, [scheduledState.tasks]);

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...savedState.prompts]
      .filter(p => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.command ?? '').toLowerCase().includes(q) ||
          p.prompt.toLowerCase().includes(q) ||
          (p.url ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Pinned ordering: scheduled first, then by lastUsedAt desc, then createdAt desc.
        const aSched = scheduleById.has(a.id) ? 1 : 0;
        const bSched = scheduleById.has(b.id) ? 1 : 0;
        if (aSched !== bSched) return bSched - aSched;
        const aLast = a.lastUsedAt ?? a.createdAt;
        const bLast = b.lastUsedAt ?? b.createdAt;
        return bLast - aLast;
      });
  }, [savedState.prompts, scheduleById, filter]);

  const totals = useMemo(() => {
    const all = savedState.prompts.length;
    const slash = savedState.prompts.filter(p => p.command).length;
    const scheduled = scheduledState.tasks.length;
    return { all, slash, scheduled };
  }, [savedState.prompts, scheduledState.tasks]);

  const onDelete = async (id: string) => {
    await Promise.all([savedPromptsStorage.remove(id), scheduledTasksStorage.remove(id)]);
    chrome.runtime.sendMessage({ type: 'doe/scheduler/reschedule' }).catch(() => undefined);
  };

  const onToggleSchedule = async (task: ScheduledTask) => {
    await scheduledTasksStorage.setEnabled(task.id, !task.enabled);
    chrome.runtime.sendMessage({ type: 'doe/scheduler/reschedule' }).catch(() => undefined);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <Header totals={totals} onCreate={() => setCreating(true)} />

        {savedState.prompts.length > 0 && (
          <div className="relative">
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter by name, slash command, prompt, or URL…"
              className="pl-9"
            />
            <span className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2">
              <Hash className="h-3.5 w-3.5" />
            </span>
          </div>
        )}

        {savedState.prompts.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No actions match the filter.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sorted.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                schedule={scheduleById.get(action.id)}
                onEdit={() => setEditingId(action.id)}
                onDelete={() => onDelete(action.id)}
                onToggleSchedule={() => {
                  const t = scheduleById.get(action.id);
                  if (t) void onToggleSchedule(t);
                }}
              />
            ))}
          </div>
        )}

        <SaveActionDialog
          open={creating || !!editingId}
          editingId={editingId}
          source="manual"
          onOpenChange={open => {
            if (!open) {
              setCreating(false);
              setEditingId(undefined);
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function Header({ totals, onCreate }: { totals: { all: number; slash: number; scheduled: number }; onCreate: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Actions</h2>
          <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
            New
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          Saved prompts you can re-run by slash command, on a schedule, or both. Distill any chat into one with{' '}
          <Sparkles className="text-primary inline h-3 w-3 -translate-y-px" /> in the side panel.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Stat icon={Wand2} label="Total" value={totals.all} />
          <Stat icon={Hash} label="With /command" value={totals.slash} />
          <Stat icon={Clock} label="Scheduled" value={totals.scheduled} />
        </div>
      </div>
      <Button onClick={onCreate} className="shrink-0">
        <Plus className="h-3.5 w-3.5" /> New action
      </Button>
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
  value: number;
}) {
  return (
    <div className="bg-muted/40 border-border/60 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
      <Icon className="text-muted-foreground h-3 w-3" />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="bg-primary/10 ring-primary/20 flex h-14 w-14 items-center justify-center rounded-2xl ring-1">
          <Wand2 className="text-primary h-6 w-6" />
        </div>
        <h3 className="text-base font-semibold">No actions yet</h3>
        <p className="text-muted-foreground max-w-xs text-sm">
          Save any prompt as an action and doeverything can run it again — by slash command, on a schedule, or both.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> Create your first action
          </Button>
        </div>
        <div className="text-muted-foreground mt-4 grid grid-cols-3 gap-2 text-[11px]">
          <Hint icon={Hash} text="Slash command" />
          <Hint icon={Globe} text="Site-anchored" />
          <Hint icon={Clock} text="Scheduled" />
        </div>
      </CardContent>
    </Card>
  );
}

function Hint({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="bg-muted/40 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1">
      <Icon className="h-3 w-3" />
      <span>{text}</span>
    </div>
  );
}

function ActionCard({
  action,
  schedule,
  onEdit,
  onDelete,
  onToggleSchedule,
}: {
  action: SavedPrompt;
  schedule?: ScheduledTask;
  onEdit: () => void;
  onDelete: () => void;
  onToggleSchedule: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const lastRunBadge = schedule?.lastRunAt
    ? schedule.lastSuccess
      ? { tone: 'ok', text: `Last ran ${formatRelative(schedule.lastRunAt)} · ok`, Icon: CheckCircle2 }
      : { tone: 'err', text: `Last run failed · ${formatRelative(schedule.lastRunAt)}`, Icon: AlertCircle }
    : null;

  return (
    <Card
      className={cn(
        'group hover:border-primary/40 transition-colors duration-150',
        schedule && schedule.enabled && 'border-primary/30',
        confirming && 'border-destructive/50',
      )}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onEdit} className="flex flex-1 items-start gap-3 text-left">
            <div className="bg-muted/60 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              {schedule ? (
                <Calendar className="text-primary h-4 w-4" />
              ) : action.command ? (
                <Hash className="text-primary h-4 w-4" />
              ) : (
                <Wand2 className="text-muted-foreground h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="truncate text-sm font-semibold">{action.name}</span>
                {action.command && (
                  <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                    /{action.command}
                  </span>
                )}
                {schedule && (
                  <Badge variant={schedule.enabled ? 'default' : 'secondary'} className="text-[10px]">
                    {scheduleLabel(schedule)}
                  </Badge>
                )}
                {(action.invocations ?? 0) > 0 && (
                  <span className="text-muted-foreground text-[10px] tabular-nums">
                    · {action.invocations} run{action.invocations === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">{action.prompt}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                {action.url && (
                  <span className="text-muted-foreground flex items-center gap-1 font-mono">
                    <Globe className="h-3 w-3" />
                    <span className="max-w-[260px] truncate">{action.url}</span>
                  </span>
                )}
                {schedule && (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Next {formatAbsolute(schedule.nextRunAt)}
                  </span>
                )}
                {lastRunBadge && (
                  <span
                    className={cn(
                      'flex items-center gap-1',
                      lastRunBadge.tone === 'ok' ? 'text-muted-foreground' : 'text-destructive',
                    )}>
                    <lastRunBadge.Icon className="h-3 w-3" />
                    {lastRunBadge.text}
                  </span>
                )}
              </div>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {schedule && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Switch
                    checked={schedule.enabled}
                    onCheckedChange={onToggleSchedule}
                    aria-label="Toggle schedule"
                    className="mr-1"
                  />
                </TooltipTrigger>
                <TooltipContent>{schedule.enabled ? 'Pause schedule' : 'Resume schedule'}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit action">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            {confirming ? (
              <div className="bg-destructive/10 text-destructive flex items-center gap-1 rounded-md px-2 py-1 text-[10px]">
                <span>Sure?</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    void onDelete();
                  }}
                  className="font-semibold underline">
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="text-muted-foreground">
                  No
                </button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirming(true)}
                    aria-label="Delete action"
                    className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {schedule?.lastError && !lastRunBadge?.tone.includes('ok') && (
          <div className="text-destructive bg-destructive/10 rounded-md px-3 py-1.5 text-[11px]">
            <span className="font-semibold">Error:</span> {schedule.lastError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function scheduleLabel(t: ScheduledTask): string {
  if (!t.enabled) return 'Paused';
  switch (t.repeat as RepeatKind) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'custom_minutes':
      return `Every ${t.customMinutes ?? 60}m`;
    case 'once':
    default:
      return 'Once';
  }
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const min = Math.round(abs / 60_000);
  if (min < 1) return future ? 'in <1m' : 'just now';
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return future ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return future ? `in ${d}d` : `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function formatAbsolute(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
