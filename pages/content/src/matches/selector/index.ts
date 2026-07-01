/**
 * ElementSelectorInjector.
 *
 * Injected into every top frame. Stays dormant until the SW broadcasts
 * `doe/selector/start` with a request id; then it lets the user
 * draw a rectangle over the page (or click a single element). On commit
 * (Enter / mouse-up), the captured region/selector is sent back to the SW
 * via `doe/selector/result` and the overlay is torn down.
 *
 * Activation flag in `chrome.storage.local.de:selector-active`
 * mirrors the recorder pattern so SW eviction can't leave the page in a
 * stuck state.
 */

const ACTIVE_KEY = 'doe:selector-active';
const STYLE_ID = 'de-selector-styles';
const OVERLAY_ID = 'de-selector-overlay';
const RECT_ID = 'de-selector-rect';
const HINT_ID = 'de-selector-hint';

type Mode = 'region' | 'element';

interface Session {
  requestId: string;
  mode: Mode;
  startX: number | null;
  startY: number | null;
}

let active: Session | null = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483646 !important;
      cursor: crosshair !important;
      background: rgba(0, 0, 0, 0.18) !important;
    }
    #${RECT_ID} {
      position: fixed !important;
      border: 2px solid #d97757 !important;
      background: rgba(217, 119, 87, 0.15) !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    }
    #${HINT_ID} {
      position: fixed !important;
      bottom: 16px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2147483647 !important;
      background: #faf9f5 !important;
      color: #1a1a1a !important;
      font: 13px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif !important;
      padding: 8px 14px !important;
      border-radius: 999px !important;
      box-shadow: 0 6px 20px rgba(0,0,0,0.18) !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function teardown() {
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(RECT_ID)?.remove();
  document.getElementById(HINT_ID)?.remove();
  active = null;
}

function describeSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = (el as HTMLElement).classList?.length
    ? `.${Array.from((el as HTMLElement).classList)
        .slice(0, 3)
        .join('.')}`
    : '';
  const parent = el.parentElement;
  if (parent && parent !== document.body) {
    const parentTag = parent.tagName.toLowerCase();
    return `${parentTag} > ${tag}${cls}`;
  }
  return `${tag}${cls}`;
}

function startElement() {
  if (!active) return;
  ensureStyles();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.background = 'transparent';
  overlay.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    overlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = '';
    if (!target || !active) return;
    const rect = (target as HTMLElement).getBoundingClientRect();
    chrome.runtime
      .sendMessage({
        type: 'doe/selector/result',
        requestId: active.requestId,
        mode: 'element',
        selector: describeSelector(target),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        text: ((target as HTMLElement).innerText ?? '').slice(0, 200),
      })
      .catch(() => undefined);
    teardown();
  });
  const hint = document.createElement('div');
  hint.id = HINT_ID;
  hint.textContent = 'Click an element · Esc to cancel';
  document.documentElement.append(overlay, hint);
}

function startRegion() {
  if (!active) return;
  ensureStyles();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;

  const rectEl = document.createElement('div');
  rectEl.id = RECT_ID;
  rectEl.style.display = 'none';

  const hint = document.createElement('div');
  hint.id = HINT_ID;
  hint.textContent = 'Drag to select region · Esc to cancel';

  let startX = 0,
    startY = 0,
    dragging = false;

  overlay.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    rectEl.style.left = `${startX}px`;
    rectEl.style.top = `${startY}px`;
    rectEl.style.width = `0px`;
    rectEl.style.height = `0px`;
    rectEl.style.display = 'block';
  });
  overlay.addEventListener('mousemove', e => {
    if (!dragging) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    rectEl.style.left = `${x}px`;
    rectEl.style.top = `${y}px`;
    rectEl.style.width = `${w}px`;
    rectEl.style.height = `${h}px`;
  });
  overlay.addEventListener('mouseup', e => {
    if (!dragging || !active) return;
    dragging = false;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    chrome.runtime
      .sendMessage({
        type: 'doe/selector/result',
        requestId: active.requestId,
        mode: 'region',
        rect: { x, y, width: w, height: h },
        devicePixelRatio: window.devicePixelRatio || 1,
      })
      .catch(() => undefined);
    teardown();
  });

  document.documentElement.append(overlay, rectEl, hint);
}

document.addEventListener(
  'keydown',
  e => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      chrome.runtime
        .sendMessage({ type: 'doe/selector/result', requestId: active.requestId, cancelled: true })
        .catch(() => undefined);
      teardown();
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as { type?: string; requestId?: string; mode?: Mode } | null;
  if (msg?.type === 'doe/selector/start' && msg.requestId) {
    teardown();
    active = { requestId: msg.requestId, mode: msg.mode ?? 'region', startX: null, startY: null };
    if (active.mode === 'element') startElement();
    else startRegion();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'doe/selector/cancel') {
    teardown();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// Mirror the activation flag like recorder.ts so SW can check whether a
// session is open without reaching into content scripts.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[ACTIVE_KEY]?.newValue === false) teardown();
});

// Module scope: without an export TS treats every match entry as one shared
// global script scope, so same-named consts across entries collide.
export {};
