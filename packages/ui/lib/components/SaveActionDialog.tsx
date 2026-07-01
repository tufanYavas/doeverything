import { Button } from './Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { Input } from './Input';
import { Label } from './Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select';
import { Switch } from './Switch';
import { Textarea } from './Textarea';
import { cn } from '../utils';
import { savedPromptsStorage, scheduledTasksStorage } from '@doeverything/storage';
import {
  AlertCircle,
  Calendar,
  CalendarPlus,
  Clock,
  Globe,
  Hash,
  Link2,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { RepeatKind, SavedPrompt, ScheduledTask } from '@doeverything/storage';

const REPEAT_OPTIONS: ReadonlyArray<{ value: RepeatKind; label: string; helper: string }> = [
  { value: 'once', label: 'Once', helper: 'Fires a single time' },
  { value: 'daily', label: 'Daily', helper: 'Same time every day' },
  { value: 'weekly', label: 'Weekly', helper: 'Same time, same weekday' },
  { value: 'monthly', label: 'Monthly', helper: 'Approx. every 30 days' },
  { value: 'custom_minutes', label: 'Every N min', helper: 'Set your own cadence' },
];

function newId() {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextDefault(): number {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 5);
  return d.getTime();
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function deriveName(prompt: string): string {
  const firstLine = prompt.split('\n').find(l => l.trim().length > 0)?.trim() ?? '';
  if (!firstLine) return 'New action';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}

function sanitizeCommand(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export interface SaveActionPrefill {
  prompt: string;
  name?: string;
  command?: string;
  url?: string;
  schedule?: {
    repeat: RepeatKind;
    nextRunAt?: number;
    customMinutes?: number;
  };
}

interface SaveActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, fetch the existing action and put the dialog in edit mode. */
  editingId?: string;
  /** Used in create mode — seeds the form. Ignored when `editingId` is set. */
  prefill?: SaveActionPrefill;
  /** Visual hint in the dialog header so the user knows where the action came from. */
  source?: 'message' | 'chat' | 'manual';
  /** True while the side panel is still calling the LLM to produce the prefill. */
  loading?: boolean;
  onSaved?: (info: { command?: string; id: string }) => void;
  onDeleted?: (id: string) => void;
}

/**
 * Unified modal for creating AND editing doeverything actions.
 *
 *   - Create mode: opens with `prefill` and (in chat mode) an LLM-distilled
 *     suggestion. Always writes a new id to `savedPromptsStorage`; mirrors
 *     to `scheduledTasksStorage` if a schedule is enabled.
 *   - Edit mode: opens with `editingId`, fetches the existing saved prompt
 *     (and any linked scheduled task), pre-fills the form, and overwrites
 *     in place on save. Adds an inline delete affordance.
 *
 * Visually, the form is split into three semantic sections — Basics,
 * Where to run, Schedule — with live previews so the user knows exactly
 * what they're saving before they click Save.
 */
export function SaveActionDialog({
  open,
  onOpenChange,
  editingId,
  prefill,
  source = 'manual',
  loading = false,
  onSaved,
  onDeleted,
}: SaveActionDialogProps) {
  const isEditing = !!editingId;

  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState('');
  const [autofillUrl, setAutofillUrl] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [repeat, setRepeat] = useState<RepeatKind>('once');
  const [nextRunAt, setNextRunAt] = useState<number>(nextDefault());
  const [customMinutes, setCustomMinutes] = useState<number>(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hydrating, setHydrating] = useState(false);

  // Re-prime whenever the dialog (re)opens, the prefill swaps, or we
  // switch into edit mode for a different id. We don't reset on close —
  // a slip-of-the-finger dismiss shouldn't lose unsaved edits.
  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setError(null);
    setConfirmingDelete(false);

    if (isEditing && editingId) {
      // Edit mode — pull the canonical action + any linked schedule.
      setHydrating(true);
      void Promise.all([savedPromptsStorage.get(), scheduledTasksStorage.get()])
        .then(([saved, scheduled]) => {
          const action: SavedPrompt | undefined = saved.prompts.find(p => p.id === editingId);
          const task: ScheduledTask | undefined = scheduled.tasks.find(t => t.id === editingId);
          if (!action) {
            setError('That action no longer exists.');
            setHydrating(false);
            return;
          }
          setName(action.name);
          setCommand(action.command ?? '');
          setPrompt(action.prompt);
          setUrl(action.url ?? '');
          setAutofillUrl(false);
          if (task) {
            setScheduleEnabled(true);
            setRepeat(task.repeat);
            setNextRunAt(task.nextRunAt);
            setCustomMinutes(task.customMinutes ?? 60);
          } else {
            setScheduleEnabled(false);
            setRepeat('once');
            setNextRunAt(nextDefault());
            setCustomMinutes(60);
          }
          setHydrating(false);
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : 'Failed to load action');
          setHydrating(false);
        });
      return;
    }

    // Create mode — seed from `prefill`.
    const seed = prefill ?? { prompt: '' };
    setName(seed.name?.trim() || deriveName(seed.prompt));
    setCommand(seed.command ? sanitizeCommand(seed.command) : '');
    setPrompt(seed.prompt);
    if (seed.schedule) {
      setScheduleEnabled(true);
      setRepeat(seed.schedule.repeat);
      setNextRunAt(seed.schedule.nextRunAt ?? nextDefault());
      setCustomMinutes(seed.schedule.customMinutes ?? 60);
    } else {
      setScheduleEnabled(false);
      setRepeat('once');
      setNextRunAt(nextDefault());
      setCustomMinutes(60);
    }

    if (seed.url) {
      setUrl(seed.url);
      setAutofillUrl(false);
    } else {
      setUrl('');
      setAutofillUrl(false);
      // Auto-pick the active tab origin so single-message saves capture
      // the page the user is already working on. Only http(s) — never
      // chrome:// or extension URLs.
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => {
          const candidate = tab?.url ?? '';
          if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
            try {
              setUrl(new URL(candidate).origin);
              setAutofillUrl(true);
            } catch {
              /* malformed — leave field empty */
            }
          }
        })
        .catch(() => undefined);
    }
  }, [open, prefill, isEditing, editingId]);

  const canSave = useMemo(
    () => !loading && !saving && !hydrating && name.trim().length > 0 && prompt.trim().length > 0,
    [loading, saving, hydrating, name, prompt],
  );

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedCommand = sanitizeCommand(command);

      // Slash command uniqueness — but only against OTHER actions when
      // editing, so the user can re-save the same record without it
      // colliding with itself.
      if (trimmedCommand) {
        const existing = await savedPromptsStorage.findByCommand(trimmedCommand);
        if (existing && existing.id !== editingId) {
          setError(`/${trimmedCommand} is already in use — pick a different name.`);
          setSaving(false);
          return;
        }
      }

      const trimmedUrl = url.trim();
      if (trimmedUrl) {
        if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
          setError('URL must start with http:// or https://');
          setSaving(false);
          return;
        }
        try {
          new URL(trimmedUrl);
        } catch {
          setError("That URL doesn't look right — double-check it.");
          setSaving(false);
          return;
        }
      }

      const id = editingId ?? newId();
      const existing = isEditing ? (await savedPromptsStorage.get()).prompts.find(p => p.id === id) : undefined;

      const saved: SavedPrompt = {
        id,
        name: name.trim(),
        prompt: prompt.trim(),
        command: trimmedCommand || undefined,
        url: trimmedUrl || undefined,
        glyph: existing?.glyph,
        createdAt: existing?.createdAt ?? Date.now(),
        lastUsedAt: existing?.lastUsedAt,
        invocations: existing?.invocations ?? 0,
      };
      await savedPromptsStorage.upsert(saved);

      if (scheduleEnabled) {
        await scheduledTasksStorage.upsert({
          id,
          name: name.trim(),
          prompt: prompt.trim(),
          url: trimmedUrl || undefined,
          nextRunAt,
          repeat,
          ...(repeat === 'custom_minutes' ? { customMinutes: Math.max(1, customMinutes) } : {}),
          enabled: true,
        });
      } else if (isEditing) {
        // Schedule was previously on and the user just toggled it off.
        // Pull the alarm so the SW dispatcher stops firing for this id.
        const tasks = (await scheduledTasksStorage.get()).tasks;
        if (tasks.some(t => t.id === id)) {
          await scheduledTasksStorage.remove(id);
        }
      }
      chrome.runtime.sendMessage({ type: 'doe/scheduler/reschedule' }).catch(() => undefined);

      onSaved?.({ command: trimmedCommand || undefined, id });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save action.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all([savedPromptsStorage.remove(editingId), scheduledTasksStorage.remove(editingId)]);
      chrome.runtime.sendMessage({ type: 'doe/scheduler/reschedule' }).catch(() => undefined);
      onDeleted?.(editingId);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete action.');
      setSaving(false);
    }
  };

  const headerIcon = isEditing
    ? Pencil
    : source === 'chat'
      ? Sparkles
      : source === 'message'
        ? CalendarPlus
        : Wand2;
  const HeaderIcon = headerIcon;

  const headerTitle = isEditing
    ? `Edit · ${name || 'action'}`
    : source === 'chat'
      ? 'Save chat as action'
      : source === 'message'
        ? 'Save as action'
        : 'New action';

  const headerDescription = isEditing
    ? 'Tweak the prompt, schedule, or where it runs. Changes apply immediately.'
    : source === 'chat'
      ? 'doeverything distilled this conversation into a replayable action. Edit anything you like before saving.'
      : 'Save this prompt so doeverything can run it again — by slash command, on a schedule, or both.';

  const showLoading = loading || hydrating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-0">
        <div className="from-primary/10 via-background to-background bg-gradient-to-br px-6 pb-4 pt-6">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="bg-primary/15 ring-primary/20 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1">
                <HeaderIcon className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base">{headerTitle}</DialogTitle>
                <DialogDescription className="mt-1">{headerDescription}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-6 px-6 pb-2">
          {showLoading ? (
            <DistillingSkeleton chat={source === 'chat'} />
          ) : (
            <>
              <Section icon={Hash} title="Basics" hint="Give it a name and an optional slash shortcut">
                <Field label="Name">
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily inbox triage" />
                </Field>
                <Field
                  label="Slash command"
                  optional
                  hint={
                    command ? (
                      <>
                        Type <SlashChip>{command}</SlashChip> in the composer to run this.
                      </>
                    ) : (
                      'Adds a /shortcut so you can launch this action from anywhere.'
                    )
                  }>
                  <div className="bg-muted/50 focus-within:ring-primary/30 flex items-center overflow-hidden rounded-md border focus-within:ring-2">
                    <span className="text-muted-foreground flex h-9 items-center px-3 font-mono text-sm">/</span>
                    <input
                      value={command}
                      onChange={e => setCommand(sanitizeCommand(e.target.value))}
                      placeholder="research"
                      className="bg-transparent placeholder:text-muted-foreground/60 h-9 w-full border-0 px-0 py-0 font-mono text-sm focus:outline-none"
                    />
                  </div>
                </Field>
              </Section>

              <Section icon={Globe} title="Where to run" hint="doeverything can land on a specific site before running the prompt">
                <Field
                  label="Starting URL"
                  optional
                  hint={
                    url
                      ? autofillUrl
                        ? `Auto-detected from your active tab — clear it to run wherever you are.`
                        : `doeverything opens ${originOf(url)} before running the prompt.`
                      : 'Leave empty to run on whichever tab is active when the action fires.'
                  }>
                  <div
                    className={cn(
                      'bg-muted/50 focus-within:ring-primary/30 flex items-center overflow-hidden rounded-md border focus-within:ring-2',
                      url && 'bg-background',
                    )}>
                    <span className="text-muted-foreground flex h-9 items-center px-3">
                      <Link2 className="h-3.5 w-3.5" />
                    </span>
                    <input
                      type="url"
                      value={url}
                      onChange={e => {
                        setUrl(e.target.value);
                        setAutofillUrl(false);
                      }}
                      placeholder="https://mail.google.com"
                      className="bg-transparent placeholder:text-muted-foreground/60 h-9 w-full border-0 px-0 py-0 text-sm focus:outline-none"
                    />
                    {autofillUrl && (
                      <span className="bg-primary/10 text-primary mr-2 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                        <Zap className="h-3 w-3" /> auto
                      </span>
                    )}
                  </div>
                </Field>
                <Field label="Prompt">
                  <Textarea
                    rows={6}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="What should doeverything do when this runs?"
                    className="text-sm leading-relaxed"
                  />
                </Field>
              </Section>

              <Section
                icon={Clock}
                title="Schedule"
                hint={scheduleEnabled ? 'doeverything fires this even when Chrome was just opened' : 'Off — runs only when you call it'}
                trailing={<Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} aria-label="Enable schedule" />}>
                <div
                  className={cn(
                    'grid grid-cols-2 gap-3 transition-all duration-200',
                    !scheduleEnabled && 'pointer-events-none opacity-30',
                  )}>
                  <Field label="Repeat">
                    <Select value={repeat} onValueChange={value => setRepeat(value as RepeatKind)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPEAT_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={o.value}>
                            <div className="flex flex-col">
                              <span>{o.label}</span>
                              <span className="text-muted-foreground text-[11px]">{o.helper}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={repeat === 'once' ? 'Run at' : 'First run'}>
                    <Input
                      type="datetime-local"
                      value={toLocalInput(nextRunAt)}
                      onChange={e => {
                        const t = new Date(e.target.value).getTime();
                        if (!Number.isNaN(t)) setNextRunAt(t);
                      }}
                      className="h-9"
                    />
                  </Field>
                  {repeat === 'custom_minutes' && (
                    <Field label="Every (minutes)" className="col-span-2">
                      <Input
                        type="number"
                        min={1}
                        value={customMinutes}
                        onChange={e => setCustomMinutes(Math.max(1, Number(e.target.value) || 1))}
                        className="h-9 w-32"
                      />
                    </Field>
                  )}
                </div>
              </Section>

              {error && (
                <div className="text-destructive bg-destructive/10 border-destructive/20 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-border/60 mt-4 flex-row items-center gap-2 border-t bg-muted/30 px-6 py-3 sm:justify-between">
          {/* Edit mode places a Delete affordance on the left; create mode keeps the row right-aligned. */}
          <div className="flex flex-1 items-center gap-2">
            {isEditing &&
              !showLoading &&
              (confirmingDelete ? (
                <div className="text-destructive flex items-center gap-2 text-xs">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Delete this action?</span>
                  <Button size="sm" variant="destructive" onClick={handleDelete} disabled={saving}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={saving}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(true)}
                  className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              ))}
          </div>
          {!confirmingDelete && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button disabled={!canSave} onClick={handleSave}>
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                  </>
                ) : isEditing ? (
                  'Save changes'
                ) : (
                  'Save action'
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Layout primitives                                                         */
/* -------------------------------------------------------------------------- */

function Section({
  icon: Icon,
  title,
  hint,
  trailing,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="bg-muted/60 mt-0.5 flex h-6 w-6 items-center justify-center rounded-md">
            <Icon className="text-muted-foreground h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
          </div>
        </div>
        {trailing && <div className="shrink-0 pt-0.5">{trailing}</div>}
      </div>
      <div className="space-y-3 pl-8">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  optional,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label className="flex items-center gap-1.5 text-xs font-medium">
        {label}
        {optional && <span className="text-muted-foreground/70 text-[10px] uppercase tracking-wide">optional</span>}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px] leading-relaxed">{hint}</p>}
    </div>
  );
}

function SlashChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-primary/10 text-primary inline-flex items-baseline rounded px-1.5 py-0.5 font-mono text-[11px]">
      /{children}
    </span>
  );
}

function DistillingSkeleton({ chat }: { chat: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 py-2">
        <div className="bg-primary/15 flex h-8 w-8 items-center justify-center rounded-full">
          {chat ? (
            <Sparkles className="text-primary h-4 w-4 animate-pulse" />
          ) : (
            <Calendar className="text-primary h-4 w-4 animate-pulse" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Distilling the conversation…</p>
          <p className="text-muted-foreground text-xs">Reading the chat and turning it into a replayable action.</p>
        </div>
      </div>
      <div className="space-y-3">
        <SkeletonRow />
        <SkeletonRow wide />
        <SkeletonRow short />
      </div>
    </div>
  );
}

function SkeletonRow({ wide, short }: { wide?: boolean; short?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="bg-muted/70 h-3 w-16 animate-pulse rounded" />
      <div className={cn('bg-muted/40 h-9 animate-pulse rounded-md', wide ? 'w-full' : short ? 'w-1/2' : 'w-3/4')} />
    </div>
  );
}
