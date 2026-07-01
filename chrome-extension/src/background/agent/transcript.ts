/**
 * Per-run transcript collector. The runs IndexedDB store keeps a full
 * snapshot of each turn so the Options "Rapor" button can render a
 * HAR-style HTML report. We accumulate the data in-memory during the run
 * and write a single record at the end.
 *
 * Kept as a class so the runner doesn't have to thread a dozen accumulator
 * variables through its callbacks.
 */

import { TaskLogger } from '../lib/task-logger.js';
import type { StreamErrorInfo } from './error-mapping.js';
import type { TranscriptRecord, TranscriptToolCall, TranscriptToolSchema } from '../lib/task-logger.js';
import type { ModelMessage } from 'ai';

export interface TranscriptHandle {
  runId: string | null;
  conversationId: string;
  startedAt: number;
  provider?: string;
  model?: string;
}

export class TranscriptCollector {
  private system: string | undefined;
  private messages: ModelMessage[] | undefined;
  private tools: TranscriptToolSchema[] = [];
  private readonly toolCalls = new Map<string, TranscriptToolCall>();
  private readonly toolCallList: TranscriptToolCall[] = [];
  private responseText = '';
  private finishReason: string | undefined;
  private usage: TranscriptRecord['usage'];
  private error: TranscriptRecord['error'];

  noteSystem(system: string) {
    this.system = system;
  }

  noteMessages(messages: ModelMessage[]) {
    this.messages = messages;
  }

  noteTools(tools: TranscriptToolSchema[]) {
    this.tools = tools;
  }

  noteToolStart(call: { id: string; name: string; args: unknown }) {
    const entry: TranscriptToolCall = {
      callId: call.id,
      name: call.name,
      args: call.args,
      startedAt: Date.now(),
    };
    this.toolCalls.set(call.id, entry);
    this.toolCallList.push(entry);
  }

  noteToolEnd(call: { id: string; name: string; result: unknown; isError: boolean }) {
    const entry = this.toolCalls.get(call.id);
    if (entry) {
      entry.result = call.result;
      entry.isError = call.isError;
      entry.endedAt = Date.now();
      return;
    }
    // Defensive: end without start (shouldn't happen via the wrapper).
    this.toolCallList.push({
      callId: call.id,
      name: call.name,
      args: undefined,
      result: call.result,
      isError: call.isError,
      endedAt: Date.now(),
    });
  }

  noteResponseDelta(delta: string) {
    this.responseText += delta;
  }

  noteFinishReason(reason: string | undefined) {
    if (reason) this.finishReason = reason;
  }

  noteUsage(usage: TranscriptRecord['usage']) {
    this.usage = usage;
  }

  noteError(info: StreamErrorInfo, fallbackFinish: string = 'error') {
    this.error = {
      type: info.type,
      message: info.message,
      statusCode: info.statusCode,
      responseBody: info.responseBody,
    };
    if (!this.finishReason) this.finishReason = fallbackFinish;
  }

  noteSyntheticError(type: string, message: string, fallbackFinish: string) {
    this.error = { type, message };
    if (!this.finishReason) this.finishReason = fallbackFinish;
  }

  ensureFinishReason(fallback: string) {
    if (!this.finishReason) this.finishReason = fallback;
  }

  async persist(handle: TranscriptHandle): Promise<void> {
    if (!handle.runId) return;
    try {
      await TaskLogger.saveTranscript({
        runId: handle.runId,
        conversationId: handle.conversationId,
        startedAt: handle.startedAt,
        endedAt: Date.now(),
        provider: handle.provider,
        model: handle.model,
        system: this.system,
        messages: this.messages,
        tools: this.tools,
        toolCalls: this.toolCallList,
        responseText: this.responseText || undefined,
        finishReason: this.finishReason,
        usage: this.usage,
        error: this.error,
      });
    } catch (err) {
      console.warn('[doeverything] saveTranscript failed', err);
    }
  }
}
