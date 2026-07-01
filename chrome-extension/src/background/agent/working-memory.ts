/**
 * Conversation-scoped RAM scratchpad. SW JS heap, lost on browser restart
 * or sustained idle (SW eviction). Cleared on new conversation.
 *
 * Two access paths:
 *   - Tools (model writes/reads small state directly): memory_set / memory_get / memory_append / memory_count / memory_clear.
 *   - run_js params (script writes/reads large data without round-tripping through chat): appendToBucket / readBucket.
 */

const buckets = new Map<string /* conversationId */, Map<string /* bucket */, unknown[]>>();

function bucketFor(conversationId: string, name: string): unknown[] {
  let session = buckets.get(conversationId);
  if (!session) {
    session = new Map();
    buckets.set(conversationId, session);
  }
  let arr = session.get(name);
  if (!arr) {
    arr = [];
    session.set(name, arr);
  }
  return arr;
}

export function memorySet(conversationId: string, bucket: string, items: unknown[]): number {
  const session = buckets.get(conversationId) ?? new Map();
  buckets.set(conversationId, session);
  session.set(bucket, [...items]);
  return items.length;
}

export function memoryAppend(conversationId: string, bucket: string, items: unknown[]): number {
  const arr = bucketFor(conversationId, bucket);
  arr.push(...items);
  return arr.length;
}

export function memoryRead(conversationId: string, bucket: string): unknown[] {
  return [...(buckets.get(conversationId)?.get(bucket) ?? [])];
}

export function memoryCount(conversationId: string, bucket: string): number {
  return buckets.get(conversationId)?.get(bucket)?.length ?? 0;
}

export function memoryClear(conversationId: string, bucket: string): boolean {
  return buckets.get(conversationId)?.delete(bucket) ?? false;
}

export function memoryBuckets(conversationId: string): Array<{ name: string; count: number }> {
  const session = buckets.get(conversationId);
  if (!session) return [];
  return Array.from(session.entries()).map(([name, items]) => ({ name, count: items.length }));
}

export function clearWorkingMemory(conversationId: string): void {
  buckets.delete(conversationId);
}

export function resetAllWorkingMemory(): void {
  buckets.clear();
}
