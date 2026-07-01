/**
 * Side-panel ↔ recorder message bridge.
 *
 * Inbound messages:
 *   - de/recording/start    { name }
 *   - de/recording/stop
 *   - de/recording/snapshot { label? }
 *   - de/recording/replay   { id }
 *   - de/recorder/event     { action }   ← from in-page content script
 */

import { openSidePanelForActiveWindow, queueOnboardingPrompt } from './onboarding.js';
import { Recorder, recordingToPrompt } from '../recording/recorder.js';
import { recordingsStorage } from '@doeverything/storage';

export function registerRecordingHandlers() {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as {
      type?: string;
      name?: string;
      id?: string;
      label?: string;
      action?: { kind: string; data: Record<string, unknown> };
    } | null;
    if (!msg?.type) return false;
    if (!msg.type.startsWith('doe/recording/') && msg.type !== 'doe/recorder/event') return false;

    (async () => {
      switch (msg.type) {
        case 'doe/recorder/event': {
          if (sender.tab?.id && msg.action) {
            await Recorder.ingestEvent(msg.action, sender.tab.id);
          }
          sendResponse({ ok: true });
          return;
        }
        case 'doe/recording/start': {
          const recording = await Recorder.start(msg.name ?? '');
          sendResponse({ ok: true, id: recording.id });
          return;
        }
        case 'doe/recording/stop': {
          const recording = await Recorder.stop();
          sendResponse({ ok: true, recording });
          return;
        }
        case 'doe/recording/snapshot': {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab?.id) {
            await Recorder.snapshot(tab.id, msg.label);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'No active tab' });
          }
          return;
        }
        case 'doe/recording/replay': {
          const id = msg.id ?? '';
          const state = await recordingsStorage.get();
          const recording = state.recordings.find(r => r.id === id);
          if (!recording) {
            sendResponse({ ok: false, error: 'Recording not found' });
            return;
          }
          const prompt = recordingToPrompt(recording.actions, recording.narration);
          await queueOnboardingPrompt(prompt);
          await openSidePanelForActiveWindow();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message' });
      }
    })();
    return true;
  });
}
