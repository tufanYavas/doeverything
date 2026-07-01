import { callOffscreen, ensureOffscreenDocument } from '../../offscreen.js';
import { PermissionDeniedError } from '../../permissions/manager.js';
import { getGifStore } from '../internal/gif-store.js';
import { applyCoordScale, gateOnHost } from '../internal/helpers.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';
import type { GifFrame } from '../internal/gif-store.js';

export function captureTools(ctx: AgentToolContext) {
  return {
    gif_creator: tool({
      description: `Records browser activity in the doeverything group as an animated GIF.
- \`start_recording\`: begins auto-capture (50-frame cap, clears prior).
- \`stop_recording\`: halts; keeps frames.
- \`export\`: encodes + drops at \`coordinate\` or downloads (\`download: true\`). Optional \`filename\`, \`frame_delay\`.
- \`clear\`: discards frames.

Pass \`frames\` (base64 array) inline to bypass auto-capture.`,
      inputSchema: z.object({
        action: z
          .enum(['start_recording', 'stop_recording', 'export', 'clear'])
          .describe(
            "'start_recording' begins capturing, 'stop_recording' stops but keeps frames, 'export' generates and exports the GIF, 'clear' discards frames.",
          ),
        tabId: z.number().optional().describe('Tab ID to scope the operation.'),
        coordinate: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe(
            'Drop target (x, y) read off the LAST `computer.screenshot` — same pixel grid as the image you SEE. Tool maps screenshot→viewport automatically; do not pre-scale. Required for export unless `download: true`.',
          ),
        download: z.boolean().optional().describe('If true, download the GIF instead of drag/drop upload.'),
        filename: z.string().optional().describe('Output filename for the GIF (default: `recording-<timestamp>.gif`).'),
        // Manual frame push (used when no auto-capture hooks are wired yet).
        frames: z
          .array(z.string())
          .optional()
          .describe('Base64-encoded JPEG/PNG frames to inline-encode (when auto-capture is not active).'),
        frame_delay: z
          .number()
          .min(50)
          .max(5000)
          .optional()
          .describe('Delay between frames in MILLISECONDS (50–5000). Default: averaged from auto-captured frames, ~800.'),
      }),
      execute: async ({ action, tabId: requestedTabId, coordinate, download, filename, frames, frame_delay }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const groupId = ctx.groups.getGroupId() ?? -1;
        const store = getGifStore();

        switch (action) {
          case 'start_recording': {
            if (store.recording.has(groupId)) {
              return {
                output:
                  "Recording is already active for this tab group. Use 'stop_recording' to stop or 'export' to generate GIF.",
              };
            }
            store.recording.add(groupId);
            store.frames.set(groupId, []);
            return {
              output:
                'Started recording browser actions for this tab group. All computer / scroll / navigate tool calls will now be captured (max 50 frames). Previous frames cleared.',
            };
          }
          case 'stop_recording': {
            if (!store.recording.has(groupId)) {
              return { output: "Recording is not active for this tab group. Use 'start_recording' to begin." };
            }
            store.recording.delete(groupId);
            const count = store.frames.get(groupId)?.length ?? 0;
            return {
              output: `Stopped recording for this tab group. Captured ${count} frame${count === 1 ? '' : 's'}. Use 'export' to generate GIF or 'clear' to discard.`,
            };
          }
          case 'clear': {
            const count = store.frames.get(groupId)?.length ?? 0;
            store.recording.delete(groupId);
            store.frames.delete(groupId);
            return { output: `Cleared ${count} frame${count === 1 ? '' : 's'} for this tab group. Recording stopped.` };
          }
          case 'export': {
            const buffered = store.frames.get(groupId) ?? [];
            // The agent can pass `frames` (array of base64 strings) inline as an
            // override; otherwise we use the auto-captured buffer.
            const useFrames: GifFrame[] =
              frames && frames.length > 0 ? frames.map(b => ({ base64: b, delay: frame_delay ?? 800 })) : buffered;
            if (useFrames.length === 0) {
              return {
                error:
                  "No frames recorded for this tab group. Use 'start_recording' and perform browser actions first, or pass `frames` directly.",
              };
            }
            const wantDownload = download === true;
            if (!wantDownload && !coordinate) {
              return { error: 'coordinate is required for export action (or set download: true)' };
            }
            await ensureOffscreenDocument(['BLOBS' as chrome.offscreen.Reason]);
            // Average per-frame delay across the buffer, or honour `frame_delay`
            // override. The doeverything offscreen encoder takes a single delay.
            const avgDelay =
              frame_delay ?? Math.max(50, Math.round(useFrames.reduce((s, f) => s + f.delay, 0) / useFrames.length));
            let result: { dataUrl: string };
            try {
              result = (await callOffscreen<{ dataUrl: string }>({
                type: 'doe/offscreen/encode-gif',
                payload: { frames: useFrames.map(f => f.base64), frameDelay: avgDelay },
              })) as { dataUrl: string };
            } catch (err) {
              return { error: `GIF encoding failed: ${err instanceof Error ? err.message : String(err)}` };
            }
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const fname = filename ?? `recording-${ts}.gif`;
            if (wantDownload) {
              try {
                await chrome.downloads.download({ url: result.dataUrl, filename: fname, saveAs: false });
                store.frames.delete(groupId);
                return {
                  output: `Successfully exported GIF with ${useFrames.length} frames. Downloaded "${fname}". Recording cleared.`,
                };
              } catch (err) {
                return { error: `Download failed: ${err instanceof Error ? err.message : String(err)}` };
              }
            }
            // Drag-drop upload at coordinates.
            // The model gives the drop point in screenshot pixel space (the
            // grid it can READ); inverse-scale to viewport CSS px so
            // `document.elementFromPoint` lands on the actual drop zone.
            const m = result.dataUrl.match(/^data:image\/gif;base64,(.+)$/);
            if (!m) return { error: 'Invalid GIF data URL produced by encoder.' };
            const base64 = m[1];
            const dropPoint = await applyCoordScale(tabId, coordinate!);
            const dropArgs: [string, string, number, number] = [base64, fname, dropPoint.x, dropPoint.y];
            await chrome.scripting.executeScript({
              target: { tabId },
              args: dropArgs,
              func: (b64: string, fn: string, dx: number, dy: number) => {
                const bin = atob(b64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                const blob = new Blob([arr], { type: 'image/gif' });
                const file = new File([blob], fn, { type: 'image/gif', lastModified: Date.now() });
                const dt = new DataTransfer();
                dt.items.add(file);
                const target = document.elementFromPoint(dx, dy);
                if (!target) throw new Error(`No element at (${dx}, ${dy})`);
                for (const evt of ['dragenter', 'dragover', 'drop'] as const) {
                  target.dispatchEvent(
                    new DragEvent(evt, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dx, clientY: dy }),
                  );
                }
              },
            });
            store.frames.delete(groupId);
            return {
              // Echo the model's input coords back (screenshot pixel space)
              // so the model doesn't think its coord was rewritten.
              output: `Successfully exported GIF with ${useFrames.length} frames. Dropped "${fname}" at (${Math.round(coordinate!.x)}, ${Math.round(coordinate!.y)}). Recording cleared.`,
            };
          }
        }
      },
    }),

    upload_image: tool({
      description:
        'Inserts a screenshot (`imageId` from `computer.screenshot`) or inline `base64` into a page. Target a file input via `ref` (`[N]` from `read_page`) OR a drag-drop spot via `coordinate` — exactly one of the two.',
      inputSchema: z
        .object({
          imageId: z
            .string()
            .optional()
            .describe(
              "ID of a previously captured screenshot (from computer.screenshot's imageId field). Required unless `base64` is provided.",
            ),
          base64: z.string().optional().describe('Inline base64-encoded image data (alternative to imageId).'),
          mediaType: z.string().optional().describe('Media type for inline base64 image. Defaults to image/png.'),
          ref: z
            .string()
            .optional()
            .describe(
              'Element `[N]` index from `read_page`. Use for file inputs (especially hidden ones). Provide either `ref` or `coordinate`, not both.',
            ),
          coordinate: z
            .object({ x: z.number(), y: z.number() })
            .optional()
            .describe(
              'Drop target (x, y) read off the LAST `computer.screenshot` — same pixel grid as the image you SEE. Tool maps screenshot→viewport automatically; do not pre-scale. Provide either ref or coordinate, not both.',
            ),
          tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
          filename: z.string().optional().describe('Filename for the upload (default: "image.png").'),
        })
        .refine(v => !!v.imageId || !!v.base64, { message: 'Either imageId or base64 is required' })
        .refine(v => !!v.ref || !!v.coordinate, { message: 'Either ref or coordinate is required' })
        .refine(v => !(v.ref && v.coordinate), { message: 'Provide either ref or coordinate, not both' }),
      execute: async ({
        imageId,
        base64: inlineBase64,
        mediaType,
        ref,
        coordinate,
        tabId: requestedTabId,
        filename,
      }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        // Resolve the image data. If `imageId` was provided we look it up in
        // the per-process screenshot cache (populated by computer.screenshot).
        // Fall back to inline `base64`.
        let base64: string | undefined = inlineBase64;
        let mime = mediaType ?? 'image/png';
        if (!base64 && imageId) {
          const G = globalThis as unknown as { __doe_screenshots?: Map<string, { base64: string; mime: string }> };
          const hit = G.__doe_screenshots?.get(imageId);
          if (hit) {
            base64 = hit.base64;
            mime = hit.mime;
          } else {
            // In-memory cache miss — service worker may have been evicted.
            // Fall back to chrome.storage.local where screenshots are persisted.
            try {
              const stored = await chrome.storage.local.get(`__doe_ss_${imageId}`);
              const entry = stored[`__doe_ss_${imageId}`] as { base64: string; mime: string } | undefined;
              if (entry) {
                base64 = entry.base64;
                mime = entry.mime;
                // Repopulate in-memory cache for follow-up tool calls.
                if (!G.__doe_screenshots) G.__doe_screenshots = new Map();
                G.__doe_screenshots.set(imageId, entry);
              }
            } catch {
              /* non-fatal */
            }
          }
          if (!base64)
            return {
              error: `Image not found with ID: ${imageId}. Make sure you captured it earlier in this conversation via computer.screenshot.`,
            };
        }
        if (!base64) return { error: 'No image data available (provide imageId or base64).' };

        try {
          await gateOnHost(ctx, tabId, 'type', {
            reason: 'Upload an image',
            preview: filename ?? 'image.png',
            toolName: 'upload_image',
          });
        } catch (err) {
          if (err instanceof PermissionDeniedError) return { error: 'Denied by user' };
          throw err;
        }

        // Inverse-scale the model's drop coord from screenshot pixel space
        // to viewport CSS px before handing it to `elementFromPoint`. Same
        // mapping the click/drag paths apply — see `applyCoordScale` doc.
        const scaledCoord = coordinate ? await applyCoordScale(tabId, coordinate) : null;
        const args: [string | null, { x: number; y: number } | null, string, string, string] = [
          ref ?? null,
          scaledCoord,
          base64,
          filename ?? 'image.png',
          mime,
        ];
        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args,
          func: (
            elementRef: string | null,
            coord: { x: number; y: number } | null,
            data: string,
            fname: string,
            mtype: string,
          ) => {
            try {
              let target: Element | null = null;
              if (coord) {
                target = document.elementFromPoint(coord.x, coord.y);
                if (!target) return { error: `No element at (${coord.x}, ${coord.y})` };
                if (target.tagName === 'IFRAME') {
                  const iframe = target as HTMLIFrameElement;
                  try {
                    const idoc = iframe.contentDocument ?? iframe.contentWindow?.document;
                    if (idoc) {
                      const rect = iframe.getBoundingClientRect();
                      const inner = idoc.elementFromPoint(coord.x - rect.left, coord.y - rect.top);
                      if (inner) target = inner;
                    }
                  } catch {
                    /* cross-origin */
                  }
                }
              } else {
                if (!elementRef) return { error: 'Neither ref nor coordinate provided' };
                const win = window as Window & {
                  ___oadp?: { getElement: (id: number) => HTMLElement | null };
                };
                if (!win.___oadp?.getElement) return { error: 'DOM walker not present. Call read_page first.' };
                const id = parseInt(elementRef, 10);
                if (Number.isNaN(id)) return { error: `Invalid ref: "${elementRef}"` };
                target = win.___oadp.getElement(id);
                if (!target) return { error: `No element for ref [${id}].` };
              }
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const bin = atob(data);
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              const blob = new Blob([arr], { type: mtype });
              const file = new File([blob], fname, { type: mtype, lastModified: Date.now() });
              const dt = new DataTransfer();
              dt.items.add(file);

              if (target instanceof HTMLInputElement && target.type === 'file') {
                target.files = dt.files;
                target.focus();
                target.dispatchEvent(new Event('change', { bubbles: true }));
                target.dispatchEvent(new Event('input', { bubbles: true }));
                return {
                  output: `Successfully uploaded image "${fname}" (${Math.round(blob.size / 1024)}KB) to file input`,
                };
              }
              const dx = coord
                ? coord.x
                : (() => {
                    const r = (target as HTMLElement).getBoundingClientRect();
                    return r.left + r.width / 2;
                  })();
              const dy = coord
                ? coord.y
                : (() => {
                    const r = (target as HTMLElement).getBoundingClientRect();
                    return r.top + r.height / 2;
                  })();
              (target as HTMLElement).focus?.();
              for (const evt of ['dragenter', 'dragover', 'drop'] as const) {
                target.dispatchEvent(
                  new DragEvent(evt, {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt,
                    clientX: dx,
                    clientY: dy,
                  }),
                );
              }
              return {
                output: `Successfully dropped image "${fname}" (${Math.round(blob.size / 1024)}KB) onto element at (${Math.round(dx)}, ${Math.round(dy)})`,
              };
            } catch (err) {
              return { error: `Error uploading image: ${err instanceof Error ? err.message : String(err)}` };
            }
          },
        });
        if (!result) return { error: 'No result from page script' };
        const r = result as { error?: string; output?: string };
        if (r.error) return { error: r.error };
        // When the model picked a `coordinate`, echo its INPUT coords back —
        // not the inverse-scaled viewport coords the page-side script printed.
        // Same rationale as `pointer.ts` clicks: showing the scaled value
        // tricks the model into pre-scaling future drops.
        if (coordinate && r.output) {
          const inputLabel = `(${Math.round(coordinate.x)}, ${Math.round(coordinate.y)})`;
          const fixed = r.output.replace(/at \(\d+, \d+\)/, `at ${inputLabel}`);
          return { output: fixed };
        }
        return { output: r.output ?? '' };
      },
    }),
  };
}
