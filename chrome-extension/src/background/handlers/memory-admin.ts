/**
 * Memory admin handler — exposes the persistent agent-memory IDB store to
 * the Options page (Memory tab). The Options renderer can't share the SW's
 * IDB connection cleanly, so it sends a small message envelope and receives
 * the bucket rosters / contents / mutations through this handler.
 *
 * Mutations re-broadcast on the `BroadcastChannel` inside
 * `agent-recall-storage.ts`, so a Memory tab open in another window still
 * refreshes when the user edits a bucket here. That is owned by the storage
 * layer; this handler is dumb pass-through.
 */

import { register } from '../messaging/router.js';
import {
  deleteDomain,
  deleteItemAt,
  exportAllPersistentMemory,
  exportDomainPersistentMemory,
  importPersistentMemory,
  listBucketsForDomain,
  listDomainsWithBuckets,
  recallClear,
  recallGet,
  recallSet,
  replaceItemAt,
  wipeAllPersistentMemory,
} from '@doeverything/storage';
import type { ImportStrategy, PersistentMemorySnapshot } from '@doeverything/storage';

export function registerMemoryAdminHandlers() {
  register('doe/memory/list-domains', async () => ({
    domains: await listDomainsWithBuckets(),
  }));

  register('doe/memory/list-buckets', async msg => ({
    buckets: await listBucketsForDomain(msg.domain),
  }));

  register('doe/memory/read-bucket', async msg => {
    const items = await recallGet(msg.domain, msg.bucket);
    const total = items.length;
    const offset = Math.max(0, msg.offset ?? 0);
    const limit = Math.max(1, Math.min(500, msg.limit ?? 50));
    return {
      domain: msg.domain,
      bucket: msg.bucket,
      total,
      offset,
      items: items.slice(offset, offset + limit),
    };
  });

  register('doe/memory/delete-bucket', async msg => ({
    cleared: await recallClear(msg.domain, msg.bucket),
  }));

  register('doe/memory/delete-item', async msg => deleteItemAt(msg.domain, msg.bucket, msg.index));

  register('doe/memory/replace-item', async msg => replaceItemAt(msg.domain, msg.bucket, msg.index, msg.item));

  register('doe/memory/replace-bucket', async msg => {
    const result = await recallSet(msg.domain, msg.bucket, msg.items);
    return { ok: true, count: result.count };
  });

  register('doe/memory/delete-domain', async msg => ({
    deletedBuckets: await deleteDomain(msg.domain),
  }));

  register('doe/memory/export-all', async () => ({
    snapshot: await exportAllPersistentMemory(),
  }));

  register('doe/memory/export-domain', async msg => ({
    snapshot: await exportDomainPersistentMemory(msg.domain),
  }));

  register('doe/memory/import', async msg => {
    const snapshot = msg.snapshot as PersistentMemorySnapshot;
    const strategy = (msg.strategy ?? 'overwrite') as ImportStrategy;
    return importPersistentMemory(snapshot, strategy);
  });

  register('doe/memory/wipe-all', async () => {
    await wipeAllPersistentMemory();
    return { ok: true };
  });
}
