import { Button, cn, BrandLogo, BrandMark } from '@doeverything/ui';
import { MarkdownBlock } from '@src/components/AssistantBlocks';
import { ImageLightbox } from '@src/components/ImageLightbox';
import ReactJsonView from '@uiw/react-json-view';
import {
  ArrowDown,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCode2,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Highlight, themes as prismThemes } from 'prism-react-renderer';
import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage, MessagePart } from '@src/stores/chat-store';

/**
 * Beyond this many messages only the most recent slice renders; the rest
 * collapse behind a "Show earlier messages" pill. Purely a render concern —
 * the full history still lives in the store and is still sent to the SW.
 */
const HISTORY_RENDER_CAP = 150;

interface MessageListProps {
  messages: ChatMessage[];
  /**
   * True whenever the agent is actively working on the current turn —
   * `submitting` (waiting on first token), `streaming` (text/deltas), OR
   * `awaiting-tool` (a tool is mid-flight). This is deliberately broader than
   * the store's `streaming` status: the agent spends most of a turn in
   * `submitting`/`awaiting-tool`, so gating the "Thinking…" / working-chip
   * activity on `status === 'streaming'` alone left the panel looking frozen.
   */
  busy: boolean;
  /** Open the save-as-action modal prefilled with a single user message's text. */
  onSaveMessageAsAction?: (prompt: string) => void;
}

/**
 * Chat surface — modeled after ChatGPT's conversation pane.
 *
 *   - Assistant messages: no bubble. Text flows directly on the page
 *     background, full content width. A small action bar (copy) appears
 *     under each assistant message on hover.
 *   - User messages: a compact, right-aligned bubble with subtle muted
 *     background, never wider than ~75% of the column.
 *   - Streaming caret: a thin block-shaped cursor appears after the last
 *     character while text is mid-flight.
 *   - Empty state: large centered greeting + four sample prompts in a 2×2
 *     grid that one-click into the composer.
 */
export function MessageList({ messages, busy, onSaveMessageAsAction }: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (pinned) el.scrollTop = el.scrollHeight;
  }, [messages, busy, pinned]);

  // New conversation → collapse history again.
  useEffect(() => {
    if (messages.length === 0) setShowAll(false);
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom < 80);
  };

  const scrollToBottom = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setPinned(true);
  };

  if (messages.length === 0) {
    return <EmptyState />;
  }

  const visible = showAll ? messages : messages.slice(-HISTORY_RENDER_CAP);
  const hiddenCount = messages.length - visible.length;

  const expandHistory = () => {
    // Preserve the visual position: measure how much taller the scroller
    // gets and shift scrollTop by the delta (the user is scrolled up, so
    // pinning logic doesn't help here).
    const el = scrollerRef.current;
    const before = el?.scrollHeight ?? 0;
    setShowAll(true);
    requestAnimationFrame(() => {
      const after = el?.scrollHeight ?? 0;
      if (el) el.scrollTop += after - before;
    });
  };

  // Identify the *last* assistant message that is still streaming so we can
  // attach a caret to its tail without affecting earlier ones.
  const lastAssistantIdx = (() => {
    for (let i = visible.length - 1; i >= 0; i--) if (visible[i].role === 'assistant') return i;
    return -1;
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-7">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={expandHistory}
              className="border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground shadow-soft mx-auto rounded-full border px-3 py-1 text-xs transition-colors duration-150">
              Show {hiddenCount} earlier message{hiddenCount === 1 ? '' : 's'}
            </button>
          )}
          {visible.map((message, idx) => (
            // content-visibility skips layout/paint (incl. base64 image
            // decode) for offscreen rows; the last row stays unconstrained
            // so streaming growth never causes bottom layout shift.
            <div key={message.id} className={idx === visible.length - 1 ? undefined : 'de-msg-row'}>
              <MessageRow
                message={message}
                isLastAssistantStreaming={busy && idx === lastAssistantIdx && message.role === 'assistant'}
                onSaveMessageAsAction={onSaveMessageAsAction}
              />
            </div>
          ))}
        </div>
      </div>
      {!pinned && (
        <Button
          size="icon"
          variant="outline"
          onClick={scrollToBottom}
          className="bg-background shadow-lifted absolute bottom-3 right-3 h-8 w-8 rounded-full"
          aria-label="Scroll to latest">
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="de-glow relative flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-6 pb-24 text-center">
      <div className="de-grain pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col items-center gap-3">
        <div className="de-fade-up flex flex-col items-center gap-2">
          <BrandMark size={56} pulsing />
          <span className="select-none text-base font-medium tracking-tight">
            doeverythi<span className="text-primary">ng</span>
          </span>
        </div>
        <h1 className="de-fade-up text-2xl font-semibold tracking-tight" style={{ animationDelay: '40ms' }}>
          How can I help you today?
        </h1>
        <p
          className="de-fade-up text-muted-foreground max-w-sm text-sm"
          style={{ animationDelay: '80ms' }}>
          Ask doeverything to do something on the web — open pages, extract data, fill forms, automate flows.
        </p>
      </div>
    </div>
  );
}

// Memoized: store mutations preserve the identity of untouched messages
// (every updater maps with `m.id !== id ? m : …`), so during streaming only
// the active row re-renders — not the whole history on every delta.
const MessageRow = memo(function MessageRow({
  message,
  isLastAssistantStreaming,
  onSaveMessageAsAction,
}: {
  message: ChatMessage;
  isLastAssistantStreaming: boolean;
  onSaveMessageAsAction?: (prompt: string) => void;
}) {
  if (message.role === 'user') return <UserMessage message={message} onSaveAsAction={onSaveMessageAsAction} />;
  return <AssistantMessage message={message} streaming={isLastAssistantStreaming} />;
});

/** Pull the plain-text body out of a message — used by copy + save-as-action. */
function extractText(message: ChatMessage): string {
  return message.parts
    .filter((p): p is TextPart => p.kind === 'text')
    .map(p => p.text)
    .join('\n')
    .trim();
}

function UserMessage({
  message,
  onSaveAsAction,
}: {
  message: ChatMessage;
  onSaveAsAction?: (prompt: string) => void;
}) {
  const text = extractText(message);
  return (
    <div className="de-fade-up group flex flex-col items-end gap-1">
      <div className="bg-secondary text-secondary-foreground max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed">
        {message.parts.map((part, idx) => (
          <PartView key={idx} part={part} isUser />
        ))}
      </div>
      {text.length > 0 && <UserActionBar text={text} onSaveAsAction={onSaveAsAction} />}
    </div>
  );
}

function UserActionBar({ text, onSaveAsAction }: { text: string; onSaveAsAction?: (prompt: string) => void }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be denied; ignore
    }
  };

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy message"
        className="text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {onSaveAsAction && (
        <button
          type="button"
          onClick={() => onSaveAsAction(text)}
          aria-label="Save as action"
          className="text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs">
          <CalendarPlus className="h-3.5 w-3.5" />
          Save as action
        </button>
      )}
    </div>
  );
}

type ToolCallPart = Extract<MessagePart, { kind: 'tool_call' }>;
type TextPart = Extract<MessagePart, { kind: 'text' }>;

interface SplitResult {
  /** Everything that should sit inside the collapsible "Working" chip. */
  workingParts: MessagePart[];
  /** The user-facing message — rendered as inline markdown after the chip. */
  finalText: string;
  /** True when the agent reached the explicit completion marker (`done` tool). */
  hasDone: boolean;
}

/**
 * Split a streaming assistant message into chain-of-thought (collapsible) +
 * the user-facing answer (inline). Mirrors ChatGPT / Claude.ai behaviour:
 *
 *   pure Q&A          : text streams inline as it arrives.
 *   tool-using turn   : working chip stays expanded with live updates until
 *                       `done` arrives, then chip auto-collapses and the
 *                       deliberate `done.text` reply appears inline.
 *
 * The two streaming behaviours are separated so a tool-using turn doesn't
 * flicker — text emitted between tool calls is reasoning, not an answer, and
 * must NEVER hop in and out of the chip as more parts stream in.
 */
function splitAssistantMessage(parts: MessagePart[], streaming: boolean): SplitResult {
  // Locate the agent's explicit completion marker. Search from the end so a
  // model that emits `done` mid-stream and keeps writing afterwards still
  // resolves to the last completion.
  let doneIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === 'tool_call' && p.toolName === 'done') {
      doneIdx = i;
      break;
    }
  }

  if (doneIdx >= 0) {
    const donePart = parts[doneIdx] as ToolCallPart;
    const args = donePart.args as { text?: string; success?: boolean } | undefined;
    let finalText = (args?.text ?? '').trim();
    // Some models leave `done.text` empty and emit the final prose as a text
    // part right before `done`. Fall back to that text run.
    if (!finalText) {
      for (let i = doneIdx - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === 'tool_call') break;
        if (p.kind === 'text' && p.text.trim()) {
          finalText = p.text.trim();
          break;
        }
      }
    }
    return { workingParts: parts, finalText, hasDone: true };
  }

  const hasAnyTool = parts.some(p => p.kind === 'tool_call');

  // While the run is still mid-stream and we're in a tool-using flow, EVERY
  // part is working trace until `done` materialises. This is the load-bearing
  // rule that prevents flicker: text between tool calls never momentarily
  // renders as "the answer" and then jumps into the chip when the next tool
  // arrives.
  if (streaming && hasAnyTool) {
    return { workingParts: parts, finalText: '', hasDone: false };
  }

  // Pure text streaming (simple Q&A, no tools yet) — render inline as it
  // streams. ChatGPT/Claude do the same: a non-tool reply types into the chat
  // immediately rather than appearing inside a "working" disclosure.
  if (!hasAnyTool) {
    const allText = parts
      .filter((p): p is TextPart => p.kind === 'text')
      .map(p => p.text)
      .join('\n\n')
      .trim();
    return { workingParts: [], finalText: allText, hasDone: false };
  }

  // Stream ended without `done` (aborted / max-steps / model just stopped).
  // Best fallback: trailing text after the last tool call is the answer.
  let lastToolIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].kind === 'tool_call') {
      lastToolIdx = i;
      break;
    }
  }
  const trailing = parts
    .slice(lastToolIdx + 1)
    .filter((p): p is TextPart => p.kind === 'text')
    .map(p => p.text)
    .join('\n\n')
    .trim();
  return {
    workingParts: parts.slice(0, lastToolIdx + 1),
    finalText: trailing,
    hasDone: false,
  };
}

/**
 * Render an assistant turn the way ChatGPT/Claude do: a single collapsible
 * "Worked for…" disclosure for the chain-of-thought, plus the user-facing
 * answer rendered inline below it. The disclosure stays expanded while the
 * agent is mid-thought (so the user can watch progress) and auto-collapses
 * the moment a final answer materialises.
 */
function AssistantMessage({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const { workingParts, finalText, hasDone } = splitAssistantMessage(message.parts, streaming);

  const tools = workingParts.filter((p): p is ToolCallPart => p.kind === 'tool_call');
  const runningTool = tools.find(t => t.status === 'running');
  const errorCount = tools.filter(t => t.status === 'error').length;
  const hasFinal = finalText.length > 0;
  // The agent is still "working" while the run is streaming AND we don't yet
  // have a final answer to show. Once `finalText` is present (or `done`
  // arrived), we flip to the collapsed "Worked through N steps" header.
  const isWorkingActive = streaming && !hasFinal && !hasDone;
  // "Has any visible content yet?" is the gate for the very-first-tokens
  // typing-dots indicator. Empty text parts (placeholders before any delta)
  // do NOT count.
  const hasAnyContent =
    tools.length > 0 || workingParts.some(p => p.kind === 'text' && p.text.trim().length > 0) || hasFinal;

  return (
    <div className="de-fade-up group flex flex-col gap-2">
      {workingParts.length > 0 && (
        <WorkingChip
          parts={workingParts}
          toolCount={tools.length}
          errorCount={errorCount}
          runningToolName={runningTool ? displayToolLabel(runningTool.toolName, runningTool.args) : undefined}
          active={isWorkingActive}
          hasFinal={hasFinal || hasDone}
        />
      )}
      {hasFinal && (
        <div className="text-foreground text-[15px] leading-relaxed">
          <MarkdownBlock text={finalText} />
        </div>
      )}
      {/* Pre-content placeholder: only when the run just started and nothing
          meaningful (no tool, no real text, no final answer) has appeared. */}
      {!hasAnyContent && streaming && <ThinkingIndicator />}
      {hasFinal && !streaming && <AssistantActionBar text={finalText} />}
    </div>
  );
}

/**
 * Collapsible "Worked for…" chip — single anchor for everything the agent
 * did *before* its final answer. Expanded while the agent is still working
 * (so the user can watch progress); auto-collapses the moment the final
 * answer starts streaming. User can re-expand any time.
 */
function WorkingChip({
  parts,
  toolCount,
  errorCount,
  runningToolName,
  active,
  hasFinal,
}: {
  parts: MessagePart[];
  toolCount: number;
  errorCount: number;
  runningToolName?: string;
  active: boolean;
  hasFinal: boolean;
}) {
  // Mirror ChatGPT/Claude: stay expanded while still working, collapse once
  // the final answer arrives. The user controls it after that — the manual
  // toggle takes over from the auto-close.
  const [open, setOpen] = useState(!hasFinal);
  const [userTouched, setUserTouched] = useState(false);
  useEffect(() => {
    if (userTouched) return;
    if (hasFinal) setOpen(false);
    else if (active) setOpen(true);
  }, [hasFinal, active, userTouched]);

  let summary: string;
  if (active && runningToolName) summary = `Running ${runningToolName}…`;
  else if (active) summary = 'Thinking…';
  else if (errorCount > 0) summary = `${toolCount} step${toolCount === 1 ? '' : 's'} · ${errorCount} failed`;
  else summary = `Worked through ${toolCount} step${toolCount === 1 ? '' : 's'}`;

  return (
    <details
      open={open}
      onToggle={e => {
        const nowOpen = e.currentTarget.open;
        setOpen(nowOpen);
        setUserTouched(true);
      }}
      className={cn(
        'group/working rounded-lg border text-xs transition-colors duration-300',
        // A faint terracotta wash + brand-tinted border while the agent is
        // mid-thought visually separates "working" from a settled summary.
        active ? 'border-primary/30 bg-primary/[0.04]' : 'border-border/60 bg-muted/30',
        '[&>summary::-webkit-details-marker]:hidden [&>summary]:list-none',
      )}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2">
        <ChevronRight
          className="text-muted-foreground h-3 w-3 shrink-0 transition-transform duration-150 group-open/working:rotate-90"
          aria-hidden="true"
        />
        {active ? (
          <LiveBeacon />
        ) : errorCount > 0 ? (
          <XCircle className="text-destructive h-3.5 w-3.5 shrink-0" />
        ) : (
          <Sparkles className="text-primary/70 h-3.5 w-3.5 shrink-0" />
        )}
        <span className={cn('truncate', active ? 'de-shimmer font-medium' : 'text-muted-foreground')}>
          {summary}
        </span>
      </summary>
      <div className="border-border/40 flex flex-col gap-2 border-t px-3 py-2 text-[13px] leading-relaxed">
        {parts.map((part, idx) => {
          // Skip empty text placeholders so they don't leave a phantom gap.
          // Each real step slides up on mount — the live trace of progress is
          // what keeps the panel from looking frozen during long tool calls.
          if (part.kind === 'text' && !part.text.trim()) return null;
          return (
            <div key={idx} className="animate-slide-in-bottom">
              <PartView part={part} isUser={false} />
            </div>
          );
        })}
      </div>
    </details>
  );
}

function AssistantActionBar({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be denied; ignore
    }
  };

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy message"
        className="text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        aria-label="Regenerate (coming soon)"
        disabled
        className="text-muted-foreground/50 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs">
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PartView({ part, isUser, showCaret }: { part: MessagePart; isUser: boolean; showCaret?: boolean }) {
  if (part.kind === 'text') {
    if (isUser) {
      return <span>{part.text}</span>;
    }
    // Empty/whitespace text parts are placeholders — `startAssistantStream`
    // seeds an empty text part before any delta arrives, and the model often
    // emits a tool call before emitting any text. Returning null prevents the
    // bouncy typing dots from sticking around inside the working chip after
    // each tool call. The "is the agent thinking?" indicator is owned at the
    // turn level (see AssistantMessage), not per-part.
    if (!part.text.trim()) return null;
    return <MarkdownWithCaret text={part.text} caret={showCaret ?? false} />;
  }
  if (part.kind === 'image') {
    return <InlineImage dataUrl={part.dataUrl} alt={part.name} />;
  }
  return <ToolCallChip part={part} />;
}

/**
 * Inline image thumbnail rendered inside a chat bubble. Click expands to
 * the shared fullscreen `ImageLightbox` (portaled — see ImageLightbox.tsx
 * for the containing-block rationale). Sized to ~280 px max width with
 * `object-contain` so a portrait phone screenshot keeps its aspect
 * ratio. Multiple images in a single message stack via the surrounding
 * bubble's `whitespace-pre-wrap` flow.
 */
function InlineImage({ dataUrl, alt }: { dataUrl: string; alt?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Expand image"
        className="border-border/60 shadow-soft my-1 block max-w-[280px] cursor-zoom-in overflow-hidden rounded-xl border transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <img src={dataUrl} alt={alt ?? ''} className="block h-auto w-full" draggable={false} />
      </button>
      {expanded && <ImageLightbox preview={dataUrl} onClose={() => setExpanded(false)} />}
    </>
  );
}

/** Markdown body with an optional streaming caret pinned to the very end. */
function MarkdownWithCaret({ text, caret }: { text: string; caret: boolean }) {
  return (
    <div className="relative">
      <MarkdownBlock text={text} />
      {caret && (
        <span
          aria-hidden="true"
          className="bg-foreground ml-0.5 inline-block h-4 w-1.5 -translate-y-0.5 animate-pulse align-middle"
        />
      )}
    </div>
  );
}

function ToolCallChip({ part }: { part: Extract<MessagePart, { kind: 'tool_call' }> }) {
  const Icon = part.status === 'running' ? Loader2 : part.status === 'error' ? XCircle : CheckCircle2;
  const jsExec = extractJavaScriptExec(part);
  const multiAction = extractMultiAction(part);
  const hasDetails =
    jsExec !== null ||
    multiAction !== null ||
    part.args !== undefined ||
    (part.result !== undefined && part.status !== 'running');

  // Everything starts collapsed. The chip header alone tells the story —
  // tool name + status + a hint like "12 lines" / "3 steps" — so a tool-heavy
  // turn stays scannable instead of dumping raw code, args and JSON payloads
  // into the chat. The user opens a chip when they actually want the details.
  const [open, setOpen] = useState(false);

  // Summary text on the right side of the header. JS exec → line count;
  // multi_action → "N steps"; everything else → status word.
  const summary = jsExec
    ? `${jsExec.lineCount} line${jsExec.lineCount === 1 ? '' : 's'} · ${part.status === 'running' ? 'Running…' : part.status === 'error' ? 'Failed' : 'Done'}`
    : multiAction
      ? `${multiAction.steps.length} step${multiAction.steps.length === 1 ? '' : 's'} · ${part.status === 'running' ? 'Running…' : part.status === 'error' ? 'Failed' : 'Done'}`
      : part.status === 'running'
        ? 'Running…'
        : part.status === 'error'
          ? 'Failed'
          : 'Done';

  // Inline pill — matches the "Searching the web…" affordance ChatGPT/Claude
  // use for tool invocations. Click to disclose args + result.
  return (
    <details
      open={open}
      onToggle={e => setOpen(e.currentTarget.open)}
      className={cn(
        'group/tool bg-card my-2 rounded-lg border text-xs transition-colors duration-150',
        part.status === 'running'
          ? 'border-primary/30 bg-primary/[0.04]'
          : part.status === 'error'
            ? 'border-destructive/25 bg-destructive/5'
            : 'border-border/60',
        '[&>summary::-webkit-details-marker]:hidden [&>summary]:list-none',
      )}>
      <summary
        className={cn(
          'flex items-center gap-2 px-3 py-2',
          hasDetails ? 'cursor-pointer select-none' : 'cursor-default',
        )}>
        <ChevronRight
          className={cn(
            'text-muted-foreground h-3 w-3 shrink-0 transition-transform duration-150',
            'group-open/tool:rotate-90',
            !hasDetails && 'opacity-0',
          )}
          aria-hidden="true"
        />
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            part.status === 'running' && 'text-primary animate-spin',
            part.status === 'error' && 'text-destructive',
            part.status === 'done' && 'text-muted-foreground',
          )}
        />
        <span className="text-foreground truncate font-mono text-[12px]">
          {displayToolLabel(part.toolName, part.args)}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">{summary}</span>
      </summary>
      {hasDetails && (
        <div className="border-border/40 flex flex-col gap-1.5 border-t px-3 py-2">
          {jsExec ? (
            <>
              <JsCodeView code={jsExec.code} />
              {jsExec.extraArgs && <ToolArgs args={jsExec.extraArgs} />}
            </>
          ) : multiAction ? (
            <MultiActionView steps={multiAction.steps} runStatus={part.status} />
          ) : (
            <ToolArgs args={filterDisplayArgs(part.toolName, part.args)} />
          )}
          {!multiAction && part.result !== undefined && part.status !== 'running' && (
            <ToolResult result={part.result} />
          )}
        </div>
      )}
    </details>
  );
}

/**
 * Derive the human-facing tool name from `(toolName, args)`. The
 * `computer` tool is a dispatcher whose actual behaviour lives in
 * `args.action` (`left_click`, `type`, `screenshot`, …); showing
 * "computer" in the chip header tells the user nothing useful. Surface
 * the action name instead so the user immediately knows what happened.
 * All other tools display their own name as-is.
 */
function displayToolLabel(toolName: string, args: unknown): string {
  if (toolName === 'computer' && args !== null && typeof args === 'object') {
    const action = (args as Record<string, unknown>).action;
    if (typeof action === 'string' && action.length > 0) return action;
  }
  return toolName;
}

/**
 * Drop the now-redundant `action` field from `computer` args before
 * passing them to `ToolArgs` — the action has already been promoted into
 * the header by `displayToolLabel`. Other tools pass through untouched.
 */
function filterDisplayArgs(toolName: string, args: unknown): unknown {
  if (toolName !== 'computer') return args;
  if (args === null || typeof args !== 'object') return args;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (k === 'action') continue;
    rest[k] = v;
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * Pull the JavaScript payload out of a `run_js` call. Returns the code,
 * line count, and any unrelated args (`tabId`, `appendToBucket`,
 * `readBucket`) so the caller can render those separately. Returns null
 * for other tools.
 */
function extractJavaScriptExec(
  part: Extract<MessagePart, { kind: 'tool_call' }>,
): { code: string; lineCount: number; extraArgs: Record<string, unknown> | null } | null {
  if (part.toolName !== 'run_js') return null;
  if (!part.args || typeof part.args !== 'object') return null;
  const args = part.args as Record<string, unknown>;
  if (typeof args.text !== 'string') return null;
  const { text: _text, ...rest } = args;
  void _text;
  const extraArgs = Object.keys(rest).length > 0 ? rest : null;
  return { code: args.text, lineCount: args.text.split('\n').length, extraArgs };
}

/**
 * Pull the action list out of a `multi_action` call. Returns each step's
 * tool name, input, and (when available) the status / result for that
 * specific sub-action — recovered from the tool result's `actions` array
 * which `multi_action.execute` populates per item.
 */
type MultiActionStep = {
  name: string;
  input: Record<string, unknown> | null;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: unknown;
  error?: string;
};

function extractMultiAction(
  part: Extract<MessagePart, { kind: 'tool_call' }>,
): { steps: MultiActionStep[] } | null {
  if (part.toolName !== 'multi_action') return null;
  if (!part.args || typeof part.args !== 'object') return null;
  const args = part.args as Record<string, unknown>;
  const actions = args.actions;
  if (!Array.isArray(actions)) return null;

  // Pair each declared action with whatever the tool result says about
  // its execution. `multi_action` returns `{ actions: [{name, ok,
  // output?, error?}] }`; while the call is in-flight we have no result
  // yet, so every step shows as `pending`.
  const resultActions: Array<{ name?: unknown; ok?: unknown; output?: unknown; error?: unknown }> =
    part.result !== undefined &&
    part.result !== null &&
    typeof part.result === 'object' &&
    Array.isArray((part.result as { actions?: unknown }).actions)
      ? (((part.result as { actions: unknown }).actions) as Array<{
          name?: unknown;
          ok?: unknown;
          output?: unknown;
          error?: unknown;
        }>)
      : [];

  const steps: MultiActionStep[] = actions.map((raw, i) => {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = typeof a.name === 'string' ? a.name : '(unknown)';
    const input = a.input && typeof a.input === 'object' ? (a.input as Record<string, unknown>) : null;
    const r = resultActions[i];
    let status: MultiActionStep['status'];
    let output: unknown;
    let error: string | undefined;
    if (r === undefined) {
      // Still running — actions before the current cursor are done in
      // the live result, after it are pending. We only know whether the
      // call as a whole is running, not which specific step, so all
      // unfinished ones stay `pending`.
      status = part.status === 'running' ? 'pending' : 'pending';
    } else {
      const ok = r.ok === true;
      status = ok ? 'done' : 'error';
      output = r.output;
      if (typeof r.error === 'string') error = r.error;
    }
    return { name, input, status, output, error };
  });

  return { steps };
}

function MultiActionView({
  steps,
  runStatus,
}: {
  steps: MultiActionStep[];
  runStatus: 'running' | 'done' | 'error';
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, idx) => {
        // Live-cursor: while the whole call is running, the first
        // pending step is the one currently in flight. Mark it visually.
        const isCurrent =
          runStatus === 'running' &&
          step.status === 'pending' &&
          steps.slice(0, idx).every(s => s.status !== 'pending');
        const StepIcon =
          step.status === 'done'
            ? CheckCircle2
            : step.status === 'error'
              ? XCircle
              : isCurrent
                ? Loader2
                : ChevronRight;
        const stepTone =
          step.status === 'done'
            ? 'text-muted-foreground'
            : step.status === 'error'
              ? 'text-destructive'
              : isCurrent
                ? 'text-primary'
                : 'text-muted-foreground/60';
        // Promote `computer`'s sub-action into the step label and strip
        // it from the input preview so users see e.g. `1. left_click` +
        // `ref: "42"` instead of `1. computer` + `action: "left_click" · ref: "42"`.
        const label = displayToolLabel(step.name, step.input);
        const displayInput = filterDisplayArgs(step.name, step.input) as
          | Record<string, unknown>
          | undefined;
        return (
          <li key={idx} className="flex items-start gap-2">
            <StepIcon
              className={cn('mt-[2px] h-3 w-3 shrink-0', stepTone, isCurrent && 'animate-spin')}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn('font-mono text-[11px]', stepTone)}>
                <span className="opacity-60">{idx + 1}.</span> {label}
              </span>
              {displayInput && Object.keys(displayInput).length > 0 && (
                <span className="text-muted-foreground truncate font-mono text-[10px] opacity-80">
                  {formatMultiActionInput(displayInput)}
                </span>
              )}
              {step.error && (
                <span className="text-destructive font-mono text-[10px]">{step.error}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatMultiActionInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '(no input)';
  return entries
    .map(([k, v]) => {
      const rendered =
        typeof v === 'string' ? shorten(v, 40) : shorten(JSON.stringify(v), 40);
      return `${k}: ${rendered}`;
    })
    .join(' · ');
}

function ToolArgs({ args }: { args: unknown }) {
  if (args === undefined || args === null) return null;
  let summary: string;
  try {
    if (typeof args === 'string') summary = args;
    else
      summary = Object.entries(args as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${shorten(JSON.stringify(v), 80)}`)
        .join('  ·  ');
  } catch {
    summary = String(args);
  }
  if (!summary) return null;
  return <span className="text-muted-foreground font-mono text-[11px]">{summary}</span>;
}

function ToolResult({ result }: { result: unknown }) {
  if (result === undefined || result === null) return null;
  const json = coerceToJsonValue(result);
  if (json !== undefined) {
    return (
      <div className="font-mono text-[11px] opacity-90">
        <span className="opacity-70">→</span>
        <ReactJsonView
          value={json as object}
          collapsed={2}
          displayDataTypes={false}
          displayObjectSize={false}
          enableClipboard={false}
          shortenTextAfterLength={120}
          style={{
            backgroundColor: 'transparent',
            fontSize: '11px',
            // Inherit our app font tokens; the lib defaults to its own
            // monospace stack which clashes with Tailwind's `font-mono`.
            fontFamily: 'inherit',
            ['--w-rjv-color' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-key-string' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-info-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-update-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-copied-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-arrow-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-edit-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-quotes-string-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-line-color' as string]: 'hsl(var(--border))',
            ['--w-rjv-curlybraces-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-colon-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-brackets-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-type-string-color' as string]: 'hsl(var(--primary))',
            ['--w-rjv-type-int-color' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-type-float-color' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-type-bigint-color' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-type-boolean-color' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-type-date-color' as string]: 'hsl(var(--foreground))',
            ['--w-rjv-type-url-color' as string]: 'hsl(var(--primary))',
            ['--w-rjv-type-null-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-type-undefined-color' as string]: 'hsl(var(--muted-foreground))',
            ['--w-rjv-type-nan-color' as string]: 'hsl(var(--muted-foreground))',
          }}
        />
      </div>
    );
  }
  // Non-JSON tool result: keep the original inline preview.
  const text = typeof result === 'string' ? result : String(result);
  return <span className="font-mono text-[11px] opacity-70">→ {text}</span>;
}

/**
 * If `result` is (or contains) a JSON object/array, return it as a JS value
 * suitable for the JSON viewer. Returns `undefined` for primitive strings,
 * numbers, booleans, etc. — those render better as a plain inline preview.
 */
function coerceToJsonValue(result: unknown): object | unknown[] | undefined {
  if (typeof result === 'object' && result !== null) {
    return result as object | unknown[];
  }
  if (typeof result === 'string') {
    const trimmed = result.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) return parsed as object | unknown[];
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function shorten(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Brand "live beacon" — a terracotta dot with an outward radar ping. Used
 * wherever the agent is actively working (pre-content placeholder + the
 * working-chip header) so there's always visible motion, even when a single
 * tool call is taking a while and no new tokens are streaming.
 */
function LiveBeacon() {
  return (
    <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
      <span className="bg-primary/40 absolute inline-flex h-full w-full animate-ping rounded-full" />
      <span className="bg-primary relative inline-flex h-1.5 w-1.5 rounded-full" />
    </span>
  );
}

/**
 * First-tokens placeholder shown the instant a turn starts, before any tool
 * call or text has arrived. The pinging beacon + shimmering "Thinking…" make
 * it unmistakable that the agent is alive and working.
 */
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <LiveBeacon />
      <span className="de-shimmer text-[13px] font-medium">Thinking…</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* JavaScript code view (read-only, IDE-styled)                        */
/* ------------------------------------------------------------------ */

/**
 * Read-only JS code panel for `run_js` calls. Renders the agent's
 * code with VS Code Dark+ palette colors, line numbers, header bar, and a
 * copy button. Highlighting is delegated to `prism-react-renderer` (Prism
 * + a curated React API) so we get full JS grammar coverage — regex
 * literals, template-string interpolation, JSX, etc.
 */
function JsCodeView({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    /* Deliberate token exemption: this block mimics VS Code editor chrome,
       so it keeps the fixed dark-editor hex palette in both themes. */
    <div className="border-border/60 my-1 overflow-hidden rounded-lg border bg-[#1e1e1e]">
      <div className="flex items-center justify-between border-b border-[#2d2d2d] bg-[#252526] px-2 py-1 text-[11px] text-[#cccccc]">
        <div className="flex items-center gap-1.5">
          <FileCode2 className="h-3 w-3 text-[#cccccc]" />
          <span className="font-mono">javascript</span>
          <span className="rounded bg-[#3c3c3c] px-1.5 py-0 text-[10px] uppercase tracking-wide text-[#cccccc]">
            run_js
          </span>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard may be denied; ignore
            }
          }}
          className="inline-flex items-center gap-1 rounded p-1 text-[#cccccc] hover:bg-[#2a2d2e]">
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-[#73c991]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Highlight code={code} language="javascript" theme={prismThemes.vsDark}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(className, 'm-0 overflow-x-auto py-2 font-mono text-[12px] leading-[1.55]')}
            style={{ ...style, background: 'transparent' }}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} {...lineProps} className={cn(lineProps.className, 'flex')}>
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-[#858585]">{i + 1}</span>
                  <span className="flex-1 whitespace-pre pr-3">
                    {line.length === 0 ? (
                      <span>&nbsp;</span>
                    ) : (
                      line.map((token, j) => <span key={j} {...getTokenProps({ token })} />)
                    )}
                  </span>
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
