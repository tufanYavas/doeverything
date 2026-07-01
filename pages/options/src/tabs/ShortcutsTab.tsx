import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@doeverything/ui';
import { AlertCircle, ExternalLink, Keyboard, PanelRight } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * ShortcutsTab — shows the REAL state of every binding instead of a
 * hardcoded list. Global (browser-level) commands come from
 * `chrome.commands.getAll()`, so an unassigned or conflict-skipped
 * suggested key (Chrome silently drops e.g. Ctrl+E when another extension
 * or the browser already claims it) shows up as "Not set" with a pointer
 * to chrome://extensions/shortcuts rather than pretending it works.
 */

const COMMAND_LABELS: Record<string, string> = {
  'toggle-side-panel': 'Toggle doeverything side panel',
  'new-conversation': 'Open panel & start a new conversation',
  'stop-agent': 'Stop the running agent',
  'open-options': 'Open doeverything settings',
  _execute_action: 'Activate the toolbar button',
};

const isMac = navigator.userAgent.includes('Mac');
const MOD = isMac ? '⌘' : 'Ctrl';

/** Side-panel-scoped bindings (handled by useKeyboardShortcuts + the composer). */
const PANEL_SHORTCUTS = [
  { label: 'Send message', keys: ['Enter'], description: 'Inside the side panel composer.' },
  { label: 'New line in composer', keys: ['Shift', 'Enter'] },
  { label: 'Focus the composer', keys: [MOD, '/'] },
  { label: 'New conversation', keys: [MOD, '\\'] },
  { label: 'Toggle theme', keys: [MOD, 'J'] },
  { label: 'Open settings', keys: [MOD, ','], description: 'These work while the side panel has focus.' },
];

export function ShortcutsTab() {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);

  useEffect(() => {
    chrome.commands.getAll().then(setCommands);
  }, []);

  const openChromeShortcuts = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Shortcuts</h2>
        <p className="text-muted-foreground mt-1 text-sm">Keyboard bindings used by doeverything.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard className="text-primary h-4 w-4" /> Browser shortcuts
          </CardTitle>
          <CardDescription>
            Work anywhere in Chrome. Assignments are managed on Chrome's shortcuts page — if a key shows "Not set",
            Chrome skipped it (usually a conflict with the browser or another extension); assign one there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {commands.map(cmd => {
            const name = cmd.name ?? '';
            const label = COMMAND_LABELS[name] ?? cmd.description ?? name;
            return (
              <div
                key={name}
                className="border-border/60 flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
                <div className="text-sm font-medium">{label}</div>
                {cmd.shortcut ? (
                  <kbd className="border-border/70 bg-muted/60 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] shadow-[inset_0_-1px_0_hsl(var(--shadow)/0.08)]">
                    {cmd.shortcut}
                  </kbd>
                ) : (
                  <Badge variant="warning" className="shrink-0 gap-1">
                    <AlertCircle className="h-3 w-3" /> Not set
                  </Badge>
                )}
              </div>
            );
          })}

          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={openChromeShortcuts}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open <span className="font-mono text-xs">chrome://extensions/shortcuts</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PanelRight className="text-primary h-4 w-4" /> Side panel shortcuts
          </CardTitle>
          <CardDescription>Active while the doeverything side panel has keyboard focus.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PANEL_SHORTCUTS.map(s => (
            <div
              key={s.label}
              className="border-border/60 flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
              <div>
                <div className="text-sm font-medium">{s.label}</div>
                {s.description && <div className="text-muted-foreground text-xs">{s.description}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {s.keys.map(key => (
                  <kbd
                    key={key}
                    className="border-border/70 bg-muted/60 rounded-md border px-1.5 py-0.5 font-mono text-[11px] shadow-[inset_0_-1px_0_hsl(var(--shadow)/0.08)]">
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
