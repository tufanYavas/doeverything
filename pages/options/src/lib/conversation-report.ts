/**
 * Conversation report generator.
 *
 * Renders a self-contained HTML report from the per-turn transcripts captured
 * by the agent runner (TaskLogger.saveTranscript). The shape is modelled on
 * `generate_gemini_har_report.js` — top-of-page summary + per-turn cards that
 * expand to show the system prompt, conversation messages, tool calls (args
 * + results), response text, finish reason, and token usage.
 *
 * The output is opened in a new tab via a Blob URL by RunsTab, so the user
 * gets a stand-alone artifact they can save, share, or grep.
 */

interface TranscriptToolCallDTO {
  callId?: string;
  name: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  startedAt?: number;
  endedAt?: number;
}

interface TranscriptToolSchemaDTO {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface TranscriptDTO {
  runId: string;
  conversationId: string;
  startedAt: number;
  endedAt?: number;
  provider?: string;
  model?: string;
  system?: string;
  /**
   * AI SDK ModelMessage[]. We treat the shape opaquely and inspect by role +
   * content kind at render time so a future SDK message-shape change can't
   * silently break the report.
   */
  messages?: unknown;
  tools?: TranscriptToolSchemaDTO[];
  toolCalls: TranscriptToolCallDTO[];
  responseText?: string;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  error?: { type?: string; message: string; statusCode?: number; responseBody?: string };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBytes(n: number): string {
  if (n > 1_048_576) return (n / 1_048_576).toFixed(1) + 'MB';
  if (n > 1024) return Math.round(n / 1024) + 'KB';
  return n + 'B';
}

function fmtJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function trunc(s: string, max = 12000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n… (${(s.length - max).toLocaleString()} more chars truncated)`;
}

interface MessagePartView {
  kind: 'text' | 'tool-call' | 'tool-result' | 'image' | 'file' | 'reasoning' | 'unknown';
  label: string;
  body: string;
}

/**
 * Normalise a ModelMessage's `content` into a list of viewable parts. The AI
 * SDK uses different shapes for user/assistant/tool messages: plain string,
 * array of `{type: 'text' | 'tool-call' | 'tool-result' | 'image' | ...}`,
 * etc. We render whatever's there without coercing to a single shape.
 */
function partsFromContent(content: unknown): MessagePartView[] {
  if (typeof content === 'string') {
    return [{ kind: 'text', label: `text (${content.length.toLocaleString()} chars)`, body: content }];
  }
  if (!Array.isArray(content)) {
    return [{ kind: 'unknown', label: 'unknown content', body: fmtJson(content) }];
  }
  return content.map((part: unknown): MessagePartView => {
    if (!part || typeof part !== 'object') {
      return { kind: 'unknown', label: 'unknown part', body: fmtJson(part) };
    }
    const p = part as Record<string, unknown>;
    const type = typeof p.type === 'string' ? p.type : 'unknown';
    if (type === 'text' && typeof p.text === 'string') {
      return { kind: 'text', label: `text (${p.text.length.toLocaleString()} chars)`, body: p.text };
    }
    if (type === 'reasoning') {
      const t = typeof p.text === 'string' ? p.text : fmtJson(p);
      return { kind: 'reasoning', label: `reasoning (${t.length.toLocaleString()} chars)`, body: t };
    }
    if (type === 'tool-call') {
      const name = typeof p.toolName === 'string' ? p.toolName : '?';
      return { kind: 'tool-call', label: `tool-call → ${name}`, body: fmtJson(p.input ?? p.args) };
    }
    if (type === 'tool-result') {
      const name = typeof p.toolName === 'string' ? p.toolName : '?';
      return { kind: 'tool-result', label: `tool-result ← ${name}`, body: fmtJson(p.output ?? p.result) };
    }
    if (type === 'image') {
      const mt = typeof p.mediaType === 'string' ? p.mediaType : 'image/?';
      return { kind: 'image', label: `image (${mt})`, body: fmtJson({ ...p, image: '[binary omitted]' }) };
    }
    if (type === 'file') {
      const mt = typeof p.mediaType === 'string' ? p.mediaType : 'file';
      return { kind: 'file', label: `file (${mt})`, body: fmtJson({ ...p, data: '[binary omitted]' }) };
    }
    return { kind: 'unknown', label: type, body: fmtJson(p) };
  });
}

// All collapsibles are <details>/<summary>. No inline JS — Chrome's MV3
// extension CSP (`script-src 'self'`) blocks both inline scripts AND inline
// event handlers on blob:chrome-extension:// URLs, so any `<script>` block
// or `onclick=""` would silently no-op when the report is opened from the
// Options page.
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px 24px;line-height:1.5}
h1{color:#e0936a;margin-bottom:4px;font-size:22px}
.sub{color:#8b949e;margin-bottom:20px;font-size:12px}
a{color:inherit;text-decoration:none}
summary{cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
.summary{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;margin-bottom:20px;display:flex;flex-wrap:wrap;gap:12px 28px}
.stat{display:flex;flex-direction:column;gap:1px}
.sv{font-size:24px;font-weight:700;color:#e0936a}
.sl{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.timeline{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-bottom:20px}
.timeline h2{font-size:12px;color:#8b949e;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
.tl-bar{display:flex;gap:2px;height:32px;border-radius:6px;overflow:hidden}
.tl-bar a{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#fff;cursor:pointer;transition:filter .15s}
.tl-bar a:hover{filter:brightness(1.3)}
.flow-section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px}
.flow-section h2{font-size:12px;color:#8b949e;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.flow-step{display:flex;align-items:flex-start;gap:10px;margin-bottom:6px;padding:6px 0}
.flow-num{background:#30363d;color:#c9d1d9;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
.flow-line{border-left:2px solid #30363d;margin-left:11px;padding-left:16px;padding-bottom:6px}
.flow-desc{font-size:13px;flex:1;min-width:0}
.flow-desc .tools{color:#fbbc04}
.flow-desc .timing{color:#8b949e;font-size:11px;margin-left:6px}
.flow-desc .err{color:#f85149}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:10px;overflow:hidden}
.card.is-error{border-color:#f8514966}
.card-head{padding:10px 14px;display:flex;align-items:center;gap:8px;user-select:none}
.card-head:hover{background:#1c2128}
.idx{background:#30363d;color:#c9d1d9;border-radius:4px;padding:1px 7px;font-weight:700;font-size:12px}
.badge{border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;background:#30363d;color:#c9d1d9}
.badge.b-ok{background:#22c55e22;color:#22c55e;border:1px solid #22c55e66}
.badge.b-err{background:#f8514922;color:#f85149;border:1px solid #f8514966}
.meta{font-size:11px;color:#8b949e;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.timing-badge{margin-left:auto;color:#e0936a;font-weight:700;font-size:14px}
.arrow{color:#484f58;transition:transform .2s;font-size:11px;display:inline-block}
details[open]>summary .arrow{transform:rotate(90deg)}
.card-body{border-top:1px solid #21262d}
.tok-bar{display:flex;gap:1px;height:20px;border-radius:4px;overflow:hidden;margin:8px 14px}
.tok-bar div{display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:#fff;min-width:30px}
.t-in{background:#1f6feb}.t-cache{background:#3fb950}.t-out{background:#fbbc04;color:#000}
.sect{border-bottom:1px solid #21262d}
.sect-head{padding:7px 14px;background:#0d1117;color:#8b949e;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;display:flex;align-items:center;gap:5px;user-select:none}
.sect-head:hover{color:#c9d1d9}
.sect-head .arrow{font-size:9px}
.sect-body{padding:8px 14px}
.msg{margin-bottom:8px;border:1px solid #21262d;border-radius:6px;overflow:hidden}
.msg-head{padding:5px 10px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;user-select:none}
.msg-head:hover{filter:brightness(1.15)}
.msg-head .arrow{font-size:9px;color:#8b949e}
.msg-body{padding:6px 10px;max-height:700px;overflow-y:auto}
.msg-user>.msg-head{background:#1a2332;color:#8ab4f8}
.msg-asst>.msg-head{background:#1a2b1a;color:#a9c47f}
.msg-system>.msg-head{background:#2b1a32;color:#c58af9}
.msg-tool>.msg-head{background:#2b1a1a;color:#f28b82}
.blk{margin-bottom:5px;padding:6px 8px;border-radius:4px;font-size:12px}
.blk-text{background:#0d1117;border:1px solid #21262d}
.blk-tool{background:#1c1917;border:1px solid #fbbc0444}
.blk-result{background:#0d1117;border:1px solid #21262d}
.blk-img{background:#1a1625;border:1px solid #c58af944;text-align:center}
.blk-thought{background:#15121f;border:1px solid #c58af944;color:#c4b5fd}
.blk-label{font-size:10px;color:#8b949e;margin-bottom:3px;font-weight:600}
pre{white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code',Consolas,monospace;font-size:11px;color:#c9d1d9;max-height:520px;overflow-y:auto}
.hl-bs{color:#a9c47f;font-weight:600}
.hl-sr{color:#fbbc04;font-weight:600}
.tool-call{margin-bottom:8px;border:1px solid #fbbc0444;border-radius:6px;background:#1c1917}
.tool-call.is-error{border-color:#f8514966}
.tc-head{padding:6px 10px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;user-select:none;color:#fbbc04}
.tool-call.is-error>.tc-head{color:#f85149}
.tc-head:hover{filter:brightness(1.2)}
.tc-body{padding:6px 10px}
.kv{display:flex;gap:8px;font-size:11px;color:#8b949e;margin-bottom:2px}
.kv b{color:#c9d1d9;font-weight:600;min-width:90px}
.resp-box{padding:10px 14px}
.resp-label{font-size:10px;color:#8b949e;margin-bottom:4px;font-weight:600;text-transform:uppercase}
.resp-text-box{background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;margin-bottom:8px}
.err-box{background:#2b1a1a;border:1px solid #f8514966;border-radius:6px;padding:10px 14px;margin:10px 14px;color:#f85149}
.empty{color:#484f58;font-style:italic;padding:14px;text-align:center;font-size:12px}
`;

function highlightTags(s: string): string {
  return s
    .replace(/(&lt;browser_state&gt;)/g, '<span class="hl-bs">$1</span>')
    .replace(/(&lt;\/browser_state&gt;)/g, '<span class="hl-bs">$1</span>')
    .replace(/(&lt;system-reminder&gt;)/g, '<span class="hl-sr">$1</span>')
    .replace(/(&lt;\/system-reminder&gt;)/g, '<span class="hl-sr">$1</span>');
}

function renderPart(part: MessagePartView): string {
  const label = `<div class="blk-label">${esc(part.label)}</div>`;
  const body = part.kind === 'text' ? highlightTags(esc(trunc(part.body))) : esc(trunc(part.body));
  const cls =
    part.kind === 'tool-call'
      ? 'blk blk-tool'
      : part.kind === 'tool-result'
        ? 'blk blk-result'
        : part.kind === 'reasoning'
          ? 'blk blk-thought'
          : part.kind === 'image' || part.kind === 'file'
            ? 'blk blk-img'
            : 'blk blk-text';
  return `<div class="${cls}">${label}<pre>${body}</pre></div>`;
}

function renderMessage(message: unknown, mi: number): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as { role?: string; content?: unknown };
  const role = typeof m.role === 'string' ? m.role : 'unknown';
  const cls =
    role === 'user'
      ? 'msg-user'
      : role === 'assistant'
        ? 'msg-asst'
        : role === 'tool'
          ? 'msg-tool'
          : role === 'system'
            ? 'msg-system'
            : 'msg-asst';
  const parts = partsFromContent(m.content);
  const summary = parts.map(p => p.kind).join(' · ');
  return [
    `<details class="msg ${cls}">`,
    `<summary class="msg-head">`,
    `<span class="arrow">▶</span>`,
    `<span>messages[${mi}] ${esc(role)} (${parts.length} parts)</span>`,
    `<span style="color:#8b949e;font-size:10px;margin-left:auto">${esc(summary)}</span>`,
    `</summary>`,
    `<div class="msg-body">${parts.map(renderPart).join('')}</div>`,
    `</details>`,
  ].join('');
}

function aggregate(transcripts: TranscriptDTO[]) {
  const totalTime = transcripts.reduce((s, t) => s + ((t.endedAt ?? t.startedAt) - t.startedAt), 0);
  const totalIn = transcripts.reduce((s, t) => s + (t.usage?.inputTokens ?? 0), 0);
  const totalOut = transcripts.reduce((s, t) => s + (t.usage?.outputTokens ?? 0), 0);
  const totalCache = transcripts.reduce((s, t) => s + (t.usage?.cachedInputTokens ?? 0), 0);
  const errors = transcripts.filter(t => t.error || t.finishReason === 'error').length;
  const toolCallCount = transcripts.reduce((s, t) => s + t.toolCalls.length, 0);
  return { totalTime, totalIn, totalOut, totalCache, errors, toolCallCount };
}

export function buildConversationReportHtml(opts: {
  conversationId: string;
  title: string;
  transcripts: TranscriptDTO[];
}): string {
  const { conversationId, title, transcripts } = opts;
  const totals = aggregate(transcripts);
  const generatedAt = new Date().toISOString();

  let h = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>doeverything Conversation Report</title><style>${CSS}</style></head><body>`;
  h += `<h1>doeverything Conversation Report</h1>`;
  h += `<p class="sub">${esc(generatedAt)} &mdash; ${esc(title)} &mdash; ${transcripts.length} turn${transcripts.length === 1 ? '' : 's'} &mdash; conversation <code>${esc(conversationId)}</code></p>`;

  // ── Top-of-page summary ─────────────────────────────────────────────────
  h += `<div class="summary">`;
  h += `<div class="stat"><div class="sv">${transcripts.length}</div><div class="sl">Turns</div></div>`;
  h += `<div class="stat"><div class="sv">${(totals.totalTime / 1000).toFixed(1)}s</div><div class="sl">Total Time</div></div>`;
  h += `<div class="stat"><div class="sv">${totals.toolCallCount}</div><div class="sl">Tool Calls</div></div>`;
  h += `<div class="stat"><div class="sv">${totals.errors}</div><div class="sl">Errors</div></div>`;
  h += `<div class="stat"><div class="sv">${totals.totalIn.toLocaleString()}</div><div class="sl">Input Tokens</div></div>`;
  h += `<div class="stat"><div class="sv">${totals.totalCache.toLocaleString()}</div><div class="sl">Cached Tokens</div></div>`;
  h += `<div class="stat"><div class="sv">${totals.totalOut.toLocaleString()}</div><div class="sl">Output Tokens</div></div>`;
  h += `</div>`;

  if (transcripts.length === 0) {
    h += `<div class="empty">No transcripts captured yet for this conversation. Run a new turn after the Rapor button was wired in to populate it.</div>`;
    h += `</body></html>`;
    return h;
  }

  // ── Timeline ───────────────────────────────────────────────────────────
  // Each segment is an anchor that scrolls to the matching turn card. Cards
  // stay in their default state — we don't try to auto-open a target via CSS
  // because <details>'s `open` attribute can't be toggled by `:target`.
  h += `<div class="timeline"><h2>Turn Timeline</h2><div class="tl-bar">`;
  transcripts.forEach((t, i) => {
    const ms = (t.endedAt ?? t.startedAt) - t.startedAt;
    const isErr = !!t.error || t.finishReason === 'error';
    const bg = isErr ? '#f85149' : '#e0936a';
    h += `<a href="#turn${i}" style="flex:${Math.max(ms, 100)};background:${bg}" title="#${i + 1} ${ms}ms">#${i + 1}</a>`;
  });
  h += `</div></div>`;

  // ── Execution flow ─────────────────────────────────────────────────────
  h += `<div class="flow-section"><h2>Execution Flow</h2>`;
  transcripts.forEach((t, i) => {
    const ms = (t.endedAt ?? t.startedAt) - t.startedAt;
    const tools = t.toolCalls.map(c => c.name).join(', ');
    const errCount = t.toolCalls.filter(c => c.isError).length;
    const stop = t.finishReason || (t.error ? 'error' : '?');
    h += `<a class="flow-step" href="#turn${i}" style="display:flex;text-decoration:none">`;
    h += `<div class="flow-num">${i + 1}</div>`;
    h += `<div class="flow-desc">`;
    h += `<b>${esc(t.model || t.provider || '?')}</b>`;
    h += ` &mdash; ${t.toolCalls.length} tool call${t.toolCalls.length === 1 ? '' : 's'}`;
    if (tools) h += ` → <span class="tools">${esc(tools)}</span>`;
    if (errCount > 0) h += ` <span class="err">(${errCount} error${errCount === 1 ? '' : 's'})</span>`;
    h += ` <span class="timing">[${ms}ms · finish=${esc(stop)} · in:${t.usage?.inputTokens ?? 0} cache:${t.usage?.cachedInputTokens ?? 0} out:${t.usage?.outputTokens ?? 0}]</span>`;
    h += `</div></a>`;
    if (i < transcripts.length - 1) h += `<div class="flow-line"></div>`;
  });
  h += `</div>`;

  // ── Per-turn cards ─────────────────────────────────────────────────────
  // The first card opens by default so the user always sees something on
  // load; subsequent cards stay collapsed. Browser-native <details>/<summary>
  // is used throughout — Chrome's MV3 extension CSP (`script-src 'self'`)
  // forbids the inline JS and onclick attributes a click-handler approach
  // would need on a blob:chrome-extension URL.
  transcripts.forEach((t, i) => {
    const ms = (t.endedAt ?? t.startedAt) - t.startedAt;
    const isErr = !!t.error || t.finishReason === 'error';
    const messages = Array.isArray(t.messages) ? (t.messages as unknown[]) : [];
    const cardOpen = i === 0 ? ' open' : '';

    h += `<details class="card${isErr ? ' is-error' : ''}" id="turn${i}"${cardOpen}>`;
    h += `<summary class="card-head">`;
    h += `<span class="idx">#${i + 1}</span>`;
    h += `<span class="badge ${isErr ? 'b-err' : 'b-ok'}">${esc(t.finishReason || (isErr ? 'error' : '?'))}</span>`;
    h += `<span class="meta">${esc(t.provider || '?')}/${esc(t.model || '?')} · ${messages.length} msgs · ${t.toolCalls.length} tool calls · ${new Date(t.startedAt).toLocaleString()}</span>`;
    h += `<span class="timing-badge">${ms}ms</span>`;
    h += `<span class="arrow">▶</span>`;
    h += `</summary><div class="card-body">`;

    // Token bar
    const tokIn = t.usage?.inputTokens ?? 0;
    const tokOut = t.usage?.outputTokens ?? 0;
    const tokCache = t.usage?.cachedInputTokens ?? 0;
    if (tokIn + tokOut + tokCache > 0) {
      h += `<div class="tok-bar">`;
      if (tokIn) h += `<div class="t-in" style="flex:${tokIn}" title="Input ${tokIn}">in:${tokIn}</div>`;
      if (tokCache)
        h += `<div class="t-cache" style="flex:${tokCache}" title="Cached ${tokCache}">cache:${tokCache}</div>`;
      if (tokOut) h += `<div class="t-out" style="flex:${tokOut}" title="Output ${tokOut}">out:${tokOut}</div>`;
      h += `</div>`;
    }

    // Inline error
    if (t.error) {
      h += `<div class="err-box">`;
      h += `<div class="blk-label">${esc(t.error.type || 'Error')}${t.error.statusCode ? ` (HTTP ${t.error.statusCode})` : ''}</div>`;
      h += `<pre>${esc(t.error.message)}</pre>`;
      if (t.error.responseBody)
        h += `<div class="blk-label" style="margin-top:6px">Response body</div><pre>${esc(t.error.responseBody)}</pre>`;
      h += `</div>`;
    }

    // ── Request: System prompt ──
    if (t.system) {
      h += `<details class="sect">`;
      h += `<summary class="sect-head"><span class="arrow">▶</span> System Prompt (${fmtBytes(t.system.length)})</summary>`;
      h += `<div class="sect-body"><pre>${highlightTags(esc(trunc(t.system, 60000)))}</pre></div>`;
      h += `</details>`;
    }

    // ── Request: Tools ──
    if (t.tools && t.tools.length > 0) {
      const names = t.tools.map(x => x.name).join(', ');
      h += `<details class="sect">`;
      h += `<summary class="sect-head"><span class="arrow">▶</span> Tool Roster (${t.tools.length}): ${esc(names)}</summary>`;
      h += `<div class="sect-body">`;
      for (const tool of t.tools) {
        h += `<div class="kv"><b>${esc(tool.name)}</b><span>${esc(tool.description || '(no description)')}</span></div>`;
      }
      h += `</div></details>`;
    }

    // ── Request: Messages ──
    if (messages.length > 0) {
      h += `<details class="sect" open>`;
      h += `<summary class="sect-head"><span class="arrow">▶</span> Request Messages (${messages.length})</summary>`;
      h += `<div class="sect-body">`;
      messages.forEach((m, mi) => {
        h += renderMessage(m, mi);
      });
      h += `</div></details>`;
    }

    // ── Response: Tool calls (with args + results) ──
    if (t.toolCalls.length > 0) {
      h += `<details class="sect" open>`;
      h += `<summary class="sect-head"><span class="arrow">▶</span> Tool Calls (${t.toolCalls.length})</summary>`;
      h += `<div class="sect-body">`;
      t.toolCalls.forEach((tc, ti) => {
        const dur = tc.startedAt && tc.endedAt ? `${tc.endedAt - tc.startedAt}ms` : '';
        h += `<details class="tool-call${tc.isError ? ' is-error' : ''}">`;
        h += `<summary class="tc-head">`;
        h += `<span class="arrow">▶</span>`;
        h += `<span>[${ti + 1}] ${esc(tc.name)}${tc.isError ? ' · ERROR' : ''}</span>`;
        if (dur) h += `<span style="color:#8b949e;font-size:10px;margin-left:auto">${dur}</span>`;
        h += `</summary><div class="tc-body">`;
        h += `<div class="blk-label">args</div><pre>${esc(trunc(fmtJson(tc.args)))}</pre>`;
        if (tc.result !== undefined) {
          h += `<div class="blk-label" style="margin-top:6px">result${tc.isError ? ' (error)' : ''}</div><pre>${esc(trunc(fmtJson(tc.result)))}</pre>`;
        }
        h += `</div></details>`;
      });
      h += `</div></details>`;
    }

    // ── Response: Assistant text ──
    h += `<div class="resp-box">`;
    h += `<div class="resp-label">Reconstructed Response (finish=${esc(t.finishReason || '?')})</div>`;
    if (t.responseText) {
      h += `<div class="resp-text-box">`;
      h += `<div class="blk-label">Assistant text (${t.responseText.length.toLocaleString()} chars)</div>`;
      h += `<pre>${esc(trunc(t.responseText, 60000))}</pre>`;
      h += `</div>`;
    }
    if (!t.responseText && t.toolCalls.length === 0) {
      h += `<div style="color:#484f58;font-size:12px">(no assistant text or tool calls captured)</div>`;
    }
    h += `</div>`;

    h += `</div></details>`; // card-body, card
  });

  h += `</body></html>`;
  return h;
}
