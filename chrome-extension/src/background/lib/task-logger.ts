/**
 * TaskLogger — IndexedDB-backed log of agent runs.
 *
 * Each row records: which conversation, which tools fired, the start/end
 * timestamps, the user prompt that kicked it off, and the outcome
 * (`success` / `error` / `aborted`). The Options page can render this for
 * debugging; the SW also uses it to compute weekly summaries.
 */

const DB_NAME = 'de-task-log';
const DB_VERSION = 2;
const STORE = 'runs';
const TRANSCRIPT_STORE = 'transcripts';

export interface TaskRunMetrics {
  /** ms from `startedAt` to the first text/tool delta. -1 if never observed. */
  firstTokenLatencyMs?: number;
  /** Aggregate Vercel-AI-SDK usage from streamText.onFinish. */
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
}

export interface TaskRunRecord {
  id: string;
  conversationId: string;
  startedAt: number;
  endedAt?: number;
  prompt: string;
  toolCalls: Array<{ name: string; ok: boolean }>;
  outcome: 'success' | 'error' | 'aborted' | 'running';
  errorMessage?: string;
  scheduledTaskId?: string;
  /** Provider id at the time the run started ("anthropic", "custom:fireworks", …). */
  provider?: string;
  /** Resolved model id used for the run. */
  model?: string;
  /** Per-run telemetry surfaced in the Options "Runs" tab. */
  metrics?: TaskRunMetrics;
}

/**
 * Full per-turn snapshot used by the "Rapor" (Report) button in the Runs tab.
 * Mirrors what a HAR file captures for an LLM API call: the inputs we sent
 * (system prompt, message history, tool schemas) and what came back
 * (assistant text, tool calls with args + results, usage, finish reason).
 *
 * Stored separately from TaskRunRecord because these payloads are large
 * (tens of KB to a few MB per turn) and we don't want to drag them through
 * the lightweight Runs list query.
 */
export interface TranscriptToolCall {
  callId?: string;
  name: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  startedAt?: number;
  endedAt?: number;
}

export interface TranscriptToolSchema {
  name: string;
  description?: string;
  /** JSON-Schema-ish view of the tool's input shape. May be partial — Zod schemas don't always serialize cleanly. */
  inputSchema?: unknown;
}

export interface TranscriptRecord {
  runId: string;
  conversationId: string;
  startedAt: number;
  endedAt?: number;
  provider?: string;
  model?: string;
  /** Resolved system prompt as sent to the model (already includes browser context). */
  system?: string;
  /** Conversation messages as they were passed to streamText (ephemeral state already injected into the last user message). */
  messages?: unknown;
  /** Tool roster the model could pick from this turn. */
  tools?: TranscriptToolSchema[];
  /** Each tool the model actually invoked, with args + result. */
  toolCalls: TranscriptToolCall[];
  /** Assistant text accumulated from the delta stream. */
  responseText?: string;
  /** AI SDK finish reason ('stop', 'tool-calls', 'length', 'error', etc.). */
  finishReason?: string;
  /** Final aggregate usage from streamText.onFinish. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  /** If the run failed, the error info we surfaced to the UI. */
  error?: { type?: string; message: string; statusCode?: number; responseBody?: string };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('startedAt', 'startedAt');
        store.createIndex('conversationId', 'conversationId');
      }
      if (!db.objectStoreNames.contains(TRANSCRIPT_STORE)) {
        const store = db.createObjectStore(TRANSCRIPT_STORE, { keyPath: 'runId' });
        store.createIndex('conversationId', 'conversationId');
        store.createIndex('startedAt', 'startedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    Promise.resolve(fn(store)).then(resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export const TaskLogger = {
  async start(record: Omit<TaskRunRecord, 'id' | 'startedAt' | 'outcome' | 'toolCalls'>): Promise<string> {
    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: TaskRunRecord = { ...record, id, startedAt: Date.now(), outcome: 'running', toolCalls: [] };
    await withStore(
      STORE,
      'readwrite',
      store =>
        new Promise<void>((res, rej) => {
          const r = store.put(full);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        }),
    );
    return id;
  },

  /** Merge a partial metrics snapshot into the run record. */
  async mergeMetrics(id: string, patch: Partial<TaskRunMetrics>): Promise<void> {
    await withStore(
      STORE,
      'readwrite',
      store =>
        new Promise<void>((res, rej) => {
          const get = store.get(id);
          get.onsuccess = () => {
            const record = get.result as TaskRunRecord | undefined;
            if (!record) return res();
            record.metrics = { ...(record.metrics ?? {}), ...patch };
            const put = store.put(record);
            put.onsuccess = () => res();
            put.onerror = () => rej(put.error);
          };
          get.onerror = () => rej(get.error);
        }),
    );
  },

  async noteToolCall(id: string, name: string, ok: boolean): Promise<void> {
    await withStore(
      STORE,
      'readwrite',
      store =>
        new Promise<void>((res, rej) => {
          const get = store.get(id);
          get.onsuccess = () => {
            const record = get.result as TaskRunRecord | undefined;
            if (!record) return res();
            record.toolCalls.push({ name, ok });
            const put = store.put(record);
            put.onsuccess = () => res();
            put.onerror = () => rej(put.error);
          };
          get.onerror = () => rej(get.error);
        }),
    );
  },

  async finish(id: string, outcome: TaskRunRecord['outcome'], errorMessage?: string): Promise<void> {
    await withStore(
      STORE,
      'readwrite',
      store =>
        new Promise<void>((res, rej) => {
          const get = store.get(id);
          get.onsuccess = () => {
            const record = get.result as TaskRunRecord | undefined;
            if (!record) return res();
            record.endedAt = Date.now();
            record.outcome = outcome;
            record.errorMessage = errorMessage;
            const put = store.put(record);
            put.onsuccess = () => res();
            put.onerror = () => rej(put.error);
          };
          get.onerror = () => rej(get.error);
        }),
    );
  },

  async list(limit = 100): Promise<TaskRunRecord[]> {
    return withStore(
      STORE,
      'readonly',
      store =>
        new Promise<TaskRunRecord[]>((res, rej) => {
          const out: TaskRunRecord[] = [];
          const req = store.index('startedAt').openCursor(null, 'prev');
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor && out.length < limit) {
              out.push(cursor.value as TaskRunRecord);
              cursor.continue();
            } else {
              res(out);
            }
          };
          req.onerror = () => rej(req.error);
        }),
    );
  },

  /**
   * Persist (or replace) the full per-turn transcript for a run. Called once
   * at the end of `startAgentRun`, after the stream has terminated and we
   * know the assistant text + final usage. Idempotent — if the same runId
   * lands twice (shouldn't happen, but defensive), the later call wins.
   */
  async saveTranscript(record: TranscriptRecord): Promise<void> {
    await withStore(
      TRANSCRIPT_STORE,
      'readwrite',
      store =>
        new Promise<void>((res, rej) => {
          const r = store.put(record);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        }),
    );
  },

  /**
   * Fetch every transcript for a conversation, oldest-first (chronological
   * turn order). Used by the Options "Rapor" button to assemble a HAR-style
   * HTML report of the entire chat.
   */
  async transcriptsForConversation(conversationId: string): Promise<TranscriptRecord[]> {
    return withStore(
      TRANSCRIPT_STORE,
      'readonly',
      store =>
        new Promise<TranscriptRecord[]>((res, rej) => {
          const out: TranscriptRecord[] = [];
          const range = IDBKeyRange.only(conversationId);
          const req = store.index('conversationId').openCursor(range);
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              out.push(cursor.value as TranscriptRecord);
              cursor.continue();
            } else {
              out.sort((a, b) => a.startedAt - b.startedAt);
              res(out);
            }
          };
          req.onerror = () => rej(req.error);
        }),
    );
  },
};
