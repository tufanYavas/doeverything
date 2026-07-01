import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@doeverything/ui';
import { ShieldCheck, ShieldX, Globe, MousePointerClick, Keyboard, Network } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Listens for `doe/permission/request` messages from the service worker
 * and renders a modal that resolves the request via
 * `doe/permission/decision`. Only one prompt is shown at a time —
 * additional requests stack and surface in order.
 *
 * Keyboard:
 *   - Enter         → Allow once
 *   - Cmd/Ctrl+Enter → Always allow this site
 *   - Escape        → Deny
 */

type PermissionKind = 'navigate' | 'click' | 'type' | 'browser_control' | 'mcp';

interface PermissionRequest {
  id: string;
  host: string;
  kind: PermissionKind;
  reason?: string;
  preview?: string;
}

const KIND_META: Record<PermissionKind, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  navigate: { title: 'Open this URL', icon: Globe },
  click: { title: 'Click on this page', icon: MousePointerClick },
  type: { title: 'Type into a field', icon: Keyboard },
  browser_control: { title: 'Control your browser', icon: ShieldCheck },
  mcp: { title: 'Use an MCP tool', icon: Network },
};

export function PermissionPrompt() {
  const [queue, setQueue] = useState<PermissionRequest[]>([]);
  const current = queue[0];

  useEffect(() => {
    const listener = (raw: unknown) => {
      const msg = raw as { type?: string; request?: PermissionRequest } | null;
      if (msg?.type !== 'doe/permission/request' || !msg.request) return;
      setQueue(q => [...q, msg.request as PermissionRequest]);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        decide('always');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        decide('once');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        decide('deny');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;
  const meta = KIND_META[current.kind];
  const Icon = meta.icon;

  const decide = (kind: 'once' | 'session' | 'always' | 'deny') => {
    chrome.runtime
      .sendMessage({
        type: 'doe/permission/decision',
        requestId: current.id,
        decision: kind === 'deny' ? { allow: false } : { allow: true, scope: kind },
      })
      .catch(() => undefined);
    setQueue(q => q.slice(1));
  };

  return (
    <Dialog open onOpenChange={open => !open && decide('deny')}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="bg-primary/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full">
            <Icon className="text-primary h-5 w-5" />
          </div>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription className="space-y-1">
            <span>
              doeverything wants to act on{' '}
              <code className="border-border/70 bg-muted/60 rounded-md border px-1 py-0.5 text-xs">{current.host}</code>.
            </span>
            {current.reason && <span className="block text-xs">{current.reason}</span>}
            {current.preview && (
              <span className="border-border/60 bg-muted/30 mt-2 block max-h-24 overflow-auto rounded-lg border p-2 font-mono text-[11px] leading-snug">
                {current.preview}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => decide('deny')}>
            <ShieldX className="h-4 w-4" /> Deny
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => decide('once')}>
              Allow once
            </Button>
            <Button onClick={() => decide('always')}>Always allow</Button>
          </div>
        </DialogFooter>
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-[10px]">
          <kbd className="border-border/70 bg-muted/60 rounded-md border px-1.5 py-0.5 font-mono text-[11px] shadow-[inset_0_-1px_0_hsl(var(--shadow)/0.08)]">
            Enter
          </kbd>
          Allow once ·
          <kbd className="border-border/70 bg-muted/60 rounded-md border px-1.5 py-0.5 font-mono text-[11px] shadow-[inset_0_-1px_0_hsl(var(--shadow)/0.08)]">
            ⌘↵
          </kbd>
          Always ·
          <kbd className="border-border/70 bg-muted/60 rounded-md border px-1.5 py-0.5 font-mono text-[11px] shadow-[inset_0_-1px_0_hsl(var(--shadow)/0.08)]">
            Esc
          </kbd>
          Deny
        </p>
      </DialogContent>
    </Dialog>
  );
}
