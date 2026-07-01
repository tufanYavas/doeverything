import { useEffect } from 'react';

const QUEUE_KEY = 'doe:queued-prompt';

interface QueuedPrompt {
  prompt: string;
  createdAt: number;
}

/**
 * Drain prompts queued by the new tab launcher into the side panel. Calls `onPrompt(text)` for each queued prompt and clears
 * the queue immediately so a re-mount doesn't replay it.
 */
export function useQueuedPrompt(onPrompt: (text: string) => void) {
  useEffect(() => {
    let active = true;

    const drain = async () => {
      try {
        const record = await chrome.storage.local.get(QUEUE_KEY);
        const entry = record?.[QUEUE_KEY] as QueuedPrompt | undefined;
        if (!entry || !active) return;
        await chrome.storage.local.remove(QUEUE_KEY);
        if (entry.prompt?.trim()) onPrompt(entry.prompt.trim());
      } catch (err) {
        console.warn('[doeverything] could not drain queued prompt', err);
      }
    };

    drain();

    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
      if (areaName !== 'local') return;
      if (!changes[QUEUE_KEY]?.newValue) return;
      drain();
    };

    chrome.storage.onChanged.addListener(onChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [onPrompt]);
}
