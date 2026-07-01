/**
 * Workflow recorder — Phase 9 skeleton.
 *
 * The recorder listens for tab navigations and (via a future content-script
 * bridge) for click + type events on the active tab; each gets stored as a
 * `RecordedAction`. Phase 9 ships only navigation + manual screenshot
 * actions; click/type capture lands in Phase 23 alongside the in-page
 * ElementSelectorInjector.
 */

import { CdpController } from '../cdp/controller.js';
import { TabEventHub } from '../tabs/event-hub.js';
import { recordingsStorage } from '@doeverything/storage';
import type { RecordedAction } from '@doeverything/storage';

let stopWatchingNav: (() => void) | null = null;

async function captureScreenshot(tabId: number): Promise<string | undefined> {
  try {
    const cdp = CdpController.getInstance();
    const { base64, format } = await cdp.screenshot(tabId, { format: 'jpeg', quality: 60 });
    return `data:image/${format};base64,${base64}`;
  } catch {
    return undefined;
  }
}

function newActionId() {
  return Math.random().toString(36).slice(2, 10);
}

async function recordNavigation(tabId: number, url: string) {
  const action: RecordedAction = {
    id: newActionId(),
    kind: 'navigate',
    timestamp: Date.now(),
    tabId,
    url,
    data: {},
    screenshotDataUrl: await captureScreenshot(tabId),
  };
  await recordingsStorage.appendAction(action);
}

async function startWatching() {
  if (stopWatchingNav) return;
  stopWatchingNav = TabEventHub.onUpdated((tabId, info, tab) => {
    if (info.status === 'complete' && tab.url) {
      void recordNavigation(tabId, tab.url);
    }
  });
}

function stopWatching() {
  stopWatchingNav?.();
  stopWatchingNav = null;
}

const ACTIVE_FLAG_KEY = 'doe:recording-active';

async function pushInPageEvent(action: { kind: string; data: Record<string, unknown> }, tabId: number) {
  // In-page event kinds → recorded action kinds ('change' becomes 'type').
  const kindMap: Record<string, RecordedAction['kind']> = {
    click: 'click',
    change: 'type',
    key: 'key',
    scroll: 'scroll',
  };
  const recordedKind = kindMap[action.kind];
  if (!recordedKind) return;
  const data = action.data ?? {};
  await recordingsStorage.appendAction({
    id: newActionId(),
    kind: recordedKind,
    timestamp: Date.now(),
    tabId,
    url: (data.url as string | undefined) ?? undefined,
    data,
  });
}

export const Recorder = {
  async start(name: string) {
    const recording = await recordingsStorage.start(name);
    await chrome.storage.local.set({ [ACTIVE_FLAG_KEY]: true });
    await startWatching();
    return recording;
  },
  async stop() {
    stopWatching();
    await chrome.storage.local.set({ [ACTIVE_FLAG_KEY]: false });
    return recordingsStorage.stop();
  },
  async snapshot(tabId: number, label?: string) {
    const dataUrl = await captureScreenshot(tabId);
    await recordingsStorage.appendAction({
      id: newActionId(),
      kind: 'screenshot',
      timestamp: Date.now(),
      tabId,
      data: { label: label ?? '' },
      screenshotDataUrl: dataUrl,
    });
  },
  /** Hook the in-page recorder script. Wired by `registerRecordingHandlers`. */
  ingestEvent: pushInPageEvent,
};

/**
 * Generate a natural-language prompt from a recorded sequence so the agent
 * can replay it. This is the "WorkflowGenerator".
 */
export function recordingToPrompt(actions: RecordedAction[], narration?: string): string {
  const steps = actions.map((a, idx) => {
    switch (a.kind) {
      case 'navigate':
        return `${idx + 1}. Navigate to ${a.url}`;
      case 'click': {
        const x = (a.data?.x as number) ?? 0;
        const y = (a.data?.y as number) ?? 0;
        return `${idx + 1}. Click at (${x}, ${y})`;
      }
      case 'type':
        return `${idx + 1}. Type "${a.data?.text ?? ''}"`;
      case 'key':
        return `${idx + 1}. Press ${a.data?.key ?? ''}`;
      case 'scroll':
        return `${idx + 1}. Scroll ${a.data?.direction ?? 'down'}`;
      case 'screenshot':
        return `${idx + 1}. Capture screenshot${a.data?.label ? ` (${a.data.label})` : ''}`;
      default:
        return `${idx + 1}. (unknown action ${(a as { kind?: string }).kind ?? ''})`;
    }
  });

  const narrationLine = narration ? `\n\nUser narration: ${narration}\n` : '';
  return `Replay the following workflow on the user's behalf:${narrationLine}\n\n${steps.join('\n')}\n\nWhen finished, call \`done\` summarising what you did.`;
}
