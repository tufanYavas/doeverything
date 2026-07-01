/**
 * Runs handler — exposes the TaskLogger IndexedDB store to the Options page.
 *
 * The Options page renders a "Runs" tab listing recent agent runs (provider,
 * model, tokens, latency, outcome). It can't read the SW's IndexedDB
 * connection directly, so this handler answers a small message envelope.
 */

import { TaskLogger } from '../lib/task-logger.js';
import { register } from '../messaging/router.js';

export function registerRunsHandlers() {
  register('doe/runs/list', async msg => {
    const limit = typeof msg.limit === 'number' ? Math.max(1, Math.min(500, msg.limit)) : 100;
    return { runs: await TaskLogger.list(limit) };
  });

  // Returns every full per-turn transcript (system, messages, tools, tool
  // calls with args + results, response text, usage) for a single chat. The
  // Options "Rapor" button uses this to render a HAR-style HTML report.
  register('doe/runs/transcript', async msg => {
    if (!msg.conversationId) throw new Error('conversationId is required');
    return { transcripts: await TaskLogger.transcriptsForConversation(msg.conversationId) };
  });
}
