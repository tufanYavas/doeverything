import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SchedulerModuleType from './scheduler.js';
import type { ChromeState } from '../../../../tests/unit/setup/chrome-mock.js';
import type { ScheduledTask } from '@doeverything/storage';

/**
 * Scheduler maps each enabled task to a chrome.alarms alarm and, on fire,
 * opens a fresh window, queues the prompt, opens the side panel, and records
 * the run. Failures retry with backoff up to MAX_RETRIES, then notify.
 *
 * The chrome-mock only stubs alarms.create + onAlarm.addListener (no clear /
 * getAll) and has no windows.create, so this suite extends those APIs locally
 * (never editing the shared mock). onboarding + group-manager collaborators
 * are vi.mock'd so we assert the orchestration, not their internals.
 */

const onboarding = {
  queueOnboardingPrompt: vi.fn(async () => undefined),
  openSidePanelForActiveWindow: vi.fn(async () => undefined),
};
const groupManager = { adoptTab: vi.fn(async () => 1234) };

vi.mock('../handlers/onboarding.js', () => onboarding);
vi.mock('../tabs/group-manager.js', () => ({ TabGroupManager: groupManager }));

type SchedulerModule = typeof SchedulerModuleType;
const chromeState = () => (globalThis as unknown as { __chromeState: ChromeState }).__chromeState;

interface FakeAlarm {
  name: string;
  scheduledTime?: number;
  periodInMinutes?: number;
}

/** Local alarm store + windows.create, layered over the shared mock per test. */
let alarms: Map<string, FakeAlarm>;

function installAlarmAndWindowStubs() {
  alarms = new Map();
  const c = chrome as unknown as {
    alarms: {
      create: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      getAll: ReturnType<typeof vi.fn>;
      onAlarm: { addListener: ReturnType<typeof vi.fn> };
    };
    windows: { create: ReturnType<typeof vi.fn> };
  };
  c.alarms.create = vi.fn((name: string, info: { when?: number; periodInMinutes?: number }) => {
    alarms.set(name, { name, scheduledTime: info.when, periodInMinutes: info.periodInMinutes });
  });
  c.alarms.clear = vi.fn(async (name: string) => alarms.delete(name));
  c.alarms.getAll = vi.fn(async () => [...alarms.values()]);
  // onAlarm.addListener is the shared vi.fn(); we capture the listener from it.
  c.windows.create = vi.fn(async ({ url }: { url?: string } = {}) => ({
    id: 9001,
    tabs: [{ id: 7777, url: url ?? 'about:blank' }],
  }));
}

/** The listener registered by registerScheduler() against chrome.alarms.onAlarm. */
function getAlarmListener(): (alarm: FakeAlarm) => Promise<void> | void {
  const add = chrome.alarms.onAlarm.addListener as unknown as { mock: { calls: Array<[(a: FakeAlarm) => void]> } };
  return add.mock.calls.at(-1)![0];
}

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return { id: 't1', name: 'Daily', prompt: 'do the thing', nextRunAt: 1000, repeat: 'daily', enabled: true, ...over };
}

async function seedTasks(...tasks: ScheduledTask[]) {
  const { scheduledTasksStorage } = await import('@doeverything/storage');
  for (const t of tasks) await scheduledTasksStorage.upsert(t);
  return { scheduledTasksStorage };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // clearAllMocks wipes call history but NOT implementations, so re-pin the
  // collaborator behaviour each test (a prior test's mockRejectedValue would
  // otherwise leak forward).
  onboarding.queueOnboardingPrompt.mockReset().mockResolvedValue(undefined);
  onboarding.openSidePanelForActiveWindow.mockReset().mockResolvedValue(undefined);
  groupManager.adoptTab.mockReset().mockResolvedValue(1234);
  installAlarmAndWindowStubs();
});

describe('scheduleTask', () => {
  it('clears the alarm for a disabled task and never creates one', async () => {
    const { scheduleTask }: SchedulerModule = await import('./scheduler.js');
    alarms.set('doe:task:t1', { name: 'doe:task:t1' });
    await scheduleTask(task({ enabled: false }));
    expect(alarms.has('doe:task:t1')).toBe(false);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('creates a periodic alarm for a recurring task using a future nextRunAt', async () => {
    const future = Date.now() + 60_000;
    const { scheduleTask }: SchedulerModule = await import('./scheduler.js');
    await scheduleTask(task({ repeat: 'daily', nextRunAt: future }));
    const a = alarms.get('doe:task:t1')!;
    expect(a.scheduledTime).toBe(future);
    expect(a.periodInMinutes).toBe(60 * 24);
  });

  it('a past nextRunAt is clamped to ~now+5s so the alarm still fires soon', async () => {
    const now = Date.now();
    const { scheduleTask }: SchedulerModule = await import('./scheduler.js');
    await scheduleTask(task({ nextRunAt: now - 100_000 }));
    const a = alarms.get('doe:task:t1')!;
    expect(a.scheduledTime).toBeGreaterThanOrEqual(now + 5_000);
    expect(a.scheduledTime).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('maps repeat kinds to the right period (weekly/monthly/custom) and once → no period', async () => {
    const future = Date.now() + 60_000;
    const { scheduleTask }: SchedulerModule = await import('./scheduler.js');

    await scheduleTask(task({ id: 'w', repeat: 'weekly', nextRunAt: future }));
    await scheduleTask(task({ id: 'm', repeat: 'monthly', nextRunAt: future }));
    await scheduleTask(task({ id: 'c', repeat: 'custom_minutes', customMinutes: 42, nextRunAt: future }));
    await scheduleTask(task({ id: 'o', repeat: 'once', nextRunAt: future }));

    expect(alarms.get('doe:task:w')!.periodInMinutes).toBe(60 * 24 * 7);
    expect(alarms.get('doe:task:m')!.periodInMinutes).toBe(60 * 24 * 30);
    expect(alarms.get('doe:task:c')!.periodInMinutes).toBe(42);
    expect(alarms.get('doe:task:o')!.periodInMinutes).toBeUndefined();
  });

  it('custom_minutes floors at 1 minute and defaults to 60 when unset', async () => {
    const future = Date.now() + 60_000;
    const { scheduleTask }: SchedulerModule = await import('./scheduler.js');
    await scheduleTask(task({ id: 'lo', repeat: 'custom_minutes', customMinutes: 0, nextRunAt: future }));
    await scheduleTask(task({ id: 'def', repeat: 'custom_minutes', nextRunAt: future }));
    expect(alarms.get('doe:task:lo')!.periodInMinutes).toBe(1);
    expect(alarms.get('doe:task:def')!.periodInMinutes).toBe(60);
  });
});

describe('rescheduleAll', () => {
  it('clears existing de:task:* alarms and recreates only enabled tasks', async () => {
    // Pre-existing orphan task alarm + an unrelated alarm that must survive.
    alarms.set('doe:task:orphan', { name: 'doe:task:orphan' });
    alarms.set('some-other-feature', { name: 'some-other-feature' });

    await seedTasks(task({ id: 'on', enabled: true, nextRunAt: Date.now() + 60_000 }), task({ id: 'off', enabled: false }));
    const { rescheduleAll }: SchedulerModule = await import('./scheduler.js');
    await rescheduleAll();

    expect(alarms.has('doe:task:orphan')).toBe(false);
    expect(alarms.has('some-other-feature')).toBe(true); // foreign alarm untouched
    expect(alarms.has('doe:task:on')).toBe(true);
    expect(alarms.has('doe:task:off')).toBe(false); // disabled → cleared, not recreated
  });
});

describe('registerScheduler — message + boot wiring', () => {
  it('reschedules on boot (rescheduleAll runs) and registers an onMessage + onAlarm listener', async () => {
    await seedTasks(task({ id: 'boot', enabled: true, nextRunAt: Date.now() + 60_000 }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    // boot rescheduleAll is fire-and-forget (void); let it settle.
    await new Promise(r => setTimeout(r, 0));
    expect(alarms.has('doe:task:boot')).toBe(true);
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
  });

  it('handles the reschedule message by calling rescheduleAll and acking ok:true', async () => {
    await seedTasks(task({ id: 'msg', enabled: true, nextRunAt: Date.now() + 60_000 }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));
    alarms.clear();

    const listener = chromeState().messageListeners.at(-1)!;
    const sendResponse = vi.fn();
    const kept = listener({ type: 'doe/scheduler/reschedule' }, {}, sendResponse);
    expect(kept).toBe(false); // synchronous ack, channel not held
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    await new Promise(r => setTimeout(r, 0));
    expect(alarms.has('doe:task:msg')).toBe(true);
  });

  it('ignores unrelated messages (returns false, no ack)', async () => {
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    const listener = chromeState().messageListeners.at(-1)!;
    const sendResponse = vi.fn();
    expect(listener({ type: 'something/else' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('alarm dispatch — task execution', () => {
  async function fireAlarm(name: string) {
    const listener = getAlarmListener();
    await listener({ name });
  }

  it('a fired task alarm opens a window on the task URL, adopts the tab, queues + opens panel, records success', async () => {
    const { scheduledTasksStorage } = await seedTasks(
      task({ id: 't1', url: 'https://news.example/', prompt: 'summarise', enabled: true }),
    );
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));

    await fireAlarm('doe:task:t1');

    expect(chrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ focused: false, url: 'https://news.example/', type: 'normal' }),
    );
    expect(groupManager.adoptTab).toHaveBeenCalledWith(7777);
    expect(onboarding.queueOnboardingPrompt).toHaveBeenCalledWith('summarise');
    expect(onboarding.openSidePanelForActiveWindow).toHaveBeenCalled();
    const t = (await scheduledTasksStorage.get()).tasks.find(x => x.id === 't1')!;
    expect(t.lastSuccess).toBe(true);
  });

  it('falls back to about:blank when the task has no URL', async () => {
    await seedTasks(task({ id: 't1', url: undefined, enabled: true }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));
    await fireAlarm('doe:task:t1');
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'about:blank' }));
  });

  it('a once task is disabled after firing; a recurring task stays enabled', async () => {
    const { scheduledTasksStorage } = await seedTasks(
      task({ id: 'once', repeat: 'once', enabled: true }),
      task({ id: 'rec', repeat: 'daily', enabled: true }),
    );
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));

    await fireAlarm('doe:task:once');
    await fireAlarm('doe:task:rec');

    const tasks = (await scheduledTasksStorage.get()).tasks;
    expect(tasks.find(t => t.id === 'once')!.enabled).toBe(false);
    expect(tasks.find(t => t.id === 'rec')!.enabled).toBe(true);
  });

  it('does nothing for an unknown task id or a disabled task', async () => {
    await seedTasks(task({ id: 'off', enabled: false }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));

    await fireAlarm('doe:task:missing');
    await fireAlarm('doe:task:off');
    expect(onboarding.queueOnboardingPrompt).not.toHaveBeenCalled();
  });

  it('ignores alarms outside the task/retry namespaces', async () => {
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));
    await fireAlarm('chrome-internal-thing');
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });
});

describe('alarm dispatch — failure retries', () => {
  async function fireAlarm(name: string) {
    await getAlarmListener()({ name });
  }

  it('records failure and schedules the first retry with 1m backoff when execution throws', async () => {
    const now = Date.now();
    onboarding.queueOnboardingPrompt.mockRejectedValueOnce(new Error('queue failed'));
    const { scheduledTasksStorage } = await seedTasks(task({ id: 't1', enabled: true }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));

    await fireAlarm('doe:task:t1');

    const t = (await scheduledTasksStorage.get()).tasks.find(x => x.id === 't1')!;
    expect(t.lastSuccess).toBe(false);
    expect(t.lastError).toBe('queue failed');
    const retry = alarms.get('doe:task-retry:t1:1')!;
    expect(retry).toBeDefined();
    expect(retry.scheduledTime).toBeGreaterThanOrEqual(now + 60_000);
    expect(chrome.notifications.create).not.toHaveBeenCalled(); // no notify until retries exhausted
  });

  it('a retry alarm re-runs the task at the recorded attempt and escalates backoff (1→5→15m)', async () => {
    onboarding.queueOnboardingPrompt
      .mockRejectedValueOnce(new Error('fail-2')) // attempt 1 (retry :2 path)
      .mockResolvedValue(undefined);
    await seedTasks(task({ id: 't1', enabled: true }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));

    const now = Date.now();
    // Fire the retry alarm for attempt index 1 → on failure schedules attempt 2 with 5m backoff.
    await fireAlarm('doe:task-retry:t1:1');
    const retry2 = alarms.get('doe:task-retry:t1:2')!;
    expect(retry2).toBeDefined();
    expect(retry2.scheduledTime).toBeGreaterThanOrEqual(now + 5 * 60_000);
  });

  it('notifies on final failure after MAX_RETRIES are exhausted (no further retry alarm)', async () => {
    onboarding.queueOnboardingPrompt.mockRejectedValue(new Error('persistent'));
    await seedTasks(task({ id: 't1', name: 'Reportr', enabled: true }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));

    // attempt index 3 === MAX_RETRIES → not (< MAX_RETRIES) → final notify branch.
    await fireAlarm('doe:task-retry:t1:3');

    expect(alarms.has('doe:task-retry:t1:4')).toBe(false);
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.stringContaining('de-task-t1-'),
      expect.objectContaining({ title: 'doeverything task failed', message: 'persistent' }),
    );
  });

  it('a retry alarm for a now-disabled task is skipped', async () => {
    await seedTasks(task({ id: 't1', enabled: false }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));
    await fireAlarm('doe:task-retry:t1:1');
    expect(onboarding.queueOnboardingPrompt).not.toHaveBeenCalled();
  });

  it('on success it notifies with the task name', async () => {
    await seedTasks(task({ id: 't1', name: 'Morning brief', enabled: true }));
    const { registerScheduler }: SchedulerModule = await import('./scheduler.js');
    registerScheduler();
    await new Promise(r => setTimeout(r, 0));
    await getAlarmListener()({ name: 'doe:task:t1' });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: 'doeverything · Morning brief' }),
    );
  });
});
