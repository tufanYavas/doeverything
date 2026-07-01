/**
 * doeverything in-page event recorder.
 *
 * The service worker's `Recorder` registers navigation + screenshot events
 * but it can't observe the user's clicks/typing without a content script.
 * This script lives on every page and listens passively; it forwards events
 * to the SW only while a recording is active.
 *
 * Activation: the SW publishes `doe:recording-active` on
 * `chrome.storage.local` when a recording starts and clears it on stop.
 * This script reads that flag at boot and via `chrome.storage.onChanged`.
 *
 * Captured events:
 *   - click       → coordinate (CSS px) + text label of the target
 *   - input/change → selector + redacted value snapshot
 *   - keydown for special keys (Enter/Tab/Esc/...)
 *   - scroll (debounced)
 */

const ACTIVE_KEY = 'doe:recording-active';

let active = false;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

function send(action: { kind: string; data: Record<string, unknown> }) {
  if (!active) return;
  chrome.runtime.sendMessage({ type: 'doe/recorder/event', action }).catch(() => {
    // SW unavailable or recording stopped between the user's gesture and
    // our send — silent.
  });
}

function refreshActive() {
  chrome.storage.local
    .get(ACTIVE_KEY)
    .then(record => {
      active = Boolean(record?.[ACTIVE_KEY]);
    })
    .catch(() => undefined);
}
refreshActive();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (ACTIVE_KEY in changes) active = Boolean(changes[ACTIVE_KEY].newValue);
});

function describeTarget(el: EventTarget | null): { tag: string; label?: string; selector?: string } {
  if (!(el instanceof Element)) return { tag: 'unknown' };
  const tag = el.tagName.toLowerCase();
  let label: string | undefined =
    (el as HTMLElement).innerText?.trim().slice(0, 80) ||
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    undefined;
  if (label === '') label = undefined;
  const id = el.id ? `#${el.id}` : '';
  const cls = (el as HTMLElement).classList?.length
    ? `.${Array.from((el as HTMLElement).classList)
        .slice(0, 2)
        .join('.')}`
    : '';
  const selector = `${tag}${id}${cls}`;
  return { tag, label, selector };
}

document.addEventListener(
  'click',
  e => {
    if (!active) return;
    const { tag, label, selector } = describeTarget(e.target);
    send({
      kind: 'click',
      data: {
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        button: e.button,
        tag,
        label,
        selector,
        url: location.href,
      },
    });
  },
  true,
);

document.addEventListener(
  'change',
  e => {
    if (!active) return;
    const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!target) return;
    const { tag, selector } = describeTarget(target);
    const isSensitive = target.type === 'password';
    const value = isSensitive ? '<redacted>' : (target.value ?? '').slice(0, 200);
    send({ kind: 'change', data: { tag, selector, value, url: location.href } });
  },
  true,
);

document.addEventListener(
  'keydown',
  e => {
    if (!active) return;
    if (e.isComposing) return;
    const SPECIAL = new Set([
      'Enter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ]);
    if (!SPECIAL.has(e.key)) return;
    const mods = [e.altKey && 'Alt', e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.shiftKey && 'Shift'].filter(Boolean);
    send({ kind: 'key', data: { key: e.key, modifiers: mods, url: location.href } });
  },
  true,
);

window.addEventListener(
  'scroll',
  () => {
    if (!active) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      send({ kind: 'scroll', data: { x: window.scrollX, y: window.scrollY, url: location.href } });
    }, 250);
  },
  { passive: true, capture: true },
);

// Module scope: without an export TS treats every match entry as one shared
// global script scope, so same-named consts across entries collide.
export {};
