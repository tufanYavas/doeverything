import { Button, cn } from '@doeverything/ui';
import { AlertTriangle, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Top-of-panel banner manager.
 *
 * Subscribes to `chrome.storage.local` for the well-known keys:
 *
 *   - de:update-available  → "A new version is available — restart"
 *   - de:notification      → ad-hoc text message from the SW
 *
 * Each banner remembers its dismissal under a paired `dismissed:<key>` flag
 * so the user only sees it once per signal.
 */

interface Banner {
  id: string;
  tone: 'info' | 'warning';
  message: string;
  cta?: { label: string; action: () => void };
}

export function NotificationBanner() {
  const [banners, setBanners] = useState<Banner[]>([]);

  useEffect(() => {
    const refresh = async () => {
      const items: Banner[] = [];
      const record = await chrome.storage.local.get([
        'doe:update-available',
        'doe:notification',
        'doe:dismissed-banners',
      ]);
      const dismissed = (record?.['doe:dismissed-banners'] as string[] | undefined) ?? [];
      const dismissedSet = new Set(dismissed);

      const update = record?.['doe:update-available'] as { version?: string } | undefined;
      if (update?.version && !dismissedSet.has(`update:${update.version}`)) {
        items.push({
          id: `update:${update.version}`,
          tone: 'warning',
          message: `doeverything ${update.version} is ready. Restart Chrome to update.`,
          cta: {
            label: 'Restart',
            action: () => chrome.runtime.reload(),
          },
        });
      }

      const note = record?.['doe:notification'] as
        | { id?: string; text?: string; tone?: 'info' | 'warning' }
        | undefined;
      if (note?.id && note.text && !dismissedSet.has(`note:${note.id}`)) {
        items.push({ id: `note:${note.id}`, tone: note.tone ?? 'info', message: note.text });
      }

      setBanners(items);
    };
    refresh();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => {
      if (area !== 'local') return;
      if (
        changes['doe:update-available'] ||
        changes['doe:notification'] ||
        changes['doe:dismissed-banners']
      ) {
        refresh();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const dismiss = async (bannerId: string) => {
    const record = await chrome.storage.local.get('doe:dismissed-banners');
    const list = (record?.['doe:dismissed-banners'] as string[] | undefined) ?? [];
    await chrome.storage.local.set({ 'doe:dismissed-banners': [...list, bannerId] });
  };

  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col">
      {banners.map(banner => {
        const Icon = banner.tone === 'warning' ? AlertTriangle : Info;
        return (
          <div
            key={banner.id}
            className={cn(
              'flex items-center gap-2 border-b px-3 py-2 text-xs',
              banner.tone === 'warning'
                ? 'border-warning/25 bg-warning/10 text-foreground'
                : 'border-primary/25 bg-primary/10',
            )}>
            <Icon className={cn('h-4 w-4 shrink-0', banner.tone === 'warning' ? 'text-warning' : 'text-primary')} />
            <span className="flex-1">{banner.message}</span>
            {banner.cta && (
              <Button size="sm" variant="outline" onClick={banner.cta.action}>
                {banner.cta.label}
              </Button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(banner.id)}
              className="text-muted-foreground hover:text-foreground rounded p-0.5">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
