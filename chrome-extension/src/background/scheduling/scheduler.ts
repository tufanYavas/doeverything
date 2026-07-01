/**
 * Scheduled task scheduler — Phase 8.
 *
 * Each task in `scheduledTasksStorage` maps to a `chrome.alarms` alarm with
 * the same name. The SW boot rebuilds alarms from storage so scheduling
 * survives service-worker eviction.
 *
 * When an alarm fires, the dispatcher queues the task's prompt via the same
 * onboarding-prompt mechanism the new tab launcher uses — the side panel
 * picks it up and the agent runs it as if the user typed it.
 */

import { queueOnboardingPrompt, openSidePanelForActiveWindow } from '../handlers/onboarding.js';
import { TabGroupManager } from '../tabs/group-manager.js';
import { scheduledTasksStorage } from '@doeverything/storage';
import type { RepeatKind, ScheduledTask } from '@doeverything/storage';

const ALARM_PREFIX = 'doe:task:';
const RETRY_PREFIX = 'doe:task-retry:';
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MIN = [1, 5, 15]; // minutes between attempts

function alarmName(taskId: string) {
  return `${ALARM_PREFIX}${taskId}`;
}

function repeatToPeriodMinutes(repeat: RepeatKind, customMinutes?: number): number | undefined {
  switch (repeat) {
    case 'daily':
      return 60 * 24;
    case 'weekly':
      return 60 * 24 * 7;
    case 'monthly':
      return 60 * 24 * 30; // approximation; chrome.alarms doesn't do calendar arithmetic
    case 'custom_minutes':
      return Math.max(1, customMinutes ?? 60);
    case 'once':
    default:
      return undefined;
  }
}

export async function scheduleTask(task: ScheduledTask) {
  if (!task.enabled) {
    await chrome.alarms.clear(alarmName(task.id));
    return;
  }
  const period = repeatToPeriodMinutes(task.repeat, task.customMinutes);
  await chrome.alarms.create(alarmName(task.id), {
    when: task.nextRunAt > Date.now() ? task.nextRunAt : Date.now() + 5_000,
    periodInMinutes: period,
  });
}

export async function rescheduleAll() {
  const state = await scheduledTasksStorage.get();
  // Clear orphan alarms first.
  const all = await chrome.alarms.getAll();
  for (const alarm of all) {
    if (alarm.name.startsWith(ALARM_PREFIX)) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  for (const task of state.tasks) {
    await scheduleTask(task);
  }
}

async function executeTask(task: ScheduledTask, attempt = 0) {
  try {
    // Open a fresh window so the scheduled task doesn't disturb whatever
    // the user is doing right now, then adopt that window's first tab into
    // the doeverything group so the indicator marks it.
    try {
      // If the task has a starting URL, open the new window directly on
      // it — that way the agent doesn't have to spend its first turn
      // navigating, and `about:blank` doesn't show up in the user's
      // history. Fall back to about:blank when no URL is set.
      const startUrl = (task.url ?? '').trim() || 'about:blank';
      const win = await chrome.windows.create({ focused: false, url: startUrl, type: 'normal' });
      const newTabId = win.tabs?.[0]?.id;
      if (newTabId) await TabGroupManager.adoptTab(newTabId);
    } catch {
      // If window creation fails (rare), fall through to the active-window flow.
    }
    await queueOnboardingPrompt(task.prompt);
    await openSidePanelForActiveWindow();
    await scheduledTasksStorage.recordRun(task.id, true);
    await maybeNotify(task, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await scheduledTasksStorage.recordRun(task.id, false, message);
    if (attempt < MAX_RETRIES) {
      const delayMin = RETRY_BACKOFF_MIN[attempt] ?? 30;
      await chrome.alarms.create(`${RETRY_PREFIX}${task.id}:${attempt + 1}`, {
        when: Date.now() + delayMin * 60_000,
      });
      console.warn(`[doeverything] task ${task.id} failed (attempt ${attempt + 1}); retry in ${delayMin}m`);
    } else {
      await maybeNotify(task, false, message);
    }
  }
}

async function maybeNotify(task: ScheduledTask, success: boolean, error?: string) {
  try {
    await chrome.notifications.create(`de-task-${task.id}-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: success ? `doeverything · ${task.name}` : `doeverything task failed`,
      message: success ? 'Task fired. The side panel is running it.' : (error ?? 'Unknown error'),
    });
  } catch {
    // Notifications permission not granted; silent.
  }
}

export function registerScheduler() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string } | null;
    if (msg?.type === 'doe/scheduler/reschedule') {
      void rescheduleAll();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name.startsWith(RETRY_PREFIX)) {
      const remainder = alarm.name.slice(RETRY_PREFIX.length);
      const [taskId, attemptStr] = remainder.split(':');
      const attempt = Number(attemptStr) || 0;
      const state = await scheduledTasksStorage.get();
      const task = state.tasks.find(t => t.id === taskId);
      if (task && task.enabled) await executeTask(task, attempt);
      return;
    }
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    const id = alarm.name.slice(ALARM_PREFIX.length);
    const state = await scheduledTasksStorage.get();
    const task = state.tasks.find(t => t.id === id);
    if (!task || !task.enabled) return;
    await executeTask(task);
    if (task.repeat === 'once') {
      await scheduledTasksStorage.setEnabled(task.id, false);
    }
  });

  // Re-create alarms after SW boot.
  void rescheduleAll();
}
