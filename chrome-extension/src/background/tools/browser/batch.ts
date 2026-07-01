/**
 * `multi_action` — execute a sequence of browser tool calls in one
 * round-trip. Instead of relying on the model to emit multiple `tool_use`
 * blocks per turn (which models are reluctant to do, regardless of
 * `tool_choice` / system-prompt nudges), expose ONE tool that takes an
 * array of `{name, input}` and dispatches them sequentially client-side.
 *
 * Why we don't lean on parallel `tool_use` instead:
 * - Even with `tool_choice: auto` and explicit system-prompt encouragement,
 *   we observed Opus 4.7 emitting exactly one `tool_use` per turn (HAR
 *   audit, 2026-05).
 * - A single nested call gives us deterministic ordering, atomic permission
 *   checks, and one consolidated `tool_result` block with interleaved
 *   image parts — much cheaper than N independent round-trips.
 *
 * Execution semantics:
 * - Actions run in declaration order. Stop on the first action that
 *   returns `{ error: ... }` or throws.
 * - Each sub-tool is invoked through its WRAPPED `execute`, so per-tool
 *   timeout, queue, and result compression all still apply per action.
 *   Sub-action lifecycle (`onToolStart` / `onToolEnd`) is SUPPRESSED via
 *   the `__doeInBatch` opts flag — the parent `multi_action` chip is
 *   the single UI surface for the whole sequence.
 * - Screenshot / image markers from sub-actions are stripped from the
 *   per-action JSON record and collected into `__doe_batch_images`.
 *   The `toModelOutput` hook then emits a multi-part content block (text +
 *   image-data + text + image-data + …) so vision-capable models SEE every
 *   image the batch produced.
 *
 * Disallowed nestings:
 * - `multi_action` cannot recurse into itself.
 * - `done` cannot appear inside a batch — it ends the run, so it must be
 *   emitted as its own top-level tool call.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

type ToolSlot = {
  execute?: (args: unknown, opts: { toolCallId?: string } & Record<string, unknown>) => PromiseLike<unknown>;
};

type BatchableRoster = Record<string, unknown>;

interface ActionRecord {
  name: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

interface BatchImage {
  base64: string;
  mediaType: string;
  label: string;
}

const DISALLOWED_INSIDE_BATCH = new Set(['multi_action', 'done']);

export function multiActionTool(_ctx: AgentToolContext, rosterRef: { current: BatchableRoster | null }) {
  return {
    multi_action: tool({
      description: `Execute a sequence of doeverything tool calls in ONE round trip. Each item is \`{name, input}\` where \`input\` is exactly what you'd pass to that tool standalone. Actions execute SEQUENTIALLY (not in parallel) and stop on the first error. Use this tool EXTENSIVELY whenever you can predict two or more steps ahead — e.g. \`navigate → click a field → type → key:Enter → screenshot\`, form fills, multi-step navigation, replacing a text field's value (\`triple_click → type\`). Each sub-tool's own permission check runs per item; if one item is denied, the batch stops there. Screenshots and other images are returned interleaved with outputs; coordinates you write in THIS batch refer to the screenshot taken BEFORE this call. \`multi_action\` cannot be nested, and \`done\` cannot appear inside it. Example:
[
  {"name":"input","input":{"ref":"42","text":"hello","tabId":123}},
  {"name":"computer","input":{"action":"key","text":"Enter","tabId":123}},
  {"name":"computer","input":{"action":"screenshot","tabId":123}}
]`,
      inputSchema: z.object({
        actions: z
          .array(
            z.object({
              name: z
                .string()
                .describe('Tool name (e.g. `computer`, `navigate`, `input`, `find`, `read_page`). Cannot be `multi_action` or `done`.'),
              input: z
                .record(z.string(), z.unknown())
                .describe("That tool's input — exactly the same shape you'd pass when calling it directly."),
            }),
          )
          .min(1)
          .max(12)
          .describe('Ordered list of tool calls to execute sequentially. Cap ~12 per batch; if you need more, split across turns.'),
      }),
      execute: async (params, opts) => {
        const roster = rosterRef.current;
        if (!roster) {
          return { ok: false, error: 'multi_action: tool roster not initialised yet.' };
        }

        const results: ActionRecord[] = [];
        const images: BatchImage[] = [];
        let stopped = false;

        // Strip our own toolCallId AND mark sub-calls as in-batch so the
        // wrapper skips firing per-action lifecycle events — the parent
        // `multi_action` chip is the single UI surface for the sequence.
        const subOpts: Record<string, unknown> = { __doeInBatch: true };
        for (const [k, v] of Object.entries(opts ?? {})) {
          if (k === 'toolCallId') continue;
          subOpts[k] = v;
        }

        for (let i = 0; i < params.actions.length; i++) {
          const action = params.actions[i];

          if (DISALLOWED_INSIDE_BATCH.has(action.name)) {
            results.push({
              name: action.name,
              ok: false,
              error:
                action.name === 'multi_action'
                  ? 'multi_action cannot be nested.'
                  : '`done` cannot appear inside multi_action — emit it as its own tool call.',
            });
            stopped = true;
            break;
          }

          const slot = (roster as Record<string, ToolSlot>)[action.name];
          if (!slot?.execute) {
            results.push({ name: action.name, ok: false, error: `Unknown tool "${action.name}".` });
            stopped = true;
            break;
          }

          let raw: unknown;
          try {
            raw = await slot.execute(action.input, subOpts as { toolCallId?: string } & Record<string, unknown>);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ name: action.name, ok: false, error: message });
            stopped = true;
            break;
          }

          let recordedOutput = raw;
          if (raw !== null && typeof raw === 'object' && '__doe_image' in raw) {
            const r = raw as Record<string, unknown>;
            const marker = r.__doe_image as { base64?: unknown; mediaType?: unknown } | undefined;
            if (
              marker &&
              typeof marker.base64 === 'string' &&
              typeof marker.mediaType === 'string'
            ) {
              images.push({
                base64: marker.base64,
                mediaType: marker.mediaType,
                label: `actions[${i}] ${action.name}`,
              });
            }
            const stripped: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) {
              if (k === '__doe_image' || k === 'base64Image') continue;
              stripped[k] = v;
            }
            recordedOutput = stripped;
          }

          const isError =
            recordedOutput !== null &&
            typeof recordedOutput === 'object' &&
            'error' in (recordedOutput as Record<string, unknown>);
          results.push({ name: action.name, ok: !isError, output: recordedOutput });
          if (isError) {
            stopped = true;
            break;
          }
        }

        const ranCount = results.filter(r => r.ok).length;
        const summary = stopped
          ? `Ran ${ranCount}/${params.actions.length} actions; stopped on error in actions[${results.length - 1}].`
          : `Ran ${ranCount}/${params.actions.length} actions.`;

        const out: Record<string, unknown> = {
          ok: !stopped,
          summary,
          actions: results,
        };
        if (images.length > 0) {
          out.__doe_batch_images = images;
        }
        return out;
      },
      // Multi-image content shaping. Mirrors `computer`'s screenshot hook
      // but for an arbitrary number of images. The marker is stripped from
      // the JSON metadata and each image rides on its own `image-data`
      // part so every vision-capable provider SEES every screenshot taken
      // during the batch.
      toModelOutput: ({ output }) => {
        if (
          output !== null &&
          typeof output === 'object' &&
          '__doe_batch_images' in (output as Record<string, unknown>)
        ) {
          const r = output as Record<string, unknown>;
          const images = r.__doe_batch_images as BatchImage[];
          const meta: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) {
            if (k === '__doe_batch_images') continue;
            meta[k] = v;
          }
          const parts: Array<
            | { type: 'text'; text: string }
            | { type: 'image-data'; data: string; mediaType: string }
          > = [{ type: 'text', text: JSON.stringify(meta) }];
          for (const img of images) {
            parts.push({ type: 'text', text: `[${img.label}]` });
            parts.push({ type: 'image-data', data: img.base64, mediaType: img.mediaType });
          }
          return { type: 'content', value: parts };
        }
        return { type: 'json', value: output as never };
      },
    }),
  };
}
