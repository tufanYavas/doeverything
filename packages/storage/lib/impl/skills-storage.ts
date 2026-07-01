import { createStorage, StorageEnum } from '../base/index.js';
import type { BaseStorageType } from '../base/types.js';

/**
 * doeverything skills — persisted at `chrome.storage.local["skills"]`.
 *
 * Each user-authored skill is a markdown body plus YAML-style frontmatter
 * that the agent's `skill` tool can invoke and that the side-panel slash
 * menu can launch. `liveUpdate: true` keeps every page that subscribes
 * (`useStorage(skillsStorage)`) in sync with edits made elsewhere.
 *
 * Pages do CRUD via the methods below; the background's `skill` tool and
 * agent runner read through the same reactive surface.
 */

export type SkillSource = 'user' | 'imported';

export interface Skill {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;
  argumentNames?: string[];
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  version?: string;
  body: string;
  source: SkillSource;
  domains?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillUsageEntry {
  usageCount: number;
  lastUsedAt: number;
}

const SKILL_NAME_REGEX = /^[a-zA-Z0-9:_-]+$/;
export const isValidSkillName = (n: string): boolean => typeof n === 'string' && SKILL_NAME_REGEX.test(n);

const newSkillId = (): string => `skill_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const skillsState = createStorage<Skill[]>('skills', [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

const usageState = createStorage<Record<string, SkillUsageEntry>>(
  'skillUsage',
  {},
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

export interface SkillsStorageType extends BaseStorageType<Skill[]> {
  /** Returns all skills, deduped by name (first-wins). */
  getAll: () => Promise<Skill[]>;
  getByName: (name: string) => Promise<Skill | undefined>;
  create: (
    input: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
      createdAt?: number;
      updatedAt?: number;
    },
  ) => Promise<Skill>;
  update: (id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt'>>) => Promise<Skill | undefined>;
  remove: (id: string) => Promise<boolean>;
  /** 60-second debounced usage write — bumps the counter once per minute per skill. */
  recordUsage: (name: string) => Promise<void>;
  /** 7-day half-life recency × usage count, with 0.1 floor; drives slash-menu ranking. */
  getUsageScore: (name: string) => Promise<number>;
  exportAll: (ids?: string[]) => Promise<string>;
  importAll: (json: string, opts?: { replace?: boolean }) => Promise<number>;
  /** Reactive view of `chrome.storage.local["skillUsage"]`. */
  usage: BaseStorageType<Record<string, SkillUsageEntry>>;
}

const USAGE_DEBOUNCE_MS = 60_000;
const lastWriteByName = new Map<string, number>();

export const skillsStorage: SkillsStorageType = {
  ...skillsState,
  usage: usageState,

  async getAll() {
    const raw = (await skillsState.get()) ?? [];
    const seen = new Set<string>();
    const out: Skill[] = [];
    for (const s of raw) {
      if (!s || typeof s !== 'object' || !s.name) continue;
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      out.push(s);
    }
    return out;
  },

  async getByName(name) {
    const all = await this.getAll();
    return all.find(s => s.name === name);
  },

  async create(input) {
    if (!isValidSkillName(input.name)) {
      throw new Error(`Invalid skill name "${input.name}". Use only [a-zA-Z0-9:_-]+`);
    }
    const all = await this.getAll();
    if (all.some(s => s.name === input.name)) {
      throw new Error(`A skill named "${input.name}" already exists`);
    }
    const now = Date.now();
    const skill: Skill = {
      ...input,
      id: input.id ?? newSkillId(),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      userInvocable: input.userInvocable ?? true,
      disableModelInvocation: input.disableModelInvocation ?? false,
      source: input.source ?? 'user',
    } as Skill;
    await skillsState.set([...all, skill]);
    return skill;
  },

  async update(id, updates) {
    const all = await this.getAll();
    const i = all.findIndex(s => s.id === id);
    if (i === -1) return undefined;
    const current = all[i];
    const next: Skill = {
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    if (next.name !== current.name) {
      if (!isValidSkillName(next.name)) {
        throw new Error(`Invalid skill name "${next.name}". Use only [a-zA-Z0-9:_-]+`);
      }
      if (all.some((s, j) => j !== i && s.name === next.name)) {
        throw new Error(`A skill named "${next.name}" already exists`);
      }
    }
    const updated = [...all];
    updated[i] = next;
    await skillsState.set(updated);
    return next;
  },

  async remove(id) {
    const all = await this.getAll();
    const filtered = all.filter(s => s.id !== id);
    if (filtered.length === all.length) return false;
    await skillsState.set(filtered);
    const u = (await usageState.get()) ?? {};
    const target = all.find(s => s.id === id);
    if (target && u[target.name]) {
      const { [target.name]: _, ...rest } = u;
      await usageState.set(rest);
    }
    return true;
  },

  async recordUsage(name) {
    const now = Date.now();
    const last = lastWriteByName.get(name);
    if (last !== undefined && now - last < USAGE_DEBOUNCE_MS) return;
    lastWriteByName.set(name, now);
    const u = (await usageState.get()) ?? {};
    const existing = u[name];
    await usageState.set({
      ...u,
      [name]: {
        usageCount: (existing?.usageCount ?? 0) + 1,
        lastUsedAt: now,
      },
    });
  },

  async getUsageScore(name) {
    const u = (await usageState.get()) ?? {};
    const entry = u[name];
    if (!entry) return 0;
    const days = (Date.now() - entry.lastUsedAt) / (1000 * 60 * 60 * 24);
    const recency = Math.pow(0.5, days / 7);
    return entry.usageCount * Math.max(recency, 0.1);
  },

  async exportAll(ids) {
    const all = await this.getAll();
    const toExport = ids ? all.filter(s => ids.includes(s.id)) : all;
    return JSON.stringify(toExport, null, 2);
  },

  async importAll(json, opts = {}) {
    const parsed = JSON.parse(json) as Skill[];
    if (!Array.isArray(parsed)) {
      throw new Error('Import payload must be a JSON array of skills');
    }
    const existing = opts.replace ? [] : await this.getAll();
    const usedNames = new Set(existing.map(s => s.name));
    const now = Date.now();
    const toAdd: Skill[] = [];
    for (const s of parsed) {
      if (!s || typeof s !== 'object' || !s.name) continue;
      if (!isValidSkillName(s.name)) continue;
      if (usedNames.has(s.name)) continue;
      usedNames.add(s.name);
      toAdd.push({
        ...s,
        id: newSkillId(),
        source: 'imported',
        createdAt: now,
        updatedAt: now,
        userInvocable: s.userInvocable ?? true,
        disableModelInvocation: s.disableModelInvocation ?? false,
      });
    }
    await skillsState.set([...existing, ...toAdd]);
    return toAdd.length;
  },
};
