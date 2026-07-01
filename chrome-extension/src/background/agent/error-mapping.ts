/**
 * AI SDK errors are class-based (`APICallError`, `InvalidPromptError`, etc.)
 * but the shapes aren't part of the public type, so we read defensively
 * and map to a stable shape that the UI / transcript can rely on.
 */

export interface StreamErrorInfo {
  type: string;
  message: string;
  statusCode?: number;
  responseBody?: string;
  url?: string;
}

export function describeStreamError(error: unknown): StreamErrorInfo {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const cause = (e.cause as Record<string, unknown> | undefined) ?? undefined;
    const responseBody =
      (typeof e.responseBody === 'string' && e.responseBody) ||
      (typeof cause?.responseBody === 'string' && cause.responseBody) ||
      undefined;
    return {
      type: (typeof e.name === 'string' && e.name) || 'Error',
      message:
        (typeof e.message === 'string' && e.message) ||
        (typeof cause?.message === 'string' && cause.message) ||
        String(error),
      statusCode:
        (typeof e.statusCode === 'number' && e.statusCode) ||
        (typeof cause?.statusCode === 'number' && cause.statusCode) ||
        undefined,
      responseBody: typeof responseBody === 'string' ? responseBody.slice(0, 800) : undefined,
      url: (typeof e.url === 'string' && e.url) || (typeof cause?.url === 'string' && cause.url) || undefined,
    };
  }
  return { type: 'Error', message: String(error) };
}

const CONTEXT_OVERFLOW_RE = /too long|context window|maximum context|input length|prompt is too long/i;

/**
 * Classify a stream error as "the request exceeded the model's context
 * window". Scans the response body too — some providers put the useful
 * wording only there. The runner uses this to trigger its one-shot
 * forced-compaction recovery.
 */
export function isContextOverflowError(info: StreamErrorInfo): boolean {
  if (CONTEXT_OVERFLOW_RE.test(info.message)) return true;
  return typeof info.responseBody === 'string' && CONTEXT_OVERFLOW_RE.test(info.responseBody);
}

/**
 * Map a structured error into a user-facing message that names the failure
 * mode in plain English. Context overflow, provider rate limit, and 5xx
 * outages each get their own prefix so the user knows whether to retry,
 * compact, or wait.
 */
export function describeUiMessage(info: StreamErrorInfo): string {
  const tooLong = isContextOverflowError(info);
  const overloaded = info.statusCode === 529 || /overloaded|rate.?limit/i.test(info.message);
  const prefix = tooLong
    ? 'Conversation context overflowed'
    : overloaded
      ? 'Model is overloaded or rate-limited'
      : info.statusCode
        ? `Provider error (${info.statusCode})`
        : info.type;
  return `${prefix}: ${info.message}`;
}
