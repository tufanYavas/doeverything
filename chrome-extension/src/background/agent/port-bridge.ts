/**
 * Port-based streaming bridge for the side panel agent runner.
 *
 * One Port per side-panel instance. Each `start` message kicks off a run and
 * streams `delta`, `tool-start`, `tool-end`, `done`, or `error` events back;
 * `abort` cancels the current run.
 *
 * `chrome.runtime.connect({ name: 'doe:agent' })` is the entry point
 * (defined in pages/side-panel/src/lib/agent-client.ts).
 */

import { AgentRegistry } from './registry.js';
import { startAgentRun } from './runner.js';
import type { ChatMessageDTO } from './conversion.js';
import type { AgentRunHandle } from './runner.js';

const PORT_NAME = 'doe:agent';

interface AgentInbound {
  type: 'doe/agent/start' | 'doe/agent/abort';
  conversationId: string;
  messages?: ChatMessageDTO[];
}

export function registerAgentPortBridge() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== PORT_NAME) return;

    let active: AgentRunHandle | null = null;
    let activeId: string | null = null;

    const cleanup = () => {
      active?.abort();
      AgentRegistry.setActive(null);
      active = null;
      activeId = null;
    };

    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as AgentInbound;

      if (msg?.type === 'doe/agent/abort') {
        if (msg.conversationId === activeId) cleanup();
        return;
      }

      if (msg?.type === 'doe/agent/start') {
        cleanup(); // a new request supersedes any in-flight one
        // Raw chat-store DTOs go straight to the runner — the SDK-driven
        // conversion (`toModelMessages`) happens *inside* the run, after
        // the tool roster is built, so each tool's `toModelOutput` hook
        // can shape persisted results (e.g. lift `__doe_image`
        // markers into vision-capable `image-data` parts).
        const rawMessages = msg.messages ?? [];
        const id = msg.conversationId;
        activeId = id;

        const safePost = (payload: unknown) => {
          try {
            port.postMessage(payload);
          } catch {
            // Side panel disconnected mid-stream — abort silently.
            active?.abort();
          }
        };

        active = startAgentRun(id, rawMessages, {
          onDelta: text => safePost({ type: 'doe/agent/delta', conversationId: id, text }),
          onToolStart: call => safePost({ type: 'doe/agent/tool-start', conversationId: id, call }),
          onToolEnd: call => safePost({ type: 'doe/agent/tool-end', conversationId: id, call }),
          onCompaction: info => safePost({ type: 'doe/agent/compaction', conversationId: id, info }),
          onDone: context => {
            safePost({ type: 'doe/agent/done', conversationId: id, context });
            AgentRegistry.setActive(null);
            active = null;
            activeId = null;
          },
          onError: message => {
            safePost({ type: 'doe/agent/error', conversationId: id, message });
            AgentRegistry.setActive(null);
            active = null;
            activeId = null;
          },
        });
        AgentRegistry.setActive(active);
      }
    });

    port.onDisconnect.addListener(cleanup);
  });
}
