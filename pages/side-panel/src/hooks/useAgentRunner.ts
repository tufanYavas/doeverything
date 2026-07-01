import { AGENT_PORT_NAME, connectAgentPort } from '@src/lib/agent-client';
import { useChatStore } from '@src/stores/chat-store';
import { activeModel, llmConfigStorage } from '@doeverything/storage';
import { useCallback, useEffect, useRef } from 'react';
import type { AgentOutbound } from '@src/lib/agent-client';
import type { UserImageAttachment } from '@src/stores/chat-store';

/**
 * Establishes a Port to the service worker and translates streaming events
 * into chat-store mutations. The same Port is reused across submits — we
 * only reconnect when Chrome tears it down (e.g. SW eviction).
 */
export function useAgentRunner() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const pendingModelRef = useRef<{ provider: string; model: string } | null>(null);

  const ensurePort = useCallback((): chrome.runtime.Port => {
    if (portRef.current) return portRef.current;

    const port = connectAgentPort();
    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as AgentOutbound;
      const store = useChatStore.getState();

      switch (msg.type) {
        case 'doe/agent/delta':
          store.appendAssistantDelta(msg.text);
          break;
        case 'doe/agent/tool-start':
          store.recordToolStart(msg.call);
          break;
        case 'doe/agent/tool-end':
          store.recordToolEnd(msg.call);
          break;
        case 'doe/agent/compaction':
          store.recordCompaction(msg.info);
          break;
        case 'doe/agent/done':
          if (msg.context) store.setContextUsage(msg.context);
          store.finishAssistantStream();
          if (pendingModelRef.current) {
            const { provider, model } = pendingModelRef.current;
            pendingModelRef.current = null;
            void llmConfigStorage.recordRecentModel(provider, model);
          }
          break;
        case 'doe/agent/error':
          store.setError(msg.message);
          store.finishAssistantStream();
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      // If we were mid-stream when the SW died, surface a friendly error.
      const store = useChatStore.getState();
      if (store.status === 'streaming' || store.status === 'submitting') {
        store.setError('Connection to the doeverything service worker was lost.');
        store.finishAssistantStream();
      }
    });

    portRef.current = port;
    return port;
  }, []);

  useEffect(
    () => () => {
      portRef.current?.disconnect();
      portRef.current = null;
    },
    [],
  );

  const sendPrompt = useCallback(
    (text: string, attachments?: UserImageAttachment[]) => {
      const trimmed = text.trim();
      const hasAttachments = !!attachments && attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      const store = useChatStore.getState();
      if (store.status === 'streaming' || store.status === 'submitting') return;

      // Capture active provider+model before streaming starts so we can record
      // it on success even if the user switches models mid-conversation.
      void llmConfigStorage.get().then(cfg => {
        pendingModelRef.current = { provider: cfg.provider, model: activeModel(cfg) };
      });

      store.setError(null);
      store.appendUserMessage(trimmed, attachments);
      store.startAssistantStream();
      store.setStatus('submitting');

      // Reuse the conversation's stable id for every turn — only `clear()`
      // resets it. This is what lets the Runs tab group "selam" and "naber"
      // sent in the same chat into a single conversation block.
      const conversationId = store.conversationId;
      store.setAbortKey(conversationId);

      const port = ensurePort();
      port.postMessage({
        type: 'doe/agent/start',
        conversationId,
        messages: useChatStore.getState().messages,
      });
    },
    [ensurePort],
  );

  const abort = useCallback(() => {
    const store = useChatStore.getState();
    const conversationId = store.abortKey;
    if (!conversationId) return;
    portRef.current?.postMessage({ type: 'doe/agent/abort', conversationId });
    store.setStatus('idle');
    store.finishAssistantStream();
  }, []);

  return { sendPrompt, abort, portName: AGENT_PORT_NAME };
}
