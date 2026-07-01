import { Badge, Button, Card, CardContent, cn } from '@doeverything/ui';
import { ChevronDown, ChevronRight, CircleDot, Loader2, Pause, Sparkles } from 'lucide-react';
import { useState } from 'react';

/**
 * Extra chat-area widgets that didn't fit into AssistantBlocks.tsx —
 * timeline orchestrator, shortcut chip, status pill,
 * and the empty-state prompt grid.
 */

/* TimelineOrchestrator                                               */
export interface TimelineEvent {
  id: string;
  kind: 'tool_call' | 'message' | 'plan_step' | 'navigation';
  title: string;
  detail?: string;
  status?: 'done' | 'running' | 'error';
  ts: number;
}

export function TimelineOrchestrator({ events }: { events: TimelineEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;
  const visible = expanded ? events : events.slice(-3);
  return (
    <Card className="border-primary/30 my-2 border-dashed">
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors duration-150">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Timeline · {events.length} steps
        </button>
        <ol className="mt-2 space-y-1.5">
          {visible.map(ev => (
            <li key={ev.id} className="flex items-start gap-2 text-xs">
              <CircleDot
                className={cn(
                  'mt-0.5 h-3 w-3 shrink-0',
                  ev.status === 'running'
                    ? 'text-primary animate-pulse'
                    : ev.status === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                )}
              />
              <div className="flex flex-col">
                <span className="font-mono text-[11px]">{ev.title}</span>
                {ev.detail && <span className="text-muted-foreground text-[10px]">{ev.detail}</span>}
              </div>
            </li>
          ))}
        </ol>
        {!expanded && events.length > 3 && (
          <p className="text-muted-foreground mt-1 text-[10px]">
            …{events.length - 3} earlier hidden — click to expand
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ShortcutChip — inline `[[shortcut:id:name]]` rendering              */
export function ShortcutChip({ id, name, onClick }: { id: string; name: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-secondary text-secondary-foreground hover:bg-secondary/80 mx-0.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 align-middle text-[11px] font-medium transition-colors duration-150"
      data-shortcut-id={id}>
      <Sparkles className="text-primary h-3 w-3" />
      {name}
    </button>
  );
}

/** Replace `[[shortcut:id:name]]` tokens in a string with `<ShortcutChip>`s. */
export function renderWithShortcuts(text: string, onClick?: (id: string) => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[\[shortcut:([^:\]]+):([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    out.push(
      <ShortcutChip
        key={`${match[1]}-${match.index}`}
        id={match[1]}
        name={match[2]}
        onClick={() => onClick?.(match![1])}
      />,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

/* StatusPill                                                          */
export function StatusPill({
  status,
}: {
  status: 'idle' | 'thinking' | 'acting' | 'paused' | 'compacting' | 'done' | 'error';
}) {
  if (status === 'idle') return null;
  const meta: Record<
    typeof status,
    { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    thinking: { label: 'Thinking…', tone: 'bg-primary/10 text-primary', icon: Loader2 },
    acting: { label: 'Acting…', tone: 'bg-primary/10 text-primary', icon: Loader2 },
    paused: { label: 'Paused', tone: 'bg-warning/10 text-warning', icon: Pause },
    compacting: { label: 'Compacting…', tone: 'bg-secondary text-secondary-foreground', icon: Loader2 },
    done: { label: 'Done', tone: 'bg-success/10 text-success', icon: CircleDot },
    error: { label: 'Error', tone: 'bg-destructive/10 text-destructive', icon: CircleDot },
  };
  const m = meta[status];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn('gap-1.5 border-0 text-[10px] uppercase tracking-wide', m.tone)}>
      <Icon
        className={cn(
          'h-3 w-3',
          (status === 'thinking' || status === 'acting' || status === 'compacting') && 'animate-spin',
        )}
      />
      {m.label}
    </Badge>
  );
}

/* EmptyStatePrompts                                                   */
const EMPTY_CATEGORIES: Array<{ title: string; prompts: string[] }> = [
  {
    title: 'Browse & Explore',
    prompts: [
      'Open Hacker News and summarise the top 5 stories',
      'Compare prices for an iPhone 15 across Amazon, BestBuy, and Apple',
    ],
  },
  {
    title: 'Analyse',
    prompts: ['Read the current page and explain it in 3 bullets', 'Extract every link in this article into a CSV'],
  },
  {
    title: 'Automate',
    prompts: [
      'Open Gmail and tell me how many unread newsletters I have',
      'Schedule a daily check on /r/typescript top posts',
    ],
  },
];

export function EmptyStatePrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 px-2 md:grid-cols-2">
      {EMPTY_CATEGORIES.map((cat, i) => (
        <Card key={cat.title} className="de-fade-up border-dashed" style={{ animationDelay: `${i * 40}ms` }}>
          <CardContent className="space-y-1.5 p-3">
            <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">{cat.title}</div>
            {cat.prompts.map(p => (
              <Button
                key={p}
                variant="ghost"
                size="sm"
                onClick={() => onPick(p)}
                className="h-auto w-full justify-start whitespace-normal text-left text-xs">
                {p}
              </Button>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* Banner family (MessageLimit / Paid / FallbackModel)                  */
export function MessageLimitBanner({ remaining, onUpgrade }: { remaining: number; onUpgrade: () => void }) {
  if (remaining > 5) return null;
  return (
    <div className="border-warning/25 bg-warning/10 flex items-center gap-2 border-b px-3 py-2 text-xs">
      <span className="flex-1">Only {remaining} messages left in this session.</span>
      <Button size="sm" variant="outline" onClick={onUpgrade}>
        Upgrade
      </Button>
    </div>
  );
}

export function PaidPlanBanner({ onLearnMore }: { onLearnMore: () => void }) {
  return (
    <div className="border-primary/25 bg-primary/10 flex items-center gap-2 border-b px-3 py-2 text-xs">
      <Sparkles className="text-primary h-3.5 w-3.5" />
      <span className="flex-1">doeverything Pro is live — unlimited tasks, priority queue.</span>
      <Button size="sm" variant="outline" onClick={onLearnMore}>
        Learn more
      </Button>
    </div>
  );
}

export function FallbackModelBanner({
  from,
  to,
  onSwitchBack,
}: {
  from: string;
  to: string;
  onSwitchBack: () => void;
}) {
  return (
    <div className="border-border/60 bg-secondary text-secondary-foreground flex items-center gap-2 border-b px-3 py-2 text-xs">
      <span className="flex-1">
        doeverything fell back from <code>{from}</code> to <code>{to}</code> — likely rate-limited.
      </span>
      <Button size="sm" variant="outline" onClick={onSwitchBack}>
        Retry
      </Button>
    </div>
  );
}
