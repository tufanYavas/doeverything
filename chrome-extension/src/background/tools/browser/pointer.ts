import { getKeyDefinition } from '../../cdp/key-definitions.js';
import { PermissionDeniedError } from '../../permissions/manager.js';
import { captureFrameIfRecording } from '../internal/gif-store.js';
import {
  applyCoordScale,
  gateOnHost,
  scrollRefIntoView,
  screenshotContextStore,
} from '../internal/helpers.js';
import { processScreenshotForLLM, AGENT_SCREENSHOT_RESIZE } from '@doeverything/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function pointerTools(ctx: AgentToolContext) {
  return {
    computer: tool({
      description: `Drives mouse and keyboard on a tab. Each call performs exactly ONE action (one click, one key chord, one type, one screenshot, one wait). When you can predict two or more steps ahead (\`left_click → screenshot\`, \`triple_click → type → key:Enter\`, \`scroll → screenshot\`), wrap them inside \`multi_action\` instead of taking one turn per step — it's the same actions in ONE round trip.
- Clicks (\`left_click\`/\`right_click\`/\`double_click\`/\`triple_click\`/\`hover\`): \`ref\` (\`[N]\` from \`read_page\`) or \`coordinate\`; optional \`modifiers\`.
- \`left_click_drag\`: \`start_coordinate\` + \`end_coordinate\`.
- \`key\`: space-separated chords in \`text\`, optional \`repeat\`. Reload chords route through \`chrome.tabs.reload\`.
- \`type\`: types \`text\` at focus — for form fields prefer \`input\`.
- \`screenshot\`: capture viewport — vision-capable models SEE the image directly as a content block, not as text. Use for visual UI inspection (modals, error banners, layout, charts) where \`read_page\` text isn't enough. Returns an \`imageId\` you can pass to \`upload_image\` to drop the same bytes into a file input. Optionally pass \`quality\` (1–70, default 10) to trade off image size vs. detail — increase it when text or fine UI elements are unreadable.
- \`wait\`: sleep \`duration\` seconds (0.1–30).`,
      inputSchema: z.object({
        action: z.enum([
          'left_click',
          'right_click',
          'double_click',
          'triple_click',
          'left_click_drag',
          'hover',
          'key',
          'type',
          'screenshot',
          'wait',
        ]),
        // NOTE: Gemini's function-calling schema rejects Zod tuples — they
        // serialise as `items: [type1, type2]` which Gemini's protobuf does
        // not accept. Object form is portable across every supported LLM
        // and reads more naturally for the agent.
        coordinate: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe(
            'Click target (x, y) read directly off the LAST `screenshot` you captured — same pixel grid as the image you SEE. Do NOT pre-scale, multiply by DPR, or translate to viewport coords; the tool maps screenshot→viewport automatically. Mutually exclusive with `ref`.',
          ),
        start_coordinate: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe('Drag origin in the screenshot pixel grid (same space as `coordinate`). Used by `left_click_drag`.'),
        end_coordinate: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe('Drag destination in the screenshot pixel grid (same space as `coordinate`). Used by `left_click_drag`.'),
        text: z
          .string()
          .optional()
          .describe(
            'For `key`: space-separated chord(s) like `"Backspace"`, `"ctrl+a"`, `"Backspace Delete"`. For `type`: literal text to type at the focused element.',
          ),
        ref: z
          .string()
          .optional()
          .describe('Element `[N]` index from `read_page` for click/hover actions. Mutually exclusive with `coordinate`.'),
        repeat: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe('How many times to repeat the key sequence (`key` action only). Default 1.'),
        modifiers: z.string().optional().describe('Modifier keys for click actions (e.g. `"ctrl+shift"`, `"cmd+alt"`).'),
        duration: z
          .number()
          .min(0.1)
          .max(30)
          .optional()
          .describe('Wait duration in SECONDS (0.1–30). Used by `action: "wait"`. Default 1.'),
        quality: z
          .coerce.number()
          .min(1)
          .max(70)
          .optional()
          .describe('Screenshot quality 1–70 (default 10). Higher = more detail but larger image. Increase when text or fine UI elements are unreadable.'),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async params => {
        // Defensive wrapper. The single hardest failure mode of an agent
        // tool is to throw OR return `undefined` — the AI SDK then ships a
        // bare `tool_use` block to Anthropic without a matching
        // `tool_result`, and the NEXT turn rejects with:
        //   `tool_use ids were found without tool_result blocks
        //    immediately after`
        // (the whole conversation is then bricked until the orphan is
        // dropped). Guarantee a result on every code path: catch every
        // throw, supply a fallback for unmatched switch cases.
        try {
        const tabId = await ctx.getEffectiveTabId(params.tabId);

        // Modifier parsing for click actions ("ctrl+shift" → ['Ctrl','Shift']).
        const parseModifiers = (raw?: string): Array<'Alt' | 'Ctrl' | 'Meta' | 'Shift'> =>
          (raw ?? '')
            .split('+')
            .map(p => p.trim().toLowerCase())
            .filter(Boolean)
            .map(p => {
              if (p === 'ctrl' || p === 'control') return 'Ctrl';
              if (p === 'alt' || p === 'option') return 'Alt';
              if (p === 'cmd' || p === 'meta' || p === 'command' || p === 'win' || p === 'windows') return 'Meta';
              return 'Shift';
            }) as Array<'Alt' | 'Ctrl' | 'Meta' | 'Shift'>;

        // Resolve target coordinates: ref first, then explicit coordinate.
        // `ref` returns DOM-resolved viewport CSS pixels (already correct
        // space); `coordinate` arrives in screenshot pixel space and must
        // be inverse-scaled to viewport CSS pixels here, since the LLM
        // measured it against the OPTIMISED (downscaled) screenshot.
        const resolveTarget = async (): Promise<
          { x: number; y: number; via: 'ref' | 'coordinate' } | { error: string }
        > => {
          if (params.ref) {
            const r = await scrollRefIntoView(tabId, params.ref);
            if (!r.ok) return { error: r.error };
            return { x: r.x, y: r.y, via: 'ref' };
          }
          if (params.coordinate) {
            const scaled = await applyCoordScale(tabId, params.coordinate);
            return { x: scaled.x, y: scaled.y, via: 'coordinate' };
          }
          return { error: '`ref` or `coordinate` is required.' };
        };

        switch (params.action) {
          case 'left_click':
          case 'right_click':
          case 'double_click':
          case 'triple_click': {
            //   - `ref` → DOM-resolved viewport CSS px center via
            //     `scrollRefIntoView`.
            //   - `coordinate` → model gives screenshot pixel coords, mapped
            //     to viewport via `applyCoordScale`.
            const target = await resolveTarget();
            if ('error' in target) return { ok: false, error: target.error };
            const { x, y, via } = target;
            const button = params.action === 'right_click' ? 'right' : 'left';
            const clickCount = params.action === 'triple_click' ? 3 : params.action === 'double_click' ? 2 : 1;
            // Echo INPUT coords, not the scaled viewport coords — showing
            // scaled values tricks the model into pre-scale compensation.
            const inputLabel = params.coordinate
              ? `(${Math.round(params.coordinate.x)}, ${Math.round(params.coordinate.y)})`
              : '';
            try {
              await gateOnHost(ctx, tabId, 'click', {
                reason: 'Click',
                preview:
                  via === 'ref'
                    ? `${params.action} on element ${params.ref}`
                    : `${params.action} at ${inputLabel}`,
                toolName: 'computer',
              });
            } catch (err) {
              if (err instanceof PermissionDeniedError) return { ok: false, error: 'Denied by user' };
              throw err;
            }
            await ctx.cdp.clickAt(tabId, x, y, {
              button,
              clickCount,
              modifiers: parseModifiers(params.modifiers),
            });
            const label = clickCount === 3 ? 'Triple-clicked' : clickCount === 2 ? 'Double-clicked' : 'Clicked';
            await captureFrameIfRecording(ctx, tabId, params.action);
            return {
              ok: true,
              output:
                via === 'ref'
                  ? `${label} on element ${params.ref}`
                  : `${label} at ${inputLabel}`,
            };
          }
          case 'hover': {
            // mouseMoved to mapped viewport coords; output echoes INPUT coords.
            const target = await resolveTarget();
            if ('error' in target) return { ok: false, error: target.error };
            await ctx.cdp.moveCursor(tabId, target.x, target.y);
            await captureFrameIfRecording(ctx, tabId, 'hover');
            return {
              ok: true,
              output:
                target.via === 'ref'
                  ? `Hovered over element ${params.ref}`
                  : `Hovered at (${Math.round(params.coordinate!.x)}, ${Math.round(params.coordinate!.y)})`,
            };
          }
          case 'left_click_drag': {
            if (!params.start_coordinate || !params.end_coordinate)
              return { ok: false, error: 'start_coordinate + end_coordinate required' };
            // Map both endpoints from screenshot space → viewport CSS px.
            const start = await applyCoordScale(tabId, params.start_coordinate);
            const end = await applyCoordScale(tabId, params.end_coordinate);
            const startLabel = `(${Math.round(params.start_coordinate.x)}, ${Math.round(params.start_coordinate.y)})`;
            const endLabel = `(${Math.round(params.end_coordinate.x)}, ${Math.round(params.end_coordinate.y)})`;
            try {
              await gateOnHost(ctx, tabId, 'click', {
                reason: 'Drag',
                preview: `${startLabel} → ${endLabel}`,
                toolName: 'computer',
              });
            } catch (err) {
              if (err instanceof PermissionDeniedError) return { ok: false, error: 'Denied by user' };
              throw err;
            }
            await ctx.cdp.dragFromTo(tabId, start, end);
            await captureFrameIfRecording(ctx, tabId, 'left_click_drag');
            // Echo INPUT coords (not scaled viewport) — prevents the model
            // from entering a pre-scale compensation loop.
            return {
              ok: true,
              output: `Dragged from ${startLabel} to ${endLabel}`,
            };
          }
          case 'key': {
            if (!params.text) return { ok: false, error: 'text required' };
            const repeat = Math.max(1, Math.min(100, Math.floor(params.repeat ?? 1)));
            const keyInputs = params.text.trim().split(/\s+/).filter(Boolean);
            // Browser-use parity: single-shortcut reload keys go through
            // chrome.tabs.reload so the page does a real navigation instead
            // of trying to dispatch the chord at the focused element.
            if (keyInputs.length === 1) {
              const k = keyInputs[0].toLowerCase();
              const RELOAD_KEYS = new Set([
                'cmd+r',
                'cmd+shift+r',
                'ctrl+r',
                'ctrl+shift+r',
                'f5',
                'ctrl+f5',
                'shift+f5',
              ]);
              if (RELOAD_KEYS.has(k)) {
                const hardReload = k === 'cmd+shift+r' || k === 'ctrl+shift+r' || k === 'ctrl+f5' || k === 'shift+f5';
                await chrome.tabs.reload(tabId, { bypassCache: hardReload });
                await captureFrameIfRecording(ctx, tabId, 'navigate');
                return {
                  ok: true,
                  output: `Executed ${keyInputs[0]} (${hardReload ? 'hard reload' : 'reload'} page)`,
                };
              }
            }
            // Chord vs single-key are dispatched on separate paths.
            //   - Chord (contains `+`): full `pressKeyChord` — parses
            //     modifiers, applies Mac NSEvent commands when running on
            //     macOS so AppKit editors react to `cmd+a`/`cmd+z` etc.
            //   - Single key: `pressKey` directly when the keymap knows it
            //     (`Backspace`, `Enter`, `a`-`z`, `0`-`9`, F-keys, …),
            //     otherwise fall back to `insertText` so multi-char tokens
            //     (`"hello"`) still land as literal text instead of erroring.
            for (let r = 0; r < repeat; r++) {
              for (const k of keyInputs) {
                if (k.includes('+')) {
                  await ctx.cdp.pressKeyChord(tabId, k);
                } else {
                  const def = getKeyDefinition(k);
                  if (def) {
                    await ctx.cdp.pressKey(tabId, k);
                  } else {
                    await ctx.cdp.insertText(tabId, k);
                  }
                }
              }
            }
            await captureFrameIfRecording(ctx, tabId, 'key');
            return {
              ok: true,
              output: `Pressed ${keyInputs.length} key${keyInputs.length === 1 ? '' : 's'}: ${keyInputs.join(' ')}${repeat > 1 ? ` (×${repeat})` : ''}`,
            };
          }
          case 'type': {
            if (!params.text) return { ok: false, error: 'text required' };
            try {
              await gateOnHost(ctx, tabId, 'type', {
                reason: 'Type text',
                preview: params.text.slice(0, 60),
                toolName: 'computer',
              });
            } catch (err) {
              if (err instanceof PermissionDeniedError) return { ok: false, error: 'Denied by user' };
              throw err;
            }
            await ctx.cdp.typeText(tabId, params.text);
            await captureFrameIfRecording(ctx, tabId, 'type');
            return {
              ok: true,
              output: `Typed "${params.text.slice(0, 60)}"`,
            };
          }
          case 'screenshot': {
            const {
              base64: rawBase64,
              format: rawFormat,
              viewportWidth,
              viewportHeight,
              devicePixelRatio,
            } = await ctx.cdp.screenshot(tabId, {
              format: 'jpeg',
              quality: 75,
            });
            const processed = await processScreenshotForLLM({
              rawBase64,
              rawMediaType: `image/${rawFormat}`,
              viewportWidth,
              viewportHeight,
              devicePixelRatio,
              quality: (params.quality ?? 10) / 100,
              resizeParams: AGENT_SCREENSHOT_RESIZE,
            });
            // Record (viewport ↔ screenshot) mapping for coordinate translation.
            screenshotContextStore.setContext(tabId, {
              viewportWidth: processed.viewportWidth,
              viewportHeight: processed.viewportHeight,
              screenshotWidth: processed.width,
              screenshotHeight: processed.height,
            });

            const imageId = `ss_${Date.now().toString().slice(-4)}${Math.random().toString(36).slice(2, 7)}`;
            const G = globalThis as unknown as {
              __doe_screenshots?: Map<string, { base64: string; mime: string }>;
            };
            if (!G.__doe_screenshots) G.__doe_screenshots = new Map();
            // Cache the FINAL JPEG (post-resize) for `upload_image`. File
            // inputs typically `accept="image/jpeg"` so the resized JPEG
            // is the safest payload to re-upload.
            G.__doe_screenshots.set(imageId, {
              base64: processed.base64,
              mime: 'image/webp',
            });
            if (G.__doe_screenshots.size > 30) {
              const firstKey = G.__doe_screenshots.keys().next().value;
              if (firstKey !== undefined) G.__doe_screenshots.delete(firstKey);
            }
            // Recorder wants the raw (device-px) frame, not the LLM crop —
            // so a GIF replays at the same fidelity the user sees.
            await captureFrameIfRecording(ctx, tabId, 'screenshot', rawBase64);

            // The `__doe_image` marker is consumed by TWO paths:
            //   - LIVE turn: the `toModelOutput` hook on this tool (below)
            //     emits a Vercel AI SDK `content` output (text +
            //     image-data parts) so vision-capable models actually SEE
            //     the screenshot.
            //   - HISTORY rehydration: `agent/conversion.ts` re-applies
            //     the same transform when persisted history is replayed.
            // The marker is stripped from the JSON envelope before reaching
            // the model, so non-vision providers see only the metadata.
            // Result-compressor opts out of bucketing when this marker is
            // present (the image bytes must reach both paths intact).

            // IMPORTANT: do NOT include a `base64Image` field on the JSON
            // envelope. The image already rides on the `__doe_image` marker —
            // adding `base64Image` ships the
            // same ~100 KB payload TWICE (once as JSON-stringified text,
            // once as `image-data`). That doubled tool_result can exceed
            // Anthropic's per-message size envelope and get dropped server
            // side, leaving the `tool_use` orphaned → the very error
            // `tool_use ids were found without tool_result blocks`.
            return {
              ok: true,
              output: `Successfully captured screenshot (${processed.width}x${processed.height}, ${processed.format}) - ID: ${imageId}`,
              imageId,
              imageFormat: processed.format,
              imageWidth: processed.width,
              imageHeight: processed.height,
              __doe_image: { base64: processed.base64, mediaType: 'image/webp' },
            };
          }
          case 'wait': {
            const seconds = Math.min(30, Math.max(0.1, params.duration ?? 1));
            await new Promise(r => setTimeout(r, Math.round(seconds * 1000)));
            return { ok: true, output: `Waited ${seconds}s` };
          }
        }
        // Unreachable: Zod gates `action` to the enum and every case
        // above `return`s. TypeScript proves this — so no explicit
        // fallback needed.
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: msg };
        }
      },
      // Live tool-result content shaping. When `execute` returns a result
      // carrying the `__doe_image` marker (the `screenshot` action),
      // emit a `content` ToolResultOutput with the bytes as an
      // `image-data` part so vision-capable models actually SEE the
      // screenshot — not a base64 string field inside the JSON envelope.
      //
      // Critical: without this hook the AI SDK falls back to its default
      // behaviour and JSON-serialises the whole execute result. That ships
      // the ~100 KB base64 as a text field in `functionResponse.content`
      // (Gemini) / `tool_result.content` (Anthropic). Vision never
      // activates and the model wastes tokens scanning the base64 prefix.
      //
      // The chat-store hydration path (`conversion.ts`) does the same
      // strip when re-converting persisted history into ModelMessages, so
      // follow-up turns also see the image as a proper media part.
      toModelOutput: ({ output }) => {
        if (
          output !== null &&
          typeof output === 'object' &&
          '__doe_image' in output
        ) {
          const r = output as Record<string, unknown>;
          const marker = r.__doe_image as { base64?: unknown; mediaType?: unknown } | undefined;
          if (
            marker &&
            typeof marker.base64 === 'string' &&
            typeof marker.mediaType === 'string'
          ) {
            // Strip the marker AND any legacy / accidental `base64Image`
            // field. The image is already going down the `image-data`
            // part below; leaving the raw base64 in the metadata text
            // would ship ~100 KB twice in one tool_result and trip
            // Anthropic's per-message size cap, causing the server to
            // drop the result → orphan `tool_use` → next turn rejects
            // with `tool_use ids were found without tool_result blocks`.
            const meta: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) {
              if (k === '__doe_image' || k === 'base64Image') continue;
              meta[k] = v;
            }
            return {
              type: 'content',
              value: [
                { type: 'text', text: JSON.stringify(meta) },
                { type: 'image-data', data: marker.base64, mediaType: marker.mediaType },
              ],
            };
          }
        }
        // Non-screenshot actions fall through to the SDK default
        // (JSON-serialised). Returning `{ type: 'json', value: output }`
        // explicitly keeps the wire shape stable and lets us narrow the
        // type back from `any`.
        return { type: 'json', value: output as never };
      },
    }),

    scroll: tool({
      description:
        'Scrolls a tab by viewport pages (`pages: 0.5` = half, `1` = full, `10` ≈ to bottom). `down: false` reverses. Pass `index` = `[N]` of a `|SCROLL|` container/iframe from `read_page` to scroll inside it; omit or `0` for whole page.',
      inputSchema: z.object({
        down: z.boolean().optional().describe('true (default) = scroll down, false = scroll up.'),
        pages: z.number().min(0.1).max(20).optional().describe('Viewport pages to scroll. Default 1.'),
        index: z
          .number()
          .optional()
          .describe('Element [N] index to scroll within (e.g. a scroll container). 0 or omitted = whole page.'),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async ({ down, pages, index, tabId: requestedTabId }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const goDown = down !== false;
        const pageCount = typeof pages === 'number' ? pages : 1;
        const refId = typeof index === 'number' && index !== 0 ? index : null;

        // Read viewport height + element info in one round-trip.
        const probeArgs: [number | null] = [refId];
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: probeArgs,
          func: (id: number | null) => {
            const viewport = { width: window.innerWidth || 1280, height: window.innerHeight || 1000 };
            if (id === null) return { ok: true as const, viewport, kind: 'page' as const };
            const win = window as Window & { ___oadp?: { getElement: (n: number) => HTMLElement | null } };
            if (!win.___oadp?.getElement)
              return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
            const el = win.___oadp.getElement(id);
            if (!el) return { ok: false as const, error: `No element for ref [${id}].` };
            const isIframe = el.tagName.toUpperCase() === 'IFRAME';
            if (isIframe) return { ok: true as const, viewport, kind: 'iframe' as const };
            const rect = el.getBoundingClientRect();
            return {
              ok: true as const,
              viewport,
              kind: 'element' as const,
              centerX: rect.left + rect.width / 2,
              centerY: rect.top + rect.height / 2,
            };
          },
        });
        const info = probe?.result;
        if (!info?.ok) return { ok: false, error: info?.error ?? 'Failed to probe viewport' };

        const direction = goDown ? 1 : -1;
        const totalPx = Math.round(info.viewport.height * pageCount) * direction;

        const SETTLE_MS = 150;
        const fullPages = Math.floor(pageCount);
        const fractional = pageCount - fullPages;
        const stepPx = info.viewport.height * direction;
        const fractionalPx = Math.round(fractional * info.viewport.height) * direction;

        const scrollOnce = async (delta: number): Promise<boolean> => {
          if (info.kind === 'iframe' && refId !== null) {
            const args: [number, number] = [refId, delta];
            const [r] = await chrome.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              args,
              func: (id: number, px: number) => {
                const win = window as Window & {
                  ___oadp?: { getElement: (n: number) => HTMLElement | null };
                };
                const el = win.___oadp?.getElement(id) as HTMLIFrameElement | null;
                if (!el) return false;
                try {
                  const doc = el.contentDocument || el.contentWindow?.document;
                  if (!doc) return false;
                  const target = (doc.documentElement || doc.body) as HTMLElement;
                  const before = target.scrollTop;
                  target.scrollTop += px;
                  return target.scrollTop !== before;
                } catch {
                  return false;
                }
              },
            });
            return r?.result === true;
          }
          if (info.kind === 'element' && typeof info.centerX === 'number' && typeof info.centerY === 'number') {
            try {
              await ctx.cdp.send(tabId, 'Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                x: info.centerX,
                y: info.centerY,
                deltaX: 0,
                deltaY: delta,
              });
              return true;
            } catch {
              /* fall through to page scroll */
            }
          }
          // Whole-page scroll: synthesizeScrollGesture is more realistic than
          // window.scrollBy because it triggers wheel listeners.
          try {
            await ctx.cdp.send(tabId, 'Input.synthesizeScrollGesture', {
              x: Math.round(info.viewport.width / 2),
              y: Math.round(info.viewport.height / 2),
              xDistance: 0,
              yDistance: -delta, // synthesize uses opposite sign
              speed: 50_000,
            });
            return true;
          } catch {
            await chrome.scripting.executeScript({
              target: { tabId },
              args: [delta],
              func: (px: number) => window.scrollBy({ top: px, behavior: 'auto' }),
            });
            return true;
          }
        };

        let completed = 0;
        if (pageCount >= 1) {
          for (let i = 0; i < fullPages; i++) {
            const ok = await scrollOnce(stepPx);
            if (ok) completed += 1;
            await new Promise(r => setTimeout(r, SETTLE_MS));
          }
          if (fractional > 0) {
            const ok = await scrollOnce(fractionalPx);
            if (ok) completed += fractional;
          }
        } else {
          await scrollOnce(totalPx);
          completed = pageCount;
        }

        const where = refId !== null ? `element [${refId}]` : 'page';
        const dirLabel = goDown ? 'down' : 'up';
        await captureFrameIfRecording(ctx, tabId, 'scroll');
        return {
          ok: true,
          output: `Scrolled ${dirLabel} ${completed.toFixed(1)} page${completed === 1 ? '' : 's'} on ${where}`,
        };
      },
    }),
  };
}
