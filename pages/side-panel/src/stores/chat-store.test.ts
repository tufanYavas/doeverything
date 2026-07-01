import { useChatStore } from './chat-store';
import { beforeEach, describe, expect, it } from 'vitest';

const get = () => useChatStore.getState();

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    status: 'idle',
    error: null,
    streamingMessageId: null,
    abortKey: null,
    lastCompaction: null,
    contextUsage: null,
  });
});

describe('message lifecycle', () => {
  it('appends a user message with a text part', () => {
    get().appendUserMessage('hello');
    const [msg] = get().messages;
    expect(msg.role).toBe('user');
    expect(msg.parts).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  it('never emits a parts-empty user message', () => {
    get().appendUserMessage('');
    expect(get().messages[0].parts).toEqual([{ kind: 'text', text: '' }]);
  });

  it('attaches image attachments alongside text', () => {
    get().appendUserMessage('look', [{ mediaType: 'image/png', dataUrl: 'data:...', name: 'a.png' }]);
    const parts = get().messages[0].parts;
    expect(parts).toContainEqual({ kind: 'image', mediaType: 'image/png', dataUrl: 'data:...', name: 'a.png' });
  });

  it('startAssistantStream marks streaming and tracks the streaming id', () => {
    const m = get().startAssistantStream();
    expect(get().status).toBe('streaming');
    expect(get().streamingMessageId).toBe(m.id);
  });

  it('appendAssistantDelta concatenates into the streaming message', () => {
    get().startAssistantStream();
    get().appendAssistantDelta('foo');
    get().appendAssistantDelta('bar');
    const streaming = get().messages.at(-1);
    expect(streaming?.parts).toEqual([{ kind: 'text', text: 'foobar' }]);
  });

  it('preserves the object identity of untouched messages on delta (MessageRow memo invariant)', () => {
    get().appendUserMessage('hi');
    get().startAssistantStream();
    const before = get().messages;
    const userBefore = before[0];
    get().appendAssistantDelta('x');
    const after = get().messages;
    expect(after[0]).toBe(userBefore); // unchanged user message reused by reference
    expect(after[1]).not.toBe(before[1]); // streaming message replaced
  });

  it('records a running tool call then flips it to done with the result', () => {
    get().startAssistantStream();
    get().recordToolStart({ id: 'c1', name: 'read_page', args: { tabId: 1 } });
    expect(get().status).toBe('awaiting-tool');
    let call = get().messages.at(-1)?.parts.find(p => p.kind === 'tool_call');
    expect(call).toMatchObject({ status: 'running', toolName: 'read_page' });

    get().recordToolEnd({ id: 'c1', name: 'read_page', result: { ok: true }, isError: false });
    call = get().messages.at(-1)?.parts.find(p => p.kind === 'tool_call');
    expect(call).toMatchObject({ status: 'done', result: { ok: true } });
    expect(get().status).toBe('streaming');
  });

  it('marks a failed tool call as error', () => {
    get().startAssistantStream();
    get().recordToolStart({ id: 'c2', name: 'navigate', args: {} });
    get().recordToolEnd({ id: 'c2', name: 'navigate', result: 'boom', isError: true });
    const call = get().messages.at(-1)?.parts.find(p => p.kind === 'tool_call');
    expect(call).toMatchObject({ status: 'error', result: 'boom' });
  });

  it('finishAssistantStream returns to idle (or error if one is set)', () => {
    get().startAssistantStream();
    get().finishAssistantStream();
    expect(get().status).toBe('idle');
    expect(get().streamingMessageId).toBeNull();

    get().startAssistantStream();
    get().setError('nope');
    get().finishAssistantStream();
    expect(get().status).toBe('error');
  });
});

describe('compaction + context usage state', () => {
  it('records a compaction notice (undismissed), and a new one re-shows after dismiss', () => {
    get().recordCompaction({ stage: 'warn', estimatedTokens: 150_000, contextWindow: 200_000 });
    expect(get().lastCompaction).toMatchObject({ stage: 'warn', dismissed: false, contextWindow: 200_000 });

    get().dismissCompaction();
    expect(get().lastCompaction?.dismissed).toBe(true);

    get().recordCompaction({ stage: 'critical', estimatedTokens: 190_000, contextWindow: 200_000 });
    expect(get().lastCompaction?.dismissed).toBe(false);
    expect(get().lastCompaction?.stage).toBe('critical');
  });

  it('stores a null contextWindow when the SW omitted it', () => {
    get().recordCompaction({ stage: 'warn', estimatedTokens: 1 });
    expect(get().lastCompaction?.contextWindow).toBeNull();
  });

  it('setContextUsage records the fill snapshot', () => {
    get().setContextUsage({ estimatedTokens: 120_000, contextWindow: 200_000 });
    expect(get().contextUsage).toEqual({ estimatedTokens: 120_000, contextWindow: 200_000 });
  });
});

describe('clear', () => {
  it('resets messages, compaction, usage and mints a new conversation id', () => {
    const prevId = get().conversationId;
    get().appendUserMessage('hi');
    get().recordCompaction({ stage: 'warn', estimatedTokens: 1, contextWindow: 1 });
    get().setContextUsage({ estimatedTokens: 1, contextWindow: 1 });

    get().clear();

    expect(get().messages).toEqual([]);
    expect(get().lastCompaction).toBeNull();
    expect(get().contextUsage).toBeNull();
    expect(get().conversationId).not.toBe(prevId);
    // Notifies the SW to drop per-conversation caches.
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'doe/conversation/cleared', conversationId: prevId }),
    );
  });
});
