import { useStorage } from '@doeverything/shared';
import { preferencesStorage } from '@doeverything/storage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@doeverything/ui';
import { HelpCircle, ListChecks, ShieldCheck, ShieldOff } from 'lucide-react';
import type { PermissionMode } from '@doeverything/storage';

interface ModeMeta {
  id: PermissionMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MODES: ReadonlyArray<ModeMeta> = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Pause before every sensitive action.',
    icon: HelpCircle,
  },
  {
    id: 'follow_a_plan',
    label: 'Plan',
    description: 'Approve a plan once, then run without prompts.',
    icon: ListChecks,
  },
  {
    id: 'allow_for_site',
    label: 'Site',
    description: 'Allow this domain for the session.',
    icon: ShieldCheck,
  },
  {
    id: 'skip_all_permission_checks',
    label: 'Skip',
    description: 'No prompts — full trust.',
    icon: ShieldOff,
  },
];

interface Props {
  className?: string;
}

export function PermissionModeSelector({ className }: Props) {
  const prefs = useStorage(preferencesStorage);
  const current = MODES.find(m => m.id === prefs.permissionMode) ?? MODES[0];
  const Icon = current.icon;

  return (
    <Select
      value={prefs.permissionMode}
      onValueChange={(v: string) => preferencesStorage.setPermissionMode(v as PermissionMode)}>
      <SelectTrigger
        aria-label={`Permission mode: ${current.label}`}
        title={current.description}
        className={cn(
          'hover:bg-accent h-7 w-auto gap-1 rounded-md border-0 bg-transparent px-2 text-[11px] font-medium shadow-none transition-colors duration-150',
          className,
        )}>
        <Icon className="text-primary h-3 w-3" />
        <SelectValue>{current.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {MODES.map(mode => {
          const ItemIcon = mode.icon;
          return (
            <SelectItem key={mode.id} value={mode.id}>
              <span className="flex items-center gap-2">
                <ItemIcon className="text-primary h-3.5 w-3.5 shrink-0" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{mode.label}</span>
                  <span className="text-muted-foreground text-[11px]">{mode.description}</span>
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
