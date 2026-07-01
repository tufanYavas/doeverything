/**
 * Lazy create the doeverything offscreen document and round-trip a typed message.
 *
 * Chrome only allows a single offscreen doc per extension; we reuse it for
 * every reason we need (audio, blobs/GIF, workers).
 */

const OFFSCREEN_PATH = 'offscreen/index.html';

async function hasOffscreenDocument(): Promise<boolean> {
  // chrome.offscreen.hasDocument() is the official API but only on recent Chrome;
  // the manifest gates us at 116+, so it's available.
  if (typeof chrome.offscreen?.hasDocument === 'function') {
    return chrome.offscreen.hasDocument();
  }
  // Fallback: walk extension contexts.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  return contexts.length > 0;
}

export async function ensureOffscreenDocument(
  reasons: chrome.offscreen.Reason[] = ['BLOBS' as chrome.offscreen.Reason],
): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_PATH),
    reasons,
    justification: 'doeverything: GIF encoding and audio playback for workflow recordings',
  });
}

export async function callOffscreen<T = unknown>(payload: { type: string; payload?: unknown }): Promise<T> {
  await ensureOffscreenDocument();
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response: { ok?: boolean; error?: string } & T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? 'Offscreen returned !ok'));
        return;
      }
      resolve(response);
    });
  });
}
