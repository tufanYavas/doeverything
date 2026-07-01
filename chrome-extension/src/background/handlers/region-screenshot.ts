/**
 * Side-panel-triggered region screenshot.
 *
 * Flow when the user clicks the cropper button next to the paperclip in
 * the Composer:
 *   1. Side panel sends `doe/region-screenshot/start` to the SW.
 *   2. This handler asks `Selector.requestRegion(tabId)` to overlay the
 *      content-script picker on the active tab — same overlay the
 *      `select_region` agent tool uses, no new UI surface.
 *   3. User drags a rectangle (or hits Esc to cancel).
 *   4. SW captures the full visible viewport with
 *      `chrome.tabs.captureVisibleTab` and hands it to the shared
 *      `optimizeBlobForLLM(blob, { srcRect })` — that helper does the
 *      crop, resize-to-1568-long-edge, white-flatten, and WebP encode in
 *      one canvas pass.
 *   5. Returns `{ dataUrl, width, height, bytes }` to the side panel,
 *      which attaches it as a `Composer` chip.
 *
 * Why `chrome.tabs.captureVisibleTab` and not CDP `Page.captureScreenshot`:
 *   - CDP attach is owned by the agent's `AgentToolContext`. A side-
 *     panel-triggered capture must not depend on agent state (the agent
 *     might be idle, mid-flight, or attached to a different tab).
 *   - `captureVisibleTab` is a stable Chrome API, no debugger-banner
 *     side effect, no race against the agent.
 */

import { Selector } from './selector.js';
import { optimizeBlobForLLM } from '@doeverything/shared';

interface CaptureResponse {
  ok: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
}

export function registerRegionScreenshotHandler() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string } | null;
    if (msg?.type !== 'doe/region-screenshot/start') return false;
    void capture().then(sendResponse);
    return true; // signal async sendResponse
  });
}

async function capture(): Promise<CaptureResponse> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || tab.windowId == null) return { ok: false, error: 'No active tab' };

    // Prompt the user with the existing Selector overlay (same one
    // `select_region` uses). Resolves with `{ rect, devicePixelRatio }` or
    // a `cancelled: true` signal when the user hits Esc.
    const sel = await Selector.requestRegion(tab.id);
    if (sel.cancelled) return { ok: false, error: 'Cancelled by user' };
    if (!sel.rect) return { ok: false, error: 'Selector returned no rectangle' };

    // Source rectangle in DEVICE pixels (the captureVisibleTab output is
    // at device resolution, so the crop window scales by DPR).
    const dpr = sel.devicePixelRatio ?? 1;
    const srcRect = {
      x: Math.round(sel.rect.x * dpr),
      y: Math.round(sel.rect.y * dpr),
      width: Math.round(sel.rect.width * dpr),
      height: Math.round(sel.rect.height * dpr),
    };
    if (srcRect.width <= 0 || srcRect.height <= 0) return { ok: false, error: 'Region has zero area' };

    // Full visible viewport at device pixels (captureVisibleTab honours
    // the screen's DPR).
    const fullDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!fullDataUrl) return { ok: false, error: 'captureVisibleTab returned empty' };
    const fullBlob = await fetch(fullDataUrl).then(r => r.blob());

    // Crop to the user's selection + WebP-encode. The optimiser does
    // NOT resize — output dims equal `srcRect` dims (device pixels at
    // the time of capture). `maxBytes` keeps the encoded payload under
    // the per-image cap by walking quality, not by shrinking pixels.
    const opt = await optimizeBlobForLLM(fullBlob, {
      srcRect,
      maxBytes: 700_000,
    });
    return { ok: true, dataUrl: opt.dataUrl, width: opt.width, height: opt.height, bytes: opt.bytes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
