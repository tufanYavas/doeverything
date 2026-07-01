/**
 * Conversation-to-action SW bridge.
 *
 * Inbound:
 *   - de/conversation/convert-to-action { messages }
 *       → Asks the user's fast/aux model to read the chat transcript and
 *         emit a structured "action" config — name, optional slash
 *         command, prompt body that would replay the same outcome, and a
 *         schedule suggestion (or `none`). Returned to the caller as a
 *         plain object the side panel can drop straight into the
 *         SaveActionDialog.
 *
 * The conversion prompt is intentionally directive: the LLM's output must
 * be REPLAYABLE — not a description of what happened, but instructions
 * that would reproduce the result. We also tell the model to absorb any
 * mid-conversation corrections so the saved action skips dead ends. This
 * Output is structured-object instead of XML for type-safe parsing.
 */

import { resolveFastModel } from '../tools/internal/helpers.js';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ModelMessage } from 'ai';

const ConvertedActionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .describe('Short human-readable title (≤60 chars) describing what the action does.'),
  command: z
    .string()
    .regex(/^[a-z0-9-_]+$/)
    .max(40)
    .optional()
    .describe(
      'Optional kebab-case slash-command shorthand the user can type as `/<command>` to invoke this action. Leave empty if a one-word command is awkward.',
    ),
  prompt: z
    .string()
    .min(1)
    .describe(
      'Replayable prompt body. Instructs doeverything to reproduce the SAME outcome the conversation reached — incorporating any corrections so the action does not repeat dead ends.',
    ),
  url: z
    .string()
    .url()
    .optional()
    .describe(
      'Starting URL the action should land on before executing `prompt`. Extract from the conversation when the work was clearly anchored to one site (e.g. a Gmail thread, a LinkedIn page, a specific dashboard). Omit when the task is site-agnostic.',
    ),
  schedule: z
    .object({
      repeat: z
        .enum(['once', 'daily', 'weekly', 'monthly', 'custom_minutes'])
        .describe('How often the action should fire.'),
      datetimeISO: z
        .string()
        .optional()
        .describe(
          'ISO date-time for the first/only run. Required for `once`; for recurring schedules it sets the next-fire time.',
        ),
      customMinutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Required when `repeat` is `custom_minutes`.'),
    })
    .nullable()
    .describe(
      'Schedule suggestion. Set to null when the conversation does not imply repetition — e.g. one-off Q&A or exploratory tasks. Default to `null` unless the chat explicitly references a cadence.',
    ),
});

export type ConvertedAction = z.infer<typeof ConvertedActionSchema>;

interface ConvertMessage {
  type: 'doe/conversation/convert-to-action';
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    /** Plain text body — the side panel flattens its rich parts before sending. */
    text: string;
  }>;
}

const SYSTEM_PROMPT = [
  'You convert doeverything browser-automation conversations into reusable action configs.',
  'Return JSON matching the requested schema — no prose outside the schema.',
  'Optimise for REPLAYABILITY: the `prompt` must instruct doeverything to reproduce the final result, not describe the past.',
  'If the conversation went through corrections or refinements, incorporate the lesson — do NOT make the action repeat the dead ends.',
  'Set `url` when the work was anchored to a specific site (Gmail, LinkedIn, a dashboard, etc.) — pick the canonical origin (e.g. https://mail.google.com) so the agent lands in the right place. Omit when the task is site-agnostic.',
  'Suggest a `schedule` only when the chat reasonably implies recurrence (cron-like phrasing, "every morning", "each Monday"). Otherwise emit `schedule: null`.',
].join('\n');

const USER_INSTRUCTION = [
  'Read the conversation above.',
  'Emit a single action config that, when run by doeverything on a fresh window, would reproduce the same outcome.',
  'Pick a concise `name` (≤60 chars).',
  'If a one-word slash command makes sense, set `command` (kebab-case, no slash).',
  'Write `prompt` as a clear, complete instruction — not a summary.',
  'If the work was bound to a specific website, set `url` to that site\'s origin; otherwise omit it.',
  'Set `schedule` only when the conversation implies a cadence; otherwise leave it null.',
].join('\n');

export function registerConvertConversationHandlers() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string } | null;
    if (msg?.type !== 'doe/conversation/convert-to-action') return false;

    void (async () => {
      try {
        const result = await convert(msg as ConvertMessage);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  });
}

async function convert(msg: ConvertMessage): Promise<{ ok: true; action: ConvertedAction } | { ok: false; error: string }> {
  if (!Array.isArray(msg.messages) || msg.messages.length === 0) {
    return { ok: false, error: 'No conversation to convert.' };
  }

  const transcriptMessages: ModelMessage[] = msg.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text.trim() }));

  if (transcriptMessages.length === 0) {
    return { ok: false, error: 'Conversation has no text content to summarise.' };
  }

  // The first message must be a user turn so the model has a clear seed.
  // If the chat history starts with an assistant turn (e.g. a system seed),
  // prepend a placeholder so the SDK doesn't reject the message order.
  if (transcriptMessages[0].role === 'assistant') {
    transcriptMessages.unshift({ role: 'user', content: 'Continue the conversation.' });
  }

  const model = await resolveFastModel();

  const result = await generateObject({
    model,
    schema: ConvertedActionSchema,
    system: SYSTEM_PROMPT,
    messages: [...transcriptMessages, { role: 'user', content: USER_INSTRUCTION }],
  });

  return { ok: true, action: result.object };
}
