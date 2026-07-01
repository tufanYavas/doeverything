import { describeStreamError, describeUiMessage, isContextOverflowError } from './error-mapping.js';
import { describe, expect, it } from 'vitest';

describe('describeStreamError', () => {
  it('reads name/message/statusCode/responseBody off an APICallError-shaped object', () => {
    const info = describeStreamError({
      name: 'AI_APICallError',
      message: 'boom',
      statusCode: 400,
      responseBody: '{"error":"bad"}',
      url: 'https://api.example.com/v1/messages',
    });
    expect(info.type).toBe('AI_APICallError');
    expect(info.message).toBe('boom');
    expect(info.statusCode).toBe(400);
    expect(info.responseBody).toContain('bad');
  });

  it('falls back through `cause` when the top-level fields are missing', () => {
    const info = describeStreamError({ cause: { message: 'nested', statusCode: 529 } });
    expect(info.message).toBe('nested');
    expect(info.statusCode).toBe(529);
  });

  it('truncates an over-long responseBody to keep transcripts bounded', () => {
    const info = describeStreamError({ message: 'x', responseBody: 'z'.repeat(5000) });
    expect((info.responseBody ?? '').length).toBeLessThanOrEqual(800);
  });

  it('handles a plain string / non-object error', () => {
    expect(describeStreamError('kaboom').message).toBe('kaboom');
    expect(describeStreamError('kaboom').type).toBe('Error');
  });
});

describe('isContextOverflowError', () => {
  it('matches the known overflow phrasings in the message', () => {
    for (const msg of [
      'prompt is too long: 250000 tokens > 200000 maximum',
      'This model has a maximum context length of 8192 tokens',
      'input length exceeds the context window',
    ]) {
      expect(isContextOverflowError({ type: 'E', message: msg })).toBe(true);
    }
  });

  it('matches wording that only appears in the response body', () => {
    expect(
      isContextOverflowError({ type: 'E', message: 'Bad Request', responseBody: '{"error":"prompt is too long"}' }),
    ).toBe(true);
  });

  it('does not flag unrelated errors', () => {
    expect(isContextOverflowError({ type: 'E', message: 'rate limit exceeded' })).toBe(false);
    expect(isContextOverflowError({ type: 'E', message: 'network error' })).toBe(false);
  });
});

describe('describeUiMessage', () => {
  it('prefixes context overflow', () => {
    expect(describeUiMessage({ type: 'E', message: 'prompt is too long' })).toMatch(/^Conversation context overflowed/);
  });

  it('prefixes overload / rate-limit (incl. 529)', () => {
    expect(describeUiMessage({ type: 'E', message: 'overloaded' })).toMatch(/overloaded or rate-limited/);
    expect(describeUiMessage({ type: 'E', message: 'busy', statusCode: 529 })).toMatch(/overloaded or rate-limited/);
  });

  it('prefixes a generic provider error with its status code', () => {
    expect(describeUiMessage({ type: 'E', message: 'nope', statusCode: 403 })).toMatch(/^Provider error \(403\)/);
  });
});
