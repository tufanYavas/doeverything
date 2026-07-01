import { v4 as uuid } from 'uuid';
import { create } from 'zustand';

/**
 * Chat store for the doeverything side panel.
 *
 * The store keeps a flat list of messages and a pointer to the currently
 * streaming assistant message (so streamed deltas append in O(1)). The agent
 * loop in the service worker drives this store via `chrome.runtime` messages
 * and a long-lived `Port` for streaming chunks.
 *
 * Tool calls share the assistant message: each call inserts a `tool_call`
 * part with status `running`, and the matching `tool-end` event flips it to
 * `done`/`error` and stores the result.
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export type ToolCallStatus = 'running' | 'done' | 'error';

export type MessagePart =
  | { kind: 'text'; text: string }
  | {
      kind: 'image';
      /** IANA media type (e.g. `image/jpeg`). */
      mediaType: string;
      /** `data:image/...;base64,...` URL — round-trips via chrome.runtime. */
      dataUrl: string;
      /** Optional original filename (kept for accessibility / future re-display). */
      name?: string;
    }
  | {
      kind: 'tool_call';
      callId: string;
      toolName: string;
      args: unknown;
      status: ToolCallStatus;
      result?: unknown;
    };

/**
 * What the composer hands `appendUserMessage` for image attachments.
 * Mirror of the relevant `MessagePart` ('image') fields, kept as a
 * separate input type so callers don't have to think about the
 * discriminator union.
 */
export interface UserImageAttachment {
  mediaType: string;
  dataUrl: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
}

export type AgentStatus = 'idle' | 'submitting' | 'streaming' | 'awaiting-tool' | 'error';

/** Last compaction event from the SW (retrospective — summary already applied). */
export interface CompactionNotice {
  stage: 'warn' | 'critical';
  estimatedTokens: number;
  contextWindow: number | null;
  at: number;
  dismissed: boolean;
}

/** Final context size of the last completed run, for the fill indicator. */
export interface ContextUsage {
  estimatedTokens: number;
  contextWindow: number;
}

export interface ChatState {
  /**
   * Stable identity for the *current* conversation. Persists across many
   * user turns so the agent loop, TaskLogger, and Runs UI all see the same
   * id for "selam" and "naber" sent back-to-back. Resets only when the
   * user explicitly starts a new conversation (via `clear()`).
   */
  conversationId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  error: string | null;
  streamingMessageId: string | null;
  abortKey: string | null;
  lastCompaction: CompactionNotice | null;
  contextUsage: ContextUsage | null;

  appendUserMessage: (text: string, attachments?: UserImageAttachment[]) => ChatMessage;
  startAssistantStream: () => ChatMessage;
  appendAssistantDelta: (text: string) => void;
  recordToolStart: (call: { id: string; name: string; args: unknown }) => void;
  recordToolEnd: (call: { id: string; name: string; result: unknown; isError: boolean }) => void;
  finishAssistantStream: () => void;
  setStatus: (status: AgentStatus) => void;
  setError: (message: string | null) => void;
  setAbortKey: (key: string | null) => void;
  recordCompaction: (info: { stage: 'warn' | 'critical'; estimatedTokens: number; contextWindow?: number }) => void;
  dismissCompaction: () => void;
  setContextUsage: (usage: ContextUsage | null) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: uuid(),
  messages: [],
  status: 'idle',
  error: null,
  streamingMessageId: null,
  abortKey: null,
  lastCompaction: null,
  contextUsage: null,

  appendUserMessage: (text, attachments) => {
    const parts: MessagePart[] = [];
    if (text.trim().length > 0) parts.push({ kind: 'text', text });
    for (const att of attachments ?? []) {
      parts.push({ kind: 'image', mediaType: att.mediaType, dataUrl: att.dataUrl, name: att.name });
    }
    // Defensive: never emit a parts-empty user message — the agent loop
    // would render it as an empty bubble and cache nothing useful.
    if (parts.length === 0) parts.push({ kind: 'text', text: '' });
    const message: ChatMessage = {
      id: uuid(),
      role: 'user',
      parts,
      createdAt: Date.now(),
    };
    set(s => ({ messages: [...s.messages, message] }));
    return message;
  },

  startAssistantStream: () => {
    const message: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      parts: [{ kind: 'text', text: '' }],
      createdAt: Date.now(),
    };
    set(s => ({
      messages: [...s.messages, message],
      streamingMessageId: message.id,
      status: 'streaming',
    }));
    return message;
  },

  appendAssistantDelta: text => {
    const id = get().streamingMessageId;
    if (!id) return;
    set(s => ({
      messages: s.messages.map(m => {
        if (m.id !== id) return m;
        const last = m.parts[m.parts.length - 1];
        if (last && last.kind === 'text') {
          const updatedParts = m.parts.slice(0, -1).concat({ kind: 'text', text: last.text + text });
          return { ...m, parts: updatedParts };
        }
        return { ...m, parts: [...m.parts, { kind: 'text', text }] };
      }),
    }));
  },

  recordToolStart: call => {
    const id = get().streamingMessageId;
    if (!id) return;
    set(s => ({
      status: 'awaiting-tool',
      messages: s.messages.map(m =>
        m.id === id
          ? {
              ...m,
              parts: [
                ...m.parts,
                {
                  kind: 'tool_call',
                  callId: call.id,
                  toolName: call.name,
                  args: call.args,
                  status: 'running',
                },
              ],
            }
          : m,
      ),
    }));
  },

  recordToolEnd: call => {
    const id = get().streamingMessageId;
    if (!id) return;
    set(s => ({
      status: 'streaming',
      messages: s.messages.map(m => {
        if (m.id !== id) return m;
        return {
          ...m,
          parts: m.parts.map(p =>
            p.kind === 'tool_call' && p.callId === call.id
              ? { ...p, status: call.isError ? 'error' : 'done', result: call.result }
              : p,
          ),
        };
      }),
    }));
  },

  finishAssistantStream: () =>
    set(s => ({
      streamingMessageId: null,
      status: s.error ? 'error' : 'idle',
      abortKey: null,
    })),

  setStatus: status => set({ status }),
  setError: message => set({ error: message, status: message ? 'error' : 'idle' }),
  setAbortKey: key => set({ abortKey: key }),

  recordCompaction: info =>
    set({
      lastCompaction: {
        stage: info.stage,
        estimatedTokens: info.estimatedTokens,
        contextWindow: typeof info.contextWindow === 'number' ? info.contextWindow : null,
        at: Date.now(),
        dismissed: false,
      },
    }),

  // Keeps the record (a NEW compaction re-shows the strip), only hides it.
  dismissCompaction: () =>
    set(s => (s.lastCompaction ? { lastCompaction: { ...s.lastCompaction, dismissed: true } } : {})),

  setContextUsage: usage => set({ contextUsage: usage }),

  clear: () => {
    const previousId = get().conversationId;
    set({
      // Fresh conversation id so subsequent runs land in a new Runs group.
      conversationId: uuid(),
      messages: [],
      status: 'idle',
      error: null,
      streamingMessageId: null,
      abortKey: null,
      lastCompaction: null,
      contextUsage: null,
    });
    if (previousId) {
      // Tell the SW to drop every per-conversation cache (working memory
      // buckets + skill invocation log + skill listing delta + skill
      // runtime overrides) tied to the conversation we just retired. The
      // handler is fire-and-forget; the side panel doesn't need the
      // result to keep going.
      void chrome.runtime
        .sendMessage({ type: 'doe/conversation/cleared', conversationId: previousId })
        .catch(() => undefined);
    }
  },
}));
