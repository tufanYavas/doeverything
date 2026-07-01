import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CacheModule from './compaction-cache.js';

/**
 * compaction-cache is backed by the session-state module cache (module
 * scope), so each test re-imports fresh. The chrome fake (storage.session)
 * is reset by the shared setup.
 */
let mod: typeof CacheModule;

function record(over: Partial<CacheModule.CompactionCacheRecord> = {}): CacheModule.CompactionCacheRecord {
  return {
    conversationId: 'conv-1',
    summary: '- did things',
    cursorMessageId: 'm5',
    coveredCount: 5,
    summaryTokens: 10,
    generation: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./compaction-cache.js');
});

describe('compaction-cache CRUD', () => {
  it('returns null for an unknown conversation', async () => {
    expect(await mod.getCompactionRecord('nope')).toBeNull();
  });

  it('round-trips a record by conversation id', async () => {
    await mod.setCompactionRecord(record());
    const got = await mod.getCompactionRecord('conv-1');
    expect(got).toMatchObject({ conversationId: 'conv-1', summary: '- did things', generation: 1 });
  });

  it('overwrites the same conversation in place', async () => {
    await mod.setCompactionRecord(record({ generation: 1 }));
    await mod.setCompactionRecord(record({ generation: 2, summary: '- more' }));
    const got = await mod.getCompactionRecord('conv-1');
    expect(got?.generation).toBe(2);
    expect(got?.summary).toBe('- more');
  });

  it('clears a conversation record', async () => {
    await mod.setCompactionRecord(record());
    await mod.clearCompactionRecord('conv-1');
    expect(await mod.getCompactionRecord('conv-1')).toBeNull();
  });

  it('garbage-collects to the most-recent 8 conversations', async () => {
    for (let i = 0; i < 12; i++) {
      await mod.setCompactionRecord(record({ conversationId: `c${i}`, updatedAt: i + 1 }));
    }
    // Oldest (c0..c3) evicted; newest (c4..c11) kept.
    expect(await mod.getCompactionRecord('c0')).toBeNull();
    expect(await mod.getCompactionRecord('c3')).toBeNull();
    expect(await mod.getCompactionRecord('c4')).not.toBeNull();
    expect(await mod.getCompactionRecord('c11')).not.toBeNull();
  });

  it('persists to chrome.storage.session so it survives SW eviction', async () => {
    await mod.setCompactionRecord(record());
    // New module instance (eviction) reads the same storage.session.
    vi.resetModules();
    const fresh = await import('./compaction-cache.js');
    expect(await fresh.getCompactionRecord('conv-1')).not.toBeNull();
  });
});
