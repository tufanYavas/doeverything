import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@doeverything/ui';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * VersionBlockScreen.
 *
 * Shown when the SW writes `doe:version-block` in storage (e.g. the
 * remote feature-flag endpoint reports "minimum supported version is X").
 * Forces an extension reload to pick up the new build.
 */

interface BlockState {
  required: string;
  current: string;
  reason?: string;
}

export function VersionBlockScreen() {
  const [block, setBlock] = useState<BlockState | null>(null);

  useEffect(() => {
    const KEY = 'doe:version-block';
    chrome.storage.local.get(KEY).then(record => {
      const value = record?.[KEY] as BlockState | undefined;
      if (value) setBlock(value);
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[KEY]) setBlock((changes[KEY].newValue as BlockState | null) ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (!block) return null;
  return (
    <div className="bg-background flex h-full items-center justify-center p-6">
      <Card className="border-destructive/25 w-full max-w-md">
        <CardHeader>
          <div className="bg-destructive/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full">
            <AlertOctagon className="text-destructive h-5 w-5" />
          </div>
          <CardTitle>Update doeverything to continue</CardTitle>
          <CardDescription>
            This build (<code>{block.current}</code>) is too old. Required: <code>{block.required}</code>.
            {block.reason && <span className="mt-2 block">{block.reason}</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => chrome.runtime.reload()}>
            <RefreshCw className="h-4 w-4" /> Reload extension
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
