import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LlmProvidersModule from '@doeverything/llm-providers';
import type { Recording } from '@doeverything/storage';
import type * as AiModule from 'ai';

/**
 * generateWorkflowMetadata asks the active LLM for a workflow description +
 * numbered summary, then persists both. These tests pin the documented
 * LLM-FAILURE FALLBACK path: when the model call throws, the code derives a
 * rule-based description (`Workflow with N steps`) and a numbered action list
 * (`<idx>. <kind>[ (<url>)]`), writes the description into the recording's
 * `narration` (only if it had none) and stores `{ description, summary,
 * generatedAt }` under `doe/recording-summary/<id>` in storage.local.
 *
 * We hit the fallback two ways:
 *   - createLanguageModel itself throws (model construction blows up), and
 *   - generateObject throws (the LLM call fails after a model was built).
 * Both must land on the same rule-based output.
 *
 * The real `@doeverything/storage` (and its fake-chrome-backed storage) is kept;
 * we seed `doe:llm-config` as plaintext so the `apiKey` guard passes and
 * `decryptSecret` returns the key verbatim (no IndexedDB master key needed).
 */

const LLM_CONFIG_KEY = 'doe:llm-config';

let createModelThrows = true;
let generateObjectThrows = true;

vi.mock('@doeverything/llm-providers', async () => {
  const actual = await vi.importActual<typeof LlmProvidersModule>('@doeverything/llm-providers');
  return {
    ...actual,
    createLanguageModel: vi.fn(async () => {
      if (createModelThrows) throw new Error('model construction failed');
      return { __fakeModel: true };
    }),
  };
});

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('ai');
  return {
    ...actual,
    generateObject: vi.fn(async () => {
      if (generateObjectThrows) throw new Error('generateObject failed');
      return { object: { description: 'LLM description', summary: ['1. did a thing'] } };
    }),
  };
});

async function seedConfig(opts: { provider?: string; apiKey?: string } = {}) {
  const provider = opts.provider ?? 'anthropic';
  await chrome.storage.local.set({
    [LLM_CONFIG_KEY]: {
      provider,
      models: {},
      apiKeys: opts.apiKey ? { [provider]: opts.apiKey } : {},
      baseUrls: {},
      fastModel: null,
    },
  });
}

function makeRecording(over: Partial<Recording> = {}): Recording {
  return {
    id: 'rec-1',
    name: 'Test recording',
    createdAt: 1000,
    actions: [
      { id: 'a1', kind: 'navigate', timestamp: 1, tabId: 1, url: 'https://example.com', data: {} },
      { id: 'a2', kind: 'click', timestamp: 2, tabId: 1, data: { x: 5, y: 6 } },
    ],
    ...over,
  };
}

interface GlobalShape {
  __chromeState: { local: Record<string, unknown> };
}
const g = globalThis as unknown as GlobalShape;

beforeEach(() => {
  createModelThrows = true;
  generateObjectThrows = true;
  vi.resetModules();
});

describe('generateWorkflowMetadata — guard', () => {
  it('returns early (no storage write) when no api key and provider is not openai-compatible', async () => {
    await seedConfig({ provider: 'anthropic', apiKey: '' });
    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording());
    expect(g.__chromeState.local['doe/recording-summary/rec-1']).toBeUndefined();
  });

  it('does NOT return early for openai-compatible even without a key', async () => {
    await seedConfig({ provider: 'openai-compatible', apiKey: '' });
    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording());
    // Fallback ran → summary persisted.
    expect(g.__chromeState.local['doe/recording-summary/rec-1']).toBeDefined();
  });
});

describe('generateWorkflowMetadata — LLM-failure fallback (createLanguageModel throws)', () => {
  it('writes the rule-based description + numbered summary to storage.local', async () => {
    createModelThrows = true;
    await seedConfig({ apiKey: 'sk-test' });
    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording());

    const stored = g.__chromeState.local['doe/recording-summary/rec-1'] as {
      description: string;
      summary: string[];
      generatedAt: number;
    };
    expect(stored.description).toBe('Workflow with 2 steps');
    // url-bearing actions append " (url)"; others do not.
    expect(stored.summary).toEqual(['1. navigate (https://example.com)', '2. click']);
    expect(typeof stored.generatedAt).toBe('number');
  });

  it('fills the recording narration with the fallback description when it had none', async () => {
    createModelThrows = true;
    await seedConfig({ apiKey: 'sk-test' });
    const { recordingsStorage } = await import('@doeverything/storage');
    // Put the recording into storage first so the set()-mapper can find it.
    await recordingsStorage.set(() => ({ recordings: [makeRecording()], active: null }));

    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording());

    const state = await recordingsStorage.get();
    expect(state.recordings[0].narration).toBe('Workflow with 2 steps');
  });

  it('preserves an existing narration (does not overwrite with the fallback)', async () => {
    createModelThrows = true;
    await seedConfig({ apiKey: 'sk-test' });
    const { recordingsStorage } = await import('@doeverything/storage');
    await recordingsStorage.set(() => ({
      recordings: [makeRecording({ narration: 'user wrote this' })],
      active: null,
    }));

    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording({ narration: 'user wrote this' }));

    const state = await recordingsStorage.get();
    expect(state.recordings[0].narration).toBe('user wrote this');
  });
});

describe('generateWorkflowMetadata — LLM-failure fallback (generateObject throws)', () => {
  it('falls back identically when the model builds but the call fails', async () => {
    createModelThrows = false; // model constructs fine...
    generateObjectThrows = true; // ...but the generation throws.
    await seedConfig({ apiKey: 'sk-test' });
    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording());

    const stored = g.__chromeState.local['doe/recording-summary/rec-1'] as {
      description: string;
      summary: string[];
    };
    expect(stored.description).toBe('Workflow with 2 steps');
    expect(stored.summary).toEqual(['1. navigate (https://example.com)', '2. click']);
  });
});

describe('generateWorkflowMetadata — empty action list fallback', () => {
  it('reports zero steps and an empty summary', async () => {
    createModelThrows = true;
    await seedConfig({ apiKey: 'sk-test' });
    const { generateWorkflowMetadata } = await import('./workflow-generator.js');
    await generateWorkflowMetadata(makeRecording({ actions: [] }));

    const stored = g.__chromeState.local['doe/recording-summary/rec-1'] as {
      description: string;
      summary: string[];
    };
    expect(stored.description).toBe('Workflow with 0 steps');
    expect(stored.summary).toEqual([]);
  });
});
