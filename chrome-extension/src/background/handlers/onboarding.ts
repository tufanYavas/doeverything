const QUEUE_KEY = 'doe:queued-prompt';

export async function queueOnboardingPrompt(prompt: string) {
  if (!prompt?.trim()) return;
  await chrome.storage.local.set({
    [QUEUE_KEY]: { prompt: prompt.trim(), createdAt: Date.now() },
  });
}

export async function openSidePanelForActiveWindow() {
  try {
    const window = await chrome.windows.getCurrent();
    if (window.id) await chrome.sidePanel.open({ windowId: window.id });
  } catch (err) {
    console.warn('[doeverything] could not open side panel automatically', err);
  }
}

export const ONBOARDING_QUEUE_KEY = QUEUE_KEY;
