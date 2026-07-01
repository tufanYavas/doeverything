import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * SavedPromptManager.
 *
 * "Actions" the user keeps in their library. Different from skills:
 * actions are atomic prompts (no template, no frontmatter); they show up
 * as quick-launchers on the new-tab Shortcuts widget and as
 * `[[shortcut:id:name]]` chips inside the assistant's replies.
 *
 * An action MAY also expose a slash command name (`/research`,
 * `/summarize`) — the side-panel composer expands `/<command>` to the
 * stored `prompt` before sending. When the user wires the action to a
 * schedule, the same id is mirrored into `scheduledTasksStorage` so the
 * SW alarm dispatcher can fire it without a second source of truth.
 */

export interface SavedPrompt {
  id: string;
  name: string;
  prompt: string;
  /** Optional emoji or single character to render alongside the name. */
  glyph?: string;
  /**
   * Optional slash-command shorthand (no leading slash). When set, typing
   * `/<command>` in the composer and submitting expands to `prompt`. Must
   * be unique across saved prompts.
   */
  command?: string;
  /**
   * Optional starting URL. When the action runs (slash expansion or
   * scheduled fire), doeverything opens / navigates to this URL before
   * executing `prompt`. Leave empty to run wherever the user already is.
   */
  url?: string;
  /** Stored on creation; useful for sorting in the new-tab widget. */
  createdAt: number;
  /** Last invocation; advanced ordering. */
  lastUsedAt?: number;
  /** Times invoked — used for popularity sort. */
  invocations: number;
}

interface SavedPromptsState {
  prompts: SavedPrompt[];
}

const DEFAULT: SavedPromptsState = { prompts: [] };

const storage = createStorage<SavedPromptsState>('doe:saved-prompts', DEFAULT, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export interface SavedPromptsStorageType extends BaseStorageType<SavedPromptsState> {
  upsert: (prompt: SavedPrompt) => Promise<void>;
  remove: (id: string) => Promise<void>;
  recordUsage: (id: string) => Promise<void>;
  /** First saved prompt whose `command` matches the given name (case-insensitive). */
  findByCommand: (command: string) => Promise<SavedPrompt | undefined>;
}

export const savedPromptsStorage: SavedPromptsStorageType = {
  ...storage,
  upsert: prompt =>
    storage.set(prev => ({
      prompts: [...prev.prompts.filter(p => p.id !== prompt.id), prompt],
    })),
  remove: id => storage.set(prev => ({ prompts: prev.prompts.filter(p => p.id !== id) })),
  recordUsage: id =>
    storage.set(prev => ({
      prompts: prev.prompts.map(p =>
        p.id === id ? { ...p, lastUsedAt: Date.now(), invocations: (p.invocations ?? 0) + 1 } : p,
      ),
    })),
  findByCommand: async command => {
    const target = command.trim().toLowerCase();
    if (!target) return undefined;
    const state = await storage.get();
    return state.prompts.find(p => p.command && p.command.toLowerCase() === target);
  },
};
