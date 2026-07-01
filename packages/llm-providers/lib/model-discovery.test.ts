import { listModels, listOpenAICompatModels } from './model-discovery.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Build a fetch stub that returns one JSON body for any URL. */
function mockFetchJson(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listOpenAICompatModels', () => {
  it('parses the { data: [...] } shape and ids', async () => {
    mockFetchJson({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
    const res = await listOpenAICompatModels('https://api.example.com/v1', { apiKey: 'k' });
    expect(res.models).toEqual(['model-a', 'model-b']);
    expect(res.contextWindows).toBeUndefined();
  });

  it('parses a top-level array shape (Together-style)', async () => {
    mockFetchJson([{ id: 'x' }, { id: 'y' }]);
    const res = await listOpenAICompatModels('https://api.example.com/v1', { apiKey: 'k' });
    expect(res.models).toEqual(['x', 'y']);
  });

  it('collects context_length into contextWindows when present (OpenRouter/Together)', async () => {
    mockFetchJson({
      data: [
        { id: 'big', context_length: 131072 },
        { id: 'small', context_length: 8192 },
        { id: 'unknown' },
      ],
    });
    const res = await listOpenAICompatModels('https://openrouter.ai/api/v1', { apiKey: '' });
    expect(res.models).toEqual(['big', 'small', 'unknown']);
    expect(res.contextWindows).toEqual({ big: 131072, small: 8192 });
  });

  it('ignores non-positive / non-finite context_length values', async () => {
    mockFetchJson({ data: [{ id: 'a', context_length: 0 }, { id: 'b', context_length: -5 }] });
    const res = await listOpenAICompatModels('https://api.example.com/v1', { apiKey: 'k' });
    expect(res.contextWindows).toBeUndefined();
  });

  it('drops entries without a usable id', async () => {
    mockFetchJson({ data: [{ id: '' }, {}, { id: 'real' }] });
    const res = await listOpenAICompatModels('https://api.example.com/v1', { apiKey: 'k' });
    expect(res.models).toEqual(['real']);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    mockFetchJson({ error: 'nope' }, false, 401);
    await expect(listOpenAICompatModels('https://api.example.com/v1', { apiKey: 'bad' })).rejects.toThrow(/401/);
  });
});

describe('listModels — Google', () => {
  it('strips the models/ prefix and keys inputTokenLimit by the stripped id', async () => {
    mockFetchJson({
      models: [
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
      ],
    });
    const res = await listModels('google', { apiKey: 'k' });
    expect(res.models).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(res.contextWindows).toEqual({ 'gemini-2.5-pro': 1048576, 'gemini-2.5-flash': 1048576 });
  });
});

describe('listModels — OpenAI chat filter', () => {
  it('keeps only chat-capable ids and filters contextWindows to survivors', async () => {
    mockFetchJson({
      data: [
        { id: 'gpt-4o', context_length: 128000 },
        { id: 'text-embedding-3-small', context_length: 8191 },
        { id: 'o3-mini', context_length: 200000 },
        { id: 'dall-e-3' },
      ],
    });
    const res = await listModels('openai', { apiKey: 'k' });
    expect(res.models).toEqual(['gpt-4o', 'o3-mini']);
    expect(res.contextWindows).toEqual({ 'gpt-4o': 128000, 'o3-mini': 200000 });
  });
});

describe('listModels — Anthropic', () => {
  it('parses ids and exposes no contextWindows (endpoint reports none)', async () => {
    mockFetchJson({ data: [{ id: 'claude-opus-4-7', type: 'model' }, { id: 'claude-haiku-4-5', type: 'model' }] });
    const res = await listModels('anthropic', { apiKey: 'k' });
    expect(res.models).toEqual(['claude-opus-4-7', 'claude-haiku-4-5']);
    expect(res.contextWindows).toBeUndefined();
  });
});

describe('listModels — custom provider requires a base URL', () => {
  it('throws when a custom provider has no base URL', async () => {
    await expect(listModels('custom:fireworks', { apiKey: 'k' })).rejects.toThrow(/base URL/i);
  });
});
