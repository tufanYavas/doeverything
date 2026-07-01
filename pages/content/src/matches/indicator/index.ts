/**
 * doeverything visual indicator content script.
 *
 * Injected into every top frame to give the user a clear "the agent is
 * driving this page" affordance:
 *   1. Pulsing terracotta border around the viewport (glow).
 *   2. Bottom-center "Stop doeverything" pill that aborts the run.
 *   3. Static badge on secondary tabs in the same agent group.
 *
 * The script keeps its DOM out of the page's flow (`pointer-events: none`
 * everywhere except the stop button) and uses prefixed IDs to avoid
 * collisions with the host site.
 *
 * Service worker → indicator messages (chrome.tabs.sendMessage):
 *   - de/indicator/show
 *   - de/indicator/hide
 *   - de/indicator/hide-for-tool   (tool execution; we cloak the UI)
 *   - de/indicator/show-after-tool
 *   - de/indicator/show-static
 *   - de/indicator/hide-static
 *
 * Indicator → service worker (chrome.runtime.sendMessage):
 *   - de/indicator/stop
 *   - de/indicator/switch-to-main-tab
 *   - de/indicator/dismiss-static
 *   - de/indicator/heartbeat (every 5s while static is visible)
 */

// Belt-and-braces iframe guard: the manifest already declares
// `all_frames: false`, but content scripts can still be programmatically
// injected by other extensions. Skip every non-top frame so we don't paint
// indicators inside ad/embed iframes.
if (window.top !== window.self) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__doe_indicator_skipped = true;
} else {
  const _start = installIndicator;
  _start();
}

function installIndicator() {
  const PREFIX = 'de-indicator';
  const Z = 2147483646;

  const MSG = {
    SHOW: 'doe/indicator/show',
    HIDE: 'doe/indicator/hide',
    HIDE_FOR_TOOL: 'doe/indicator/hide-for-tool',
    SHOW_AFTER_TOOL: 'doe/indicator/show-after-tool',
    SHOW_STATIC: 'doe/indicator/show-static',
    HIDE_STATIC: 'doe/indicator/hide-static',
    STOP: 'doe/indicator/stop',
    SWITCH: 'doe/indicator/switch-to-main-tab',
    DISMISS_STATIC: 'doe/indicator/dismiss-static',
    HEARTBEAT: 'doe/indicator/heartbeat',
  } as const;

  const STYLE_ID = `${PREFIX}-styles`;
  const GLOW_ID = `${PREFIX}-glow`;
  const STOP_ID = `${PREFIX}-stop`;
  const STATIC_ID = `${PREFIX}-static`;

  let staticHeartbeat: ReturnType<typeof setInterval> | null = null;
  let preToolDisplayState: { glow: string; stop: string } | null = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
    @keyframes ${PREFIX}-pulse {
      0%, 100% { box-shadow: inset 0 0 24px 8px rgba(217, 119, 87, 0.3); }
      50%      { box-shadow: inset 0 0 36px 12px rgba(217, 119, 87, 1); }
    }
    @keyframes ${PREFIX}-rise {
      from { opacity: 0; transform: translate(-50%, 16px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    .${PREFIX}-glow {
      position: fixed !important;
      inset: 0 !important;
      pointer-events: none !important;
      z-index: ${Z} !important;
      animation: ${PREFIX}-pulse 2s ease-in-out infinite !important;
      transition: opacity 300ms ease !important;
    }
    .${PREFIX}-pill {
      position: fixed !important;
      bottom: 16px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: ${Z} !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 10px 14px !important;
      border-radius: 999px !important;
      background: #faf9f5 !important;
      color: #1a1a1a !important;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(217, 119, 87, 0.4) !important;
      cursor: pointer !important;
      animation: ${PREFIX}-rise 280ms ease-out !important;
      transition: opacity 300ms ease !important;
    }
    .${PREFIX}-pill:hover { background: #f5f4f0 !important; }
    .${PREFIX}-pill .dot {
      width: 8px !important;
      height: 8px !important;
      border-radius: 999px !important;
      background: #d97757 !important;
      box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.25) !important;
    }
    .${PREFIX}-static {
      position: fixed !important;
      bottom: 16px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: ${Z} !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 8px 12px !important;
      border-radius: 999px !important;
      background: #faf9f5 !important;
      color: #1a1a1a !important;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
      font-size: 12px !important;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14) !important;
    }
    .${PREFIX}-static button {
      all: unset !important;
      cursor: pointer !important;
      padding: 4px 8px !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
    }
    .${PREFIX}-static button:hover { background: rgba(0,0,0,0.06) !important; }
  `;
    document.documentElement.appendChild(style);
  }

  function showAgentIndicators() {
    ensureStyles();
    preToolDisplayState = null;

    if (!document.getElementById(GLOW_ID)) {
      const glow = document.createElement('div');
      glow.id = GLOW_ID;
      glow.className = `${PREFIX}-glow`;
      document.documentElement.appendChild(glow);
    }

    if (!document.getElementById(STOP_ID)) {
      const pill = document.createElement('button');
      pill.id = STOP_ID;
      pill.type = 'button';
      pill.className = `${PREFIX}-pill`;
      pill.innerHTML = `<span class="dot"></span>Stop Doe`;
      pill.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: MSG.STOP }).catch(() => undefined);
      });
      document.documentElement.appendChild(pill);
    }
  }

  function hideAgentIndicators() {
    for (const id of [GLOW_ID, STOP_ID]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }
  }

  function hideForTool() {
    const glow = document.getElementById(GLOW_ID) as HTMLElement | null;
    const stop = document.getElementById(STOP_ID) as HTMLElement | null;
    preToolDisplayState = {
      glow: glow?.style.display ?? '',
      stop: stop?.style.display ?? '',
    };
    if (glow) glow.style.display = 'none';
    if (stop) stop.style.display = 'none';
  }

  function showAfterTool() {
    if (!preToolDisplayState) return;
    const glow = document.getElementById(GLOW_ID) as HTMLElement | null;
    const stop = document.getElementById(STOP_ID) as HTMLElement | null;
    if (glow) glow.style.display = preToolDisplayState.glow;
    if (stop) stop.style.display = preToolDisplayState.stop;
    preToolDisplayState = null;
  }

  function showStatic() {
    ensureStyles();
    if (!document.getElementById(STATIC_ID)) {
      const wrap = document.createElement('div');
      wrap.id = STATIC_ID;
      wrap.className = `${PREFIX}-static`;
      wrap.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:6px;">
        <span style="width:8px;height:8px;border-radius:999px;background:#d97757;"></span>
        Doe is active in this tab group
      </span>
      <button data-action="open">Open chat</button>
      <button data-action="dismiss" aria-label="Dismiss">×</button>
    `;
      wrap.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        const action = target.dataset?.action;
        if (action === 'open') chrome.runtime.sendMessage({ type: MSG.SWITCH }).catch(() => undefined);
        if (action === 'dismiss') chrome.runtime.sendMessage({ type: MSG.DISMISS_STATIC }).catch(() => undefined);
      });
      document.documentElement.appendChild(wrap);
    }

    if (staticHeartbeat) clearInterval(staticHeartbeat);
    staticHeartbeat = setInterval(() => {
      chrome.runtime.sendMessage({ type: MSG.HEARTBEAT }, response => {
        if (chrome.runtime.lastError) return;
        if (response && response.ok === false) hideStatic();
      });
    }, 5000);
  }

  function hideStatic() {
    document.getElementById(STATIC_ID)?.remove();
    if (staticHeartbeat) {
      clearInterval(staticHeartbeat);
      staticHeartbeat = null;
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const type = (message as { type?: string } | null)?.type;
    switch (type) {
      case MSG.SHOW:
        showAgentIndicators();
        break;
      case MSG.HIDE:
        hideAgentIndicators();
        break;
      case MSG.HIDE_FOR_TOOL:
        hideForTool();
        break;
      case MSG.SHOW_AFTER_TOOL:
        showAfterTool();
        break;
      case MSG.SHOW_STATIC:
        showStatic();
        break;
      case MSG.HIDE_STATIC:
        hideStatic();
        break;
    }
    return false;
  });

  // Tear down before the page unloads — keeps pages snappy after navigation.
  window.addEventListener('pagehide', () => {
    hideAgentIndicators();
    hideStatic();
  });
}
