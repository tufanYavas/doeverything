/**
 * doeverything offscreen document.
 *
 * Service-worker accessible reasons:
 *   - AUDIO_PLAYBACK     → notification sounds
 *   - BLOBS              → GIF encoding (Phase 9 / browser-tools `gif_creator`)
 *   - WORKERS            → SW keepalive
 *
 * Message types we accept (from the SW):
 *   - de/offscreen/ping
 *   - de/offscreen/play-sound          { url }
 *   - de/offscreen/encode-gif          { frames, frameDelay, width, height }
 *
 * GIF encoding uses `gifenc` (tiny, no separate worker file): each frame is
 * decoded to an ImageBitmap, drawn onto an OffscreenCanvas, quantised per
 * frame to a 256-colour palette, and written as an animated GIF89a. (A
 * previous hand-rolled LZW encoder produced corrupt output, so this delegates
 * to a vetted library instead.)
 */

import { applyPalette, GIFEncoder, quantize } from 'gifenc';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  const msg = message as { type?: string; payload?: unknown } | null;
  switch (msg?.type) {
    case 'doe/offscreen/ping':
      sendResponse({ ok: true, alive: true });
      return false;

    case 'doe/offscreen/play-sound': {
      const url = (msg.payload as { url?: string } | undefined)?.url;
      if (typeof url === 'string') {
        const audio = new Audio(url);
        audio.play().catch(err => console.warn('[doeverything] audio play failed', err));
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'doe/offscreen/encode-gif': {
      const payload = msg.payload as
        | {
            frames: string[];
            frameDelay?: number;
            width?: number;
            height?: number;
          }
        | undefined;
      if (!payload?.frames?.length) {
        sendResponse({ ok: false, error: 'No frames' });
        return false;
      }
      void encodeGif(payload.frames, payload.frameDelay ?? 800, payload.width, payload.height)
        .then(dataUrl => sendResponse({ ok: true, dataUrl }))
        .catch(err => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    }

    default:
      return false;
  }
});

/**
 * Encode the captured frames into an animated GIF89a with `gifenc`. Each frame
 * is decoded, normalised to the first frame's dimensions on an OffscreenCanvas,
 * quantised to 256 colours, and written with the given per-frame delay.
 */
async function encodeGif(frames: string[], frameDelay: number, width?: number, height?: number): Promise<string> {
  const images = await Promise.all(frames.map(loadImage));
  if (images.length === 0) throw new Error('No frames to encode');
  const W = width ?? images[0].width;
  const H = height ?? images[0].height;

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D context for GIF encoding');

  const gif = GIFEncoder();
  for (const img of images) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    // delay is in ms; repeat: 0 loops forever (gifenc writes the loop ext once).
    gif.writeFrame(index, W, H, { palette, delay: frameDelay, repeat: 0 });
  }
  gif.finish();
  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  return blobToDataUrl(blob);
}

/**
 * Strip a `data:<mime>;base64,` prefix if present, returning the bare base64.
 * Frames from Chrome's `Page.captureScreenshot` arrive as RAW base64 (no
 * prefix); callers that hand us a data URL are tolerated too.
 */
export function base64FromFrame(frame: string): string {
  return frame.startsWith('data:') ? frame.slice(frame.indexOf(',') + 1) : frame;
}

function loadImage(frame: string): Promise<ImageBitmap> {
  // Decode the bytes ourselves rather than `fetch()`-ing the string: a bare
  // base64 frame (the common case) is not a URL, so `fetch` rejects with
  // "Failed to fetch". `createImageBitmap` sniffs the actual format from the
  // bytes, so JPEG/PNG/etc. all decode regardless of the Blob's declared type.
  const binary = atob(base64FromFrame(frame));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes]));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
