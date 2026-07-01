/**
 * CdpController — singleton wrapper around chrome.debugger.
 *
 * Implements every CDP surface the doeverything tool roster needs:
 *   - attach / detach with per-tab lock + idempotency
 *   - mouse press/release/move + drag
 *   - keyboard key + char events + composite shortcuts
 *   - viewport screenshot (jpeg/png, optional clip + downscale)
 *   - Runtime.consoleAPICalled + Runtime.exceptionThrown buffer (10k FIFO)
 *   - Network.requestWillBeSent + responseReceived + loadingFinished/Failed
 *     with eager body fetch (256 KB / req, 5 MB total cache, sensitive
 *     header strip)
 *   - JS dialog policy (accept/dismiss before-unload, alert, confirm, prompt)
 *
 * State lives on `globalThis.__doe_cdp` so a service-worker eviction
 * doesn't leave dangling debugger sessions.
 */

import {
  MAC_KEY_COMMANDS,
  MODIFIER,
  getKeyDefinition,
  isMac,
  requiresShift,
} from './key-definitions.js';
import type { KeyDefinition, ModifierName } from './key-definitions.js';

// Human-input timing helpers. Real users don't fire events at zero-distance
// intervals — sites that look for "robotic" key/mouse cadence (CAPTCHA-light,
// anti-fraud SDKs, recommendation rankers that score session quality) flag
// agents whose press→release / char→char deltas are 0 ms. The numbers below
// stay well inside genuine human ranges while still letting the agent move
// faster than a person could.
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));
/** Symmetric integer jitter around `base` by ±`spread`. */
const jitter = (base: number, spread: number): number =>
  Math.max(0, Math.round(base + (Math.random() - 0.5) * 2 * spread));

const PROTOCOL_VERSION = '1.3';
const CONSOLE_BUFFER_MAX = 10_000;
const NETWORK_CACHE_MAX_BYTES = 5 * 1024 * 1024;
const NETWORK_BODY_MAX_BYTES = 256 * 1024;

const SENSITIVE_HEADER_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization|x-csrf-token)$/i;

export interface ConsoleEntry {
  ts: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  url?: string;
  line?: number;
}

export interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  type?: string;
  startedAt: number;
  finishedAt?: number;
  size?: number;
  responseHeaders?: Record<string, string>;
  requestHeaders?: Record<string, string>;
  bodyState: 'pending' | 'captured' | 'fetch_failed' | 'evicted' | 'skipped_mime' | 'skipped_size';
  body?: string;
  /** Request body (POST data) when present and ≤65KB inline. Outgoing
   *  payload — what the page SENT. Distinct from `body` which is the
   *  RESPONSE. CDP delivers this inline on `Network.requestWillBeSent` for
   *  small payloads; we don't fall back to `Network.getRequestPostData` for
   *  large bodies because the inspect tool's job is signalling shape, not
   *  carrying megabytes of raw POST data. */
  requestBody?: string;
  /** True when the request had a body but CDP did not deliver it inline
   *  (size > 65KB or already evicted). Lets the inspect tool tell the
   *  model "there was a payload but we couldn't capture it". */
  requestBodyOmitted?: boolean;
  failure?: string;
}

interface PerTabState {
  console: ConsoleEntry[];
  network: Map<string, NetworkEntry>;
  networkBytes: number;
  consoleEnabled: boolean;
  networkEnabled: boolean;
  dialogPolicy: 'accept' | 'dismiss';
}

type CdpGlobals = {
  attached: Set<number>;
  attachLocks: Map<number, Promise<void>>;
  perTab: Map<number, PerTabState>;
  eventListenerInstalled: boolean;
  /**
   * Per-tab capture timestamps (ms) inside a 60 s sliding window. Used by
   * `screenshot()` as a hot-loop guard so a runaway agent that keeps
   * calling `computer.screenshot` can't burn vision tokens forever or
   * trip Chrome's `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` quota for
   * the rest of the session.
   */
  captureWindow: Map<number, number[]>;
};

const G = globalThis as unknown as { __doe_cdp?: CdpGlobals };
if (!G.__doe_cdp) {
  G.__doe_cdp = {
    attached: new Set(),
    attachLocks: new Map(),
    perTab: new Map(),
    eventListenerInstalled: false,
    captureWindow: new Map(),
  };
}
const state = G.__doe_cdp;
// Service-worker eviction can replay the singleton with the older shape.
if (!state.captureWindow) state.captureWindow = new Map();

const CAPTURE_WINDOW_MS = 60_000;
const CAPTURE_WINDOW_LIMIT = 40;
// Restricted Chrome internals: `chrome.debugger.attach` returns an opaque
// "Cannot access a chrome:// URL" error here. Detect early so the agent
// gets a readable message instead of a CDP stack.
const RESTRICTED_PROTOCOLS = new Set(['chrome:', 'chrome-extension:', 'about:', 'devtools:', 'edge:', 'view-source:']);

async function assertSupportedTab(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(`doeverything: tab ${tabId} no longer exists.`);
  }
  if (!tab.url) return; // discarded / loading shell — let CDP attach speak.
  let protocol = '';
  try {
    protocol = new URL(tab.url).protocol;
  } catch {
    return;
  }
  if (RESTRICTED_PROTOCOLS.has(protocol)) {
    throw new Error(
      `Cannot operate on ${protocol}// pages — these are restricted Chrome internals. Navigate to a regular http(s) page first.`,
    );
  }
}

function tabState(tabId: number): PerTabState {
  let s = state.perTab.get(tabId);
  if (!s) {
    s = {
      console: [],
      network: new Map(),
      networkBytes: 0,
      consoleEnabled: false,
      networkEnabled: false,
      dialogPolicy: 'accept',
    };
    state.perTab.set(tabId, s);
  }
  return s;
}

function filterHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADER_PATTERN.test(name) ? '<filtered>' : value;
  }
  return out;
}

function bodyMimeAcceptable(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))/i.test(mimeType);
}

function evictOldestNetworkBody(s: PerTabState) {
  // FIFO eviction by insertion order of the Map.
  const oldestKey = s.network.keys().next().value as string | undefined;
  if (!oldestKey) return;
  const entry = s.network.get(oldestKey);
  if (!entry?.body) {
    s.network.delete(oldestKey);
    return;
  }
  s.networkBytes -= entry.body.length;
  entry.body = undefined;
  entry.bodyState = 'evicted';
}

function installGlobalEventListener() {
  if (state.eventListenerInstalled) return;
  state.eventListenerInstalled = true;

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (typeof source.tabId !== 'number') return;
    const s = tabState(source.tabId);

    if (s.consoleEnabled && method === 'Runtime.consoleAPICalled') {
      const p = params as {
        type?: string;
        args?: Array<{ value?: unknown; description?: string }>;
        stackTrace?: { callFrames?: Array<{ url?: string; lineNumber?: number }> };
      };
      const text = (p.args ?? [])
        .map(arg => (arg.value !== undefined ? String(arg.value) : (arg.description ?? '')))
        .join(' ');
      const frame = p.stackTrace?.callFrames?.[0];
      s.console.push({
        ts: Date.now(),
        level: ((p.type as ConsoleEntry['level']) ?? 'log') as ConsoleEntry['level'],
        text,
        url: frame?.url,
        line: frame?.lineNumber,
      });
      if (s.console.length > CONSOLE_BUFFER_MAX) s.console.shift();
      return;
    }

    if (s.consoleEnabled && method === 'Runtime.exceptionThrown') {
      const p = params as {
        exceptionDetails?: { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } };
      };
      const ed = p.exceptionDetails;
      s.console.push({
        ts: Date.now(),
        level: 'error',
        text: ed?.exception?.description ?? ed?.text ?? '',
        url: ed?.url,
        line: ed?.lineNumber,
      });
      if (s.console.length > CONSOLE_BUFFER_MAX) s.console.shift();
      return;
    }

    if (s.networkEnabled && method === 'Network.requestWillBeSent') {
      const p = params as {
        requestId: string;
        request: {
          url: string;
          method: string;
          headers?: Record<string, string>;
          postData?: string;
          hasPostData?: boolean;
        };
        type?: string;
      };
      // CDP delivers `request.postData` inline only for small payloads
      // (≤65KB by default). For larger ones `hasPostData` is true but
      // `postData` is undefined — flag that for the inspect tool to surface.
      const hasBody = !!p.request.postData || !!p.request.hasPostData;
      const inlineBody = p.request.postData;
      s.network.set(p.requestId, {
        requestId: p.requestId,
        url: p.request.url,
        method: p.request.method,
        type: p.type,
        startedAt: Date.now(),
        bodyState: 'pending',
        requestHeaders: filterHeaders(p.request.headers),
        requestBody: inlineBody,
        requestBodyOmitted: hasBody && inlineBody === undefined,
      });
      return;
    }

    if (s.networkEnabled && method === 'Network.responseReceived') {
      const p = params as {
        requestId: string;
        response: {
          status: number;
          statusText: string;
          mimeType?: string;
          headers?: Record<string, string>;
          encodedDataLength?: number;
        };
      };
      const entry = s.network.get(p.requestId);
      if (!entry) return;
      entry.status = p.response.status;
      entry.statusText = p.response.statusText;
      entry.responseHeaders = filterHeaders(p.response.headers);
      entry.size = p.response.encodedDataLength;
      if (!bodyMimeAcceptable(p.response.mimeType)) {
        entry.bodyState = 'skipped_mime';
        return;
      }
    }

    if (s.networkEnabled && method === 'Network.loadingFinished') {
      const p = params as { requestId: string; encodedDataLength?: number };
      const entry = s.network.get(p.requestId);
      if (!entry) return;
      entry.finishedAt = Date.now();
      if (
        entry.bodyState === 'pending' &&
        p.encodedDataLength !== undefined &&
        p.encodedDataLength <= NETWORK_BODY_MAX_BYTES
      ) {
        chrome.debugger
          .sendCommand({ tabId: source.tabId }, 'Network.getResponseBody', { requestId: p.requestId })
          .then(raw => {
            const body = (raw as { body?: string; base64Encoded?: boolean })?.body ?? '';
            const len = body.length;
            while (s.networkBytes + len > NETWORK_CACHE_MAX_BYTES && s.network.size > 0) {
              evictOldestNetworkBody(s);
            }
            entry.body = body;
            entry.bodyState = 'captured';
            s.networkBytes += len;
          })
          .catch(() => {
            entry.bodyState = 'fetch_failed';
          });
      } else if (entry.bodyState === 'pending') {
        entry.bodyState = 'skipped_size';
      }
    }

    if (s.networkEnabled && method === 'Network.loadingFailed') {
      const p = params as { requestId: string; errorText?: string };
      const entry = s.network.get(p.requestId);
      if (!entry) return;
      entry.bodyState = 'fetch_failed';
      entry.failure = p.errorText;
      entry.finishedAt = Date.now();
    }

    if (method === 'Page.javascriptDialogOpening') {
      const policy = s.dialogPolicy;
      void chrome.debugger.sendCommand({ tabId: source.tabId }, 'Page.handleJavaScriptDialog', {
        accept: policy === 'accept',
      });
    }
  });

  chrome.debugger.onDetach.addListener(source => {
    if (typeof source.tabId === 'number') {
      state.attached.delete(source.tabId);
    }
  });
}

export class CdpController {
  static getInstance(): CdpController {
    return instance;
  }

  async attach(tabId: number): Promise<void> {
    installGlobalEventListener();
    if (state.attached.has(tabId)) return;
    const inFlight = state.attachLocks.get(tabId);
    if (inFlight) return inFlight;

    // Fail early on chrome:// / about: / devtools: — `chrome.debugger.attach`
    // throws an opaque protocol error there; this gives the agent a
    // readable message it can recover from.
    await assertSupportedTab(tabId);

    const promise = (async () => {
      await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
      state.attached.add(tabId);
      // `Page` is needed for dialog handling; failure is non-fatal.
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable').catch(() => undefined);
    })().finally(() => {
      state.attachLocks.delete(tabId);
    });

    state.attachLocks.set(tabId, promise);
    return promise;
  }

  async detach(tabId: number): Promise<void> {
    if (!state.attached.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // already detached
    } finally {
      state.attached.delete(tabId);
      state.perTab.delete(tabId);
    }
  }

  async detachAll(): Promise<void> {
    const ids = [...state.attached];
    await Promise.all(ids.map(id => this.detach(id)));
  }

  isAttached(tabId: number): boolean {
    return state.attached.has(tabId);
  }

  async send<T = unknown>(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.attach(tabId);
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  }

  /**
   * Click at a viewport CSS-pixel coordinate.
   *
   * Click at a viewport CSS-pixel coordinate. Four things make
   * this work on framework-heavy apps (React listeners, Canva, Figma) where
   * a naive `mousePressed`/`mouseReleased` pair silently no-ops:
   *
   *   1. **`buttons` bitmask on EVERY event** — Chrome's mouse-event
   *      pipeline derives `MouseEvent.buttons` from CDP's `buttons` field,
   *      not from `button`. React's synthetic events check `buttons`;
   *      omitting it produces events with `buttons === 0` that downstream
   *      handlers treat as a passive hover and ignore.
   *   2. **Separate press/release pair per click count** — `double_click`
   *      and `triple_click` are NOT one event with `clickCount: 2/3`;
   *      they're sequential press/release pairs whose `clickCount` value
   *      increments. This matches how a real mouse generates these events,
   *      and Chrome's click-detection state machine needs to see the
   *      incrementing pattern.
   *   3. **Integer coordinates** — `Math.round` here so press/release/move
   *      hit the same integer pixel; sub-pixel drift between events can
   *      cause Chrome to register two separate clicks instead of a double.
   *   4. **Realistic inter-event delays**:
   *      - 100 ms after the initial `mouseMoved` so hover handlers fire
   *        (tooltips appear, sub-menus open, lazy listeners attach) before
   *        the press lands. Sites like Canva delay-attach click handlers in
   *        response to `mouseenter` — a sub-frame-time press misses them.
   *      - 12 ms between press and release so the browser's click
   *        synthesiser sees a non-zero hold duration; some sites debounce
   *        on hold < 8 ms.
   *      - 100 ms between successive clicks (double/triple) so Chrome's
   *        click-detector treats the sequence as one logical multi-click
   *        rather than independent clicks. Below ~50 ms Chrome can collapse
   *        them; above ~250 ms it can fall out of the multi-click window.
   *      Net cost: ~110 ms for a single click — invisible to the user,
   *      decisive for click reliability on heavy SPAs.
   */
  async clickAt(
    tabId: number,
    x: number,
    y: number,
    options: { button?: 'left' | 'right' | 'middle'; modifiers?: readonly ModifierName[]; clickCount?: number } = {},
  ): Promise<void> {
    const button = options.button ?? 'left';
    const clickCount = Math.max(1, options.clickCount ?? 1);
    const buttonsMask = button === 'left' ? 1 : button === 'right' ? 2 : button === 'middle' ? 4 : 0;
    const rx = Math.round(x);
    const ry = Math.round(y);

    // Modifier-aware click: a real shift-click is a Shift key DOWN, a click,
    // then Shift UP — not a click whose event happens to carry the Shift
    // bitmask. Sites that audit key/mouse fairness (anti-fraud, accessibility
    // shortcut detectors) read the keydown/keyup pair and ignore the
    // `event.shiftKey` field. `withModifiersHeld` emits the real key events
    // and returns the corresponding bitmask so every mouse event below still
    // carries the matching `modifiers` field for the rest of the listeners.
    await this.withModifiersHeld(tabId, options.modifiers, async modifiers => {
      // 1. Move the cursor into position with no button held — matches a real
      //    mouse pre-click hover.
      await this.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rx,
        y: ry,
        button: 'none',
        buttons: 0,
        modifiers,
      });
      // Let hover handlers settle (tooltips, sub-menus, lazy click listeners).
      await sleep(jitter(100, 20));

      // 2. Press/release pair per click in the sequence. `clickCount`
      //    increments (1, 2, 3...) inside the loop — this is what Chrome's
      //    click-detector reads to distinguish single/double/triple.
      for (let i = 1; i <= clickCount; i++) {
        await this.send(tabId, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: rx,
          y: ry,
          button,
          buttons: buttonsMask,
          clickCount: i,
          modifiers,
        });
        // Press hold sits in the genuine human range (median ~50–80 ms).
        // The previous 12 ms value was robotic enough for anti-bot SDKs to
        // flag — it only existed to clear sites that debounce <8 ms.
        await sleep(jitter(55, 15));
        await this.send(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: rx,
          y: ry,
          button,
          buttons: 0,
          clickCount: i,
          modifiers,
        });
        // Gap between clicks so Chrome groups them into one multi-click —
        // skip after the last click since there's no next press to space.
        if (i < clickCount) await sleep(jitter(110, 20));
      }
    });
  }

  /**
   * Click-and-drag gesture from one viewport coordinate to another.
   *
   * Real-user-equivalent path:
   *   1. mouseMoved to the start with no buttons held (hover).
   *   2. ~80 ms settle so the start surface lights up its hover state — drag
   *      libraries (react-dnd, dnd-kit) often arm their handlers on hover.
   *   3. mousePressed at the start.
   *   4. ~25 ms hold so the press registers as a press (not a drag start
   *      synthesised from a too-fast move with `buttons==1`).
   *   5. N interpolated mouseMoved events with `buttons == 1`, paced at
   *      ~16 ms (60 fps). Step count scales with Euclidean distance — every
   *      mid-point is a real DOM `mousemove`, which is what slider widgets,
   *      Canva/Figma canvases, draw-on-canvas apps, Swiper, and every
   *      pointer-based drag library actually listen for. A single jump from
   *      start to end (the old behaviour) made all of those silently no-op:
   *      they see one `mousedown` and one `mousemove` 0 ms apart and ignore
   *      it as a misfire.
   *   6. mouseReleased at the end.
   *
   * The interpolation is linear — humans are roughly linear at this scale,
   * and easing curves are needless detail.
   */
  async dragFromTo(
    tabId: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: { button?: 'left' | 'right' | 'middle'; modifiers?: readonly ModifierName[] } = {},
  ): Promise<void> {
    const button = options.button ?? 'left';
    const buttonsMask = button === 'left' ? 1 : button === 'right' ? 2 : button === 'middle' ? 4 : 0;
    const sx = Math.round(from.x);
    const sy = Math.round(from.y);
    const ex = Math.round(to.x);
    const ey = Math.round(to.y);

    const dx = ex - sx;
    const dy = ey - sy;
    const distance = Math.hypot(dx, dy);
    // 1 step per ~18 px, clamped to [8, 30]. Short drags (slider nudges) still
    // get enough intermediate moves to trip the threshold; long drags don't
    // explode the event count.
    const steps = Math.max(8, Math.min(30, Math.ceil(distance / 18)));
    const stepDelayMs = 16;

    await this.withModifiersHeld(tabId, options.modifiers, async modifiers => {
      await this.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: sx,
        y: sy,
        button: 'none',
        buttons: 0,
        modifiers,
      });
      await sleep(jitter(80, 20));

      await this.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: sx,
        y: sy,
        button,
        buttons: buttonsMask,
        clickCount: 1,
        modifiers,
      });
      // Brief hold before the first move — most drag detectors require the
      // press to settle before they accept subsequent moves as a drag.
      await sleep(jitter(25, 8));

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mx = Math.round(sx + dx * t);
        const my = Math.round(sy + dy * t);
        await this.send(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: mx,
          y: my,
          button,
          buttons: buttonsMask,
          modifiers,
        });
        if (i < steps) await sleep(stepDelayMs);
      }

      await this.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: ex,
        y: ey,
        button,
        buttons: 0,
        clickCount: 1,
        modifiers,
      });
    });
  }

  /**
   * Run `inner` with the given modifier keys held down via real
   * `keydown`/`keyup` events, returning the matching CDP modifier bitmask.
   *
   * A real user holding Shift while clicking generates `keydown(Shift)`
   * BEFORE the mouse events and `keyup(Shift)` AFTER — and each event
   * carries the modifier bitmask reflecting state at that instant. Sites
   * that read `Shift` from the keyboard event stream (rather than from
   * `event.shiftKey` on the click) need this; firing the click with the
   * bitmask alone leaves the keyboard listeners silent and gives the agent
   * away.
   *
   * Order: bits add as keys go down (Ctrl → Ctrl+Shift → …), bits clear
   * as keys come up in reverse, matching the DOM spec where `keyup` of a
   * modifier no longer has that modifier in its bitmask.
   */
  private async withModifiersHeld<T>(
    tabId: number,
    modifierNames: readonly ModifierName[] | undefined,
    inner: (modifiers: number) => Promise<T>,
  ): Promise<T> {
    if (!modifierNames || modifierNames.length === 0) {
      return inner(0);
    }
    let mods = 0;
    const resolved: Array<{ name: ModifierName; bit: number; def: KeyDefinition }> = [];
    for (const name of modifierNames) {
      const def = getKeyDefinition(name);
      if (!def) continue;
      resolved.push({ name, bit: MODIFIER[name], def });
    }
    for (const { bit, def } of resolved) {
      mods |= bit;
      await this.send(tabId, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.windowsVirtualKeyCode,
        location: def.location ?? 0,
        modifiers: mods,
      });
    }
    try {
      return await inner(mods);
    } finally {
      // Release in reverse press order. `keyup` of the modifier itself fires
      // with the bit already cleared — matches what a real keyboard reports.
      for (let i = resolved.length - 1; i >= 0; i--) {
        const { bit, def } = resolved[i];
        mods &= ~bit;
        await this.send(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: def.key,
          code: def.code,
          windowsVirtualKeyCode: def.windowsVirtualKeyCode,
          location: def.location ?? 0,
          modifiers: mods,
        });
      }
    }
  }

  /** Hover (no-button mouseMoved). Round to integer for the same reason as `clickAt`. */
  async moveCursor(tabId: number, x: number, y: number): Promise<void> {
    await this.send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
      button: 'none',
      buttons: 0,
      modifiers: 0,
    });
  }

  /**
   * Direct CDP `Input.insertText`.
   *
   * Bypasses the keyDown/keyUp pipeline — useful for non-ASCII characters
   * (Turkish İŞĞÜÖ, emoji, CJK) that have no `KeyDefinition`. Does NOT emit
   * `keydown`/`keyup` events, so editors that hook those will see only the
   * resulting `input` event. Prefer `typeText` when you want real keyboard
   * events; reserve this for atomic non-ASCII inserts.
   */
  async insertText(tabId: number, text: string): Promise<void> {
    if (!text) return;
    await this.send(tabId, 'Input.insertText', { text });
  }

  /**
   * Per-character text input.
   *
   * For each char:
   *   1. Look up a `KeyDefinition` (handles `\n` → Enter, ASCII letters/digits,
   *      punctuation entries from the keymap).
   *   2. If found, dispatch a real `keyDown`+`keyUp` pair — with Shift held
   *      for uppercase letters and the US shift-required punctuation (`!@#…`).
   *      This is what editors with custom keymaps (CodeMirror, Monaco,
   *      ProseMirror, Lexical) need to register input.
   *   3. If not found (Turkish, emoji, CJK …), fall back to `Input.insertText`
   *      so the literal codepoint still lands in the field.
   */
  async typeText(tabId: number, text: string): Promise<void> {
    if (!text) return;
    let first = true;
    for (const char of text) {
      // Inter-character delay sits in the human-typing range (median word
      // typists land around 100–180 ms per char). 40 ms ± 15 stays faster
      // than a person but well clear of the 0 ms cadence that anti-bot
      // SDKs key on. Skip the delay before the first char so single-char
      // sends still feel instant.
      if (!first) await sleep(jitter(40, 15));
      first = false;
      const keyName = char === '\n' || char === '\r' ? 'Enter' : char;
      const def = getKeyDefinition(keyName);
      if (def) {
        const mods = requiresShift(char) ? 8 : 0;
        await this.dispatchKeyDef(tabId, def, mods);
      } else {
        // No keymap entry — insert as raw text (non-ASCII, etc.).
        await this.send(tabId, 'Input.insertText', { text: char });
      }
    }
  }

  /**
   * Press a single named key with optional modifier names — back-compat shape
   * for callers that already speak this form (e.g. `pressKey(tabId, "Enter",
   * ["Ctrl"])`). For chord strings ("ctrl+a") use `pressKeyChord`, which is
   * the path that also applies Mac NSEvent commands.
   */
  async pressKey(tabId: number, name: string, modifiers?: readonly ModifierName[]): Promise<void> {
    const def = getKeyDefinition(name);
    if (!def) throw new Error(`doeverything: no key definition for "${name}"`);
    // Wrap modifier press/release around the main key so the modifier
    // fires as its own keydown/keyup pair — what a real keyboard does.
    await this.withModifiersHeld(tabId, modifiers, async mods => {
      await this.dispatchKeyDef(tabId, def, mods);
    });
  }

  /**
   * Full chord dispatch.
   *
   * Accepts strings like `"ctrl+shift+a"`, `"cmd+z"`, `"Backspace"`,
   * `"shift+ArrowLeft"`. Parses modifiers + main key, computes the CDP
   * modifier bitmask, and on macOS attaches the matching `MAC_KEY_COMMANDS`
   * NSEvent selectors (`selectAll`, `moveToBeginningOfLine`, etc.) to the
   * key event so AppKit-backed editors react correctly. On Windows/Linux
   * the `commands` array stays empty and Chrome handles the chord natively.
   */
  async pressKeyChord(tabId: number, chord: string): Promise<void> {
    if (!chord) return;
    const lowerChord = chord.toLowerCase();
    const parts = lowerChord.split('+').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return;

    // Map chord-token names to canonical `ModifierName` so
    // `withModifiersHeld` can drive real key events for each modifier.
    const TOKEN_TO_MODIFIER: Record<string, ModifierName> = {
      alt: 'Alt',
      option: 'Alt',
      ctrl: 'Ctrl',
      control: 'Ctrl',
      meta: 'Meta',
      cmd: 'Meta',
      command: 'Meta',
      win: 'Meta',
      windows: 'Meta',
      shift: 'Shift',
    };

    const modifierNames: ModifierName[] = [];
    let mainKey = '';
    for (const p of parts) {
      const mod = TOKEN_TO_MODIFIER[p];
      if (mod) {
        if (!modifierNames.includes(mod)) modifierNames.push(mod);
      } else {
        mainKey = p;
      }
    }

    // Mac NSEvent command lookup. `commands` only takes effect on macOS Chrome
    // builds (it maps to AppKit's `doCommandBySelector:` chain). On other OSes
    // the field is ignored, so it's always safe to send when `isMac` is true.
    let commands: readonly string[] | undefined;
    if (isMac) {
      const macCmd = MAC_KEY_COMMANDS[lowerChord];
      if (Array.isArray(macCmd)) commands = macCmd;
      else if (typeof macCmd === 'string') commands = [macCmd];
    }

    if (!mainKey) {
      // Modifier-only chord (e.g. `"ctrl"`): nothing useful to dispatch without a main key.
      return;
    }

    const def = getKeyDefinition(mainKey);
    if (!def) throw new Error(`doeverything: no key definition for "${mainKey}" in chord "${chord}"`);
    // Modifier keys go down BEFORE the main key and come up AFTER —
    // exactly what a real keyboard generates. Sites that inspect the key
    // event stream (e.g. to detect Shift held during a paste, or to bind
    // hotkeys via keydown sequences) need this; sending the main key alone
    // with `modifiers` set was hiding the modifier from those listeners.
    await this.withModifiersHeld(tabId, modifierNames, async mods => {
      await this.dispatchKeyDef(tabId, def, mods, commands);
    });
  }

  /**
   * Low-level key event pair (`keyDown`/`keyUp` or `rawKeyDown`/`keyUp`).
   *
   *   - `keyDown` when the key produces text (Enter, letters, digits,
   *     punctuation). `rawKeyDown` for non-textual keys (Escape, arrows,
   *     F-keys, modifier-only) so the browser doesn't synthesise a stray
   *     character.
   *   - When a non-shift modifier (Ctrl/Alt/Meta) is held the chord is a
   *     shortcut — `text` is stripped so editors see a clean keydown
   *     instead of double-handling (running the shortcut AND inserting
   *     the character). Mirrors Puppeteer's behaviour.
   *   - `commands` carries Mac NSEvent selectors when supplied; ignored on
   *     non-Mac platforms by Chrome itself.
   */
  private async dispatchKeyDef(
    tabId: number,
    def: KeyDefinition,
    mods: number,
    commands?: readonly string[],
  ): Promise<void> {
    const hasNonShiftModifier = (mods & ~8) !== 0;
    const text = def.text && !hasNonShiftModifier ? def.text : '';
    const base = {
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.windowsVirtualKeyCode,
      location: def.location ?? 0,
      isKeypad: def.isKeypad ?? false,
      modifiers: mods,
    };
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      ...base,
      text,
      unmodifiedText: text,
      commands: commands ? [...commands] : [],
    });
    // Real keys are held briefly between keyDown and keyUp. The previous
    // back-to-back pair fired with 0 ms gap is the easiest behavioural
    // tell for anti-bot SDKs.
    await sleep(jitter(35, 10));
    await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async screenshot(
    tabId: number,
    options: {
      format?: 'jpeg' | 'png';
      quality?: number;
      clip?: { x: number; y: number; width: number; height: number };
      /**
       * When true and the target tab is not the active tab in its window,
       * activate the tab and focus the window before capture. Prevents
       * GPU-throttled / blank frames on background tabs at the cost of a
       * brief user-visible focus shift. Default false (most callers know
       * the tab is already foregrounded).
       */
      bringToFront?: boolean;
    } = {},
  ): Promise<{
    base64: string;
    format: 'jpeg' | 'png';
    /** Viewport CSS-pixel width at the moment of capture. */
    viewportWidth: number;
    /** Viewport CSS-pixel height at the moment of capture. */
    viewportHeight: number;
    /** Capture's device-pixel ratio (e.g. 2 on a Retina display). */
    devicePixelRatio: number;
  }> {
    // Hot-loop guard: a runaway agent that keeps re-screenshotting can
    // burn vision tokens unboundedly AND trip Chrome's quota. Track per
    // tab; refuse beyond the limit. Cheap insurance — the buffer is at
    // most CAPTURE_WINDOW_LIMIT timestamps per tab.
    const now = Date.now();
    const recent = (state.captureWindow.get(tabId) ?? []).filter(t => now - t < CAPTURE_WINDOW_MS);
    if (recent.length >= CAPTURE_WINDOW_LIMIT) {
      const oldestAge = Math.round((now - recent[0]) / 1000);
      throw new Error(
        `Screenshot rate limit exceeded for tab ${tabId} (>${CAPTURE_WINDOW_LIMIT} captures in ${oldestAge}s). ` +
          `If this is intentional, throttle the agent loop or restart the conversation.`,
      );
    }
    recent.push(now);
    state.captureWindow.set(tabId, recent);

    await this.attach(tabId);

    if (options.bringToFront) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.active && tab.id !== undefined) {
          await chrome.tabs.update(tab.id, { active: true });
        }
        if (tab.windowId !== undefined) {
          const win = await chrome.windows.get(tab.windowId);
          if (!win.focused) await chrome.windows.update(tab.windowId, { focused: true });
        }
      } catch {
        // Activation is best-effort; capture still tries.
      }
    }

    // One CDP round-trip for viewport CSS dimensions + DPR. We're already
    // attached so this is cheap; gives downstream optimisers and result
    // text the scale needed to keep model click coordinates correct.
    let viewportWidth = 0;
    let viewportHeight = 0;
    let devicePixelRatio = 1;
    try {
      const viewport = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression:
          '({ w: window.innerWidth | 0, h: window.innerHeight | 0, d: window.devicePixelRatio || 1 })',
        returnByValue: true,
      });
      const v = (viewport as { result?: { value?: { w?: number; h?: number; d?: number } } } | undefined)?.result
        ?.value;
      if (v) {
        if (typeof v.w === 'number') viewportWidth = v.w;
        if (typeof v.h === 'number') viewportHeight = v.h;
        if (typeof v.d === 'number' && v.d > 0) devicePixelRatio = v.d;
      }
    } catch {
      // Probe failure is non-fatal — the optimiser can still cap by
      // long-edge; coordinate translation just won't be available.
    }

    const format = options.format ?? 'jpeg';
    const params: Record<string, unknown> = {
      format,
      // `fromSurface: true` reads from the GPU compositor surface (the
      // pixels the user actually sees) instead of forcing a layout/paint
      // pass — faster and avoids capturing a stale frame mid-paint.
      // `captureBeyondViewport: false` limits to the visible viewport
      // exactly; without it the agent occasionally gets a tall image
      // that includes overscan on infinite-scroll pages.
      fromSurface: true,
      captureBeyondViewport: false,
    };
    if (format === 'jpeg') params.quality = options.quality ?? 80;
    // Capture at the default device-pixel resolution (no `scale: 1` clip).
    // DPR division is done downstream on an OffscreenCanvas where the token-based
    // resize also runs. Forcing `scale: 1` here bypasses the GPU compositor's
    // native downsample and yields softer text.
    // Explicit `clip` (e.g. zoom action) still honours scale: 1, because
    // those callers want pixel-exact viewport pixels.
    if (options.clip) {
      params.clip = { ...options.clip, scale: 1 };
    }
    const result = await this.send<{ data: string }>(tabId, 'Page.captureScreenshot', params);
    return {
      base64: result.data,
      format,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
    };
  }

  async enableConsoleTracking(tabId: number): Promise<void> {
    const s = tabState(tabId);
    if (s.consoleEnabled) return;
    await this.send(tabId, 'Runtime.enable');
    s.consoleEnabled = true;
  }

  async enableNetworkTracking(tabId: number): Promise<void> {
    const s = tabState(tabId);
    if (s.networkEnabled) return;
    await this.send(tabId, 'Network.enable');
    s.networkEnabled = true;
  }

  getConsole(
    tabId: number,
    opts: { since?: number; level?: ConsoleEntry['level'] | 'all'; pattern?: string } = {},
  ): ConsoleEntry[] {
    const s = tabState(tabId);
    const re = opts.pattern ? new RegExp(opts.pattern, 'i') : null;
    return s.console.filter(e => {
      if (opts.since !== undefined && e.ts < opts.since) return false;
      if (opts.level && opts.level !== 'all' && e.level !== opts.level) return false;
      if (re && !re.test(e.text)) return false;
      return true;
    });
  }

  getNetwork(
    tabId: number,
    opts: { since?: number; filterUrl?: string; method?: string; statusRange?: [number, number] } = {},
  ): NetworkEntry[] {
    const s = tabState(tabId);
    const re = opts.filterUrl ? new RegExp(opts.filterUrl, 'i') : null;
    return [...s.network.values()].filter(e => {
      if (opts.since !== undefined && e.startedAt < opts.since) return false;
      if (re && !re.test(e.url)) return false;
      if (opts.method && e.method.toUpperCase() !== opts.method.toUpperCase()) return false;
      if (opts.statusRange) {
        const [min, max] = opts.statusRange;
        if (e.status === undefined || e.status < min || e.status > max) return false;
      }
      return true;
    });
  }

  getNetworkRequest(tabId: number, requestId: string): NetworkEntry | undefined {
    return tabState(tabId).network.get(requestId);
  }

  /** Drop the in-memory console buffer for a tab. New entries continue to flow. */
  clearConsole(tabId: number): void {
    const s = state.perTab.get(tabId);
    if (s) s.console = [];
  }

  /** Drop the in-memory network buffer for a tab. New entries continue to flow. */
  clearNetwork(tabId: number): void {
    const s = state.perTab.get(tabId);
    if (s) {
      s.network.clear();
      s.networkBytes = 0;
    }
  }

  setDialogPolicy(tabId: number, policy: 'accept' | 'dismiss'): void {
    tabState(tabId).dialogPolicy = policy;
  }
}

const instance = new CdpController();

chrome.tabs?.onRemoved?.addListener(tabId => {
  state.attached.delete(tabId);
  state.perTab.delete(tabId);
});
