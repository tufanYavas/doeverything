import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * Tasks scheduled to run on a recurring (or one-shot) schedule. Each task is
 * a stored prompt that the SW alarm dispatcher fires; the agent runs it in
 * a fresh window automatically.
 */

export type RepeatKind = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom_minutes';

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** Local ISO date-time when the task should next fire. */
  nextRunAt: number;
  repeat: RepeatKind;
  /** For `custom_minutes` only — the period in minutes. */
  customMinutes?: number;
  /**
   * Starting URL. When set, the scheduler opens the new window on this
   * URL instead of `about:blank` so the agent lands directly where the
   * task expects to operate. Empty/undefined keeps the current default.
   */
  url?: string;
  /** Last execution log: when, success, error message. */
  lastRunAt?: number;
  lastSuccess?: boolean;
  lastError?: string;
  enabled: boolean;
}

interface ScheduledTasksState {
  tasks: ScheduledTask[];
}

const DEFAULT: ScheduledTasksState = { tasks: [] };

const storage = createStorage<ScheduledTasksState>('doe:scheduled-tasks', DEFAULT, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export interface ScheduledTasksStorageType extends BaseStorageType<ScheduledTasksState> {
  upsert: (task: ScheduledTask) => Promise<void>;
  remove: (id: string) => Promise<void>;
  recordRun: (id: string, success: boolean, error?: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const scheduledTasksStorage: ScheduledTasksStorageType = {
  ...storage,
  upsert: task =>
    storage.set(prev => ({
      tasks: [...prev.tasks.filter(t => t.id !== task.id), task],
    })),
  remove: id => storage.set(prev => ({ tasks: prev.tasks.filter(t => t.id !== id) })),
  recordRun: (id, success, error) =>
    storage.set(prev => ({
      tasks: prev.tasks.map(t =>
        t.id === id ? { ...t, lastRunAt: Date.now(), lastSuccess: success, lastError: error } : t,
      ),
    })),
  setEnabled: (id, enabled) =>
    storage.set(prev => ({
      tasks: prev.tasks.map(t => (t.id === id ? { ...t, enabled } : t)),
    })),
};
