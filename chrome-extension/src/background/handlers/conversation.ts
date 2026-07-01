/**
 * Conversation lifecycle SW message bridge.
 *
 * Inbound:
 *   - de/conversation/cleared { conversationId }
 *       → User started a new conversation (or hit "Clear"). Drop every
 *         per-conversation cache so the next conversation starts clean:
 *         working-memory buckets, skill invocation log (for compaction
 *         rehydration), skill listing delta tracker, skill runtime
 *         overrides (allowed-tools + model override).
 */

import { clearCompactionRecord } from '../agent/compaction-cache.js';
import { clearWorkingMemory } from '../agent/working-memory.js';
import { clearInvocationsForSession } from '../skills/invocation-tracker.js';
import { clearListingForSession } from '../skills/listing-tracker.js';
import { clearOverridesForSession } from '../skills/runtime-overrides.js';

interface ClearedMessage {
  type: 'doe/conversation/cleared';
  conversationId: string;
}

export function registerConversationHandlers() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string; conversationId?: string } | null;
    if (msg?.type !== 'doe/conversation/cleared') return false;

    void (async () => {
      try {
        const id = (msg as ClearedMessage).conversationId;
        if (id) {
          clearWorkingMemory(id);
          await Promise.all([
            clearInvocationsForSession(id),
            clearListingForSession(id),
            clearOverridesForSession(id),
            clearCompactionRecord(id),
          ]);
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  });
}
