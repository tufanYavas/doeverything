import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * Workflow recording state. A recording is a sequence of user actions
 * (click / navigate / type / screenshot) the side panel can later turn into
 * a generated agent prompt.
 */

export type RecordedActionKind = 'click' | 'navigate' | 'type' | 'key' | 'scroll' | 'screenshot';

export interface RecordedAction {
  id: string;
  kind: RecordedActionKind;
  timestamp: number;
  /** Tab the action happened on. */
  tabId: number;
  url?: string;
  /** Click position (CSS px) or text typed; depends on kind. */
  data?: Record<string, unknown>;
  /** Optional screenshot data URL. */
  screenshotDataUrl?: string;
}

export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  actions: RecordedAction[];
  /** Free-form narration the user can record alongside actions. */
  narration?: string;
}

interface RecordingsState {
  /** Stored recordings, newest first. */
  recordings: Recording[];
  /** id of the recording currently being captured (null when idle). */
  active: string | null;
}

const DEFAULT: RecordingsState = { recordings: [], active: null };

const storage = createStorage<RecordingsState>('doe:recordings', DEFAULT, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export interface RecordingsStorageType extends BaseStorageType<RecordingsState> {
  start: (name: string) => Promise<Recording>;
  appendAction: (action: RecordedAction) => Promise<void>;
  stop: () => Promise<Recording | null>;
  remove: (id: string) => Promise<void>;
  setNarration: (id: string, narration: string) => Promise<void>;
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export const recordingsStorage: RecordingsStorageType = {
  ...storage,
  start: async name => {
    const recording: Recording = {
      id: newId(),
      name: name || `Recording ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      actions: [],
    };
    await storage.set(prev => ({
      recordings: [recording, ...prev.recordings],
      active: recording.id,
    }));
    return recording;
  },
  appendAction: action =>
    storage.set(prev => {
      if (!prev.active) return prev;
      return {
        ...prev,
        recordings: prev.recordings.map(r => (r.id === prev.active ? { ...r, actions: [...r.actions, action] } : r)),
      };
    }),
  stop: async () => {
    const state = await storage.get();
    if (!state.active) return null;
    const stopped = state.recordings.find(r => r.id === state.active) ?? null;
    await storage.set(prev => ({ ...prev, active: null }));
    return stopped;
  },
  remove: id =>
    storage.set(prev => ({
      ...prev,
      recordings: prev.recordings.filter(r => r.id !== id),
      active: prev.active === id ? null : prev.active,
    })),
  setNarration: (id, narration) =>
    storage.set(prev => ({
      ...prev,
      recordings: prev.recordings.map(r => (r.id === id ? { ...r, narration } : r)),
    })),
};
