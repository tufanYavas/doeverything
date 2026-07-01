/**
 * WorkflowGenerator.
 *
 * Given a recorded action sequence, ask the active LLM to produce:
 *   - a short workflow `description` (1 sentence)
 *   - a structured action `summary` (numbered steps the agent can replay)
 *
 * Both fields are written back into `recordingsStorage` so the user can
 * review them on the GIF viewer / pairing tab. If the LLM call fails, we
 * fall back to a rule-based summary.
 */

import { recordingToPrompt } from './recorder.js';
import { createLanguageModel } from '@doeverything/llm-providers';
import { activeBaseUrl, activeModel, llmConfigStorage, recordingsStorage } from '@doeverything/storage';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { Recording } from '@doeverything/storage';

const WorkflowSummarySchema = z.object({
  description: z.string().describe('One-sentence summary of what the workflow accomplishes.'),
  summary: z.array(z.string()).describe('Numbered, replay-friendly action list.'),
});

export async function generateWorkflowMetadata(recording: Recording): Promise<void> {
  const cfg = await llmConfigStorage.get();
  const apiKey = cfg.apiKeys[cfg.provider] ?? '';
  if (!apiKey && cfg.provider !== 'openai-compatible') return;
  const replayPrompt = recordingToPrompt(recording.actions, recording.narration);
  let description = '';
  let summary: string[] = [];
  try {
    const model = await createLanguageModel({
      provider: cfg.provider,
      model: activeModel(cfg),
      apiKey,
      baseUrl: activeBaseUrl(cfg) || undefined,
    });
    const result = await generateObject({
      model,
      schema: WorkflowSummarySchema,
      system:
        'You summarise doeverything browser workflows. Return a one-sentence description and a clean numbered action list (≤10 steps).',
      prompt: replayPrompt,
    });
    description = result.object.description;
    summary = result.object.summary;
  } catch {
    description = `Workflow with ${recording.actions.length} steps`;
    summary = recording.actions.map((a, idx) => `${idx + 1}. ${a.kind}${a.url ? ` (${a.url})` : ''}`);
  }

  // Persist back into the recording.
  await recordingsStorage.set(prev => ({
    ...prev,
    recordings: prev.recordings.map(r =>
      r.id === recording.id
        ? {
            ...r,
            narration: r.narration ?? description,
            // We re-use the existing `narration` field for the LLM-generated
            // description so Phase 16 doesn't need a new schema migration.
          }
        : r,
    ),
  }));
  // Also store the structured summary under chrome.storage.local so the
  // recording viewer can render it without re-generating.
  await chrome.storage.local.set({
    [`doe/recording-summary/${recording.id}`]: { description, summary, generatedAt: Date.now() },
  });
}
