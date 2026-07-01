import { AttachmentStrip } from './AttachmentStrip';
import { ModelSelector } from './ModelSelector';
import { PermissionModeSelector } from './PermissionModeSelector';
import { RichTextEditor } from './RichTextEditor';
import { Button, cn } from '@doeverything/ui';
import { useSpeechToText } from '@src/hooks/useSpeechToText';
import { ArrowUp, Loader2, Mic, MousePointerSquareDashed, Paperclip, Square } from 'lucide-react';
import { useRef } from 'react';
import type { Attachment } from './AttachmentStrip';

/**
 * Composer.
 *
 * TipTap editor + attachment strip + paperclip (file picker) + send/stop
 * button. The parent owns `value`, `attachments`, and the send/abort
 * callbacks; this component only renders + emits events.
 */

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  status: 'idle' | 'submitting' | 'streaming' | 'awaiting-tool' | 'error';
  placeholder: string;
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;
  onAttachFiles?: (files: File[]) => void;
  /**
   * Region-screenshot button. When set, the parent renders a button that
   * triggers a region-picker overlay on the active tab; the parent is
   * responsible for the picker → capture → attach pipeline. While the
   * picker is open, pass `regionCapturing: true` so the button shows a
   * spinner instead of the icon.
   */
  onCaptureRegion?: () => void;
  regionCapturing?: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onAbort,
  status,
  placeholder,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onCaptureRegion,
  regionCapturing,
}: ComposerProps) {
  const isBusy = status === 'submitting' || status === 'streaming' || status === 'awaiting-tool';
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dictation: each finalized utterance is appended to the draft. The hook
  // re-reads this callback every render, so `value` is always current —
  // consecutive utterances accumulate instead of overwriting each other.
  const speech = useSpeechToText(text => {
    onChange(value.trim() ? `${value.trimEnd()} ${text}` : text);
  });

  const onMicClick = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    if (speech.permissionDenied) {
      // The side panel can't show the mic permission prompt reliably; the
      // Options Microphone tab (a full tab) can.
      void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#microphone') });
      return;
    }
    speech.start();
  };

  const onPickFiles = () => fileInputRef.current?.click();
  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    onAttachFiles?.(Array.from(e.target.files));
    e.target.value = '';
  };

  const canSend = value.trim().length > 0 || attachments.length > 0;

  // Focus the contenteditable when the user clicks anywhere on the composer
  // surface — padding, the button row's empty space, etc. We use mousedown
  // (not click) so the focus shift happens before the browser's default
  // selection-change logic, and we preventDefault to stop any
  // body-level focus loss that would otherwise blur the editor.
  const focusEditorOnSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Anything interactive (buttons, file input, the editor itself) handles
    // its own focus. We only redirect clicks on the surface's "blank" space.
    if (target.closest('button, input, a, [contenteditable="true"]')) return;
    const editable = e.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!editable) return;
    e.preventDefault();
    editable.focus();
  };

  return (
    <div className="border-border/60 bg-background/95 border-t px-3 pb-3 pt-2 backdrop-blur">
      {onRemoveAttachment && <AttachmentStrip attachments={attachments} onRemove={onRemoveAttachment} />}
      {/* Decorative wrapper: onMouseDown only redirects blank-space clicks to the inner contenteditable, which is the real interactive element. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onMouseDown={focusEditorOnSurfaceClick}
        className={cn(
          'border-border/70 bg-card shadow-soft mx-auto flex max-w-2xl cursor-text flex-col gap-1.5 rounded-2xl border px-3 pb-2 pt-2.5',
          'focus-within:border-ring/50 focus-within:ring-ring/20 transition focus-within:ring-2',
        )}>
        <RichTextEditor
          value={value}
          onChange={onChange}
          onSubmit={() => canSend && !isBusy && onSubmit()}
          placeholder={placeholder}
          disabled={isBusy && status !== 'streaming'}
        />
        {speech.error && <p className="text-destructive text-[11px]">{speech.error}</p>}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {onAttachFiles && (
              <>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilesPicked} />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onPickFiles}
                  aria-label="Attach files"
                  className="text-muted-foreground hover:text-foreground h-8 w-8 rounded-full">
                  <Paperclip className="h-4 w-4" />
                </Button>
              </>
            )}
            {onCaptureRegion && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onCaptureRegion}
                disabled={regionCapturing}
                aria-label={regionCapturing ? 'Drawing region…' : 'Capture region from page'}
                title={regionCapturing ? 'Draw a rectangle on the page (Esc to cancel)' : 'Capture region from page'}
                className="text-muted-foreground hover:text-foreground h-8 w-8 rounded-full">
                {regionCapturing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MousePointerSquareDashed className="h-4 w-4" />
                )}
              </Button>
            )}
            {speech.supported && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onMicClick}
                aria-label={speech.listening ? 'Stop dictation' : 'Dictate a message'}
                title={speech.error ?? (speech.listening ? 'Listening… click to stop' : 'Dictate a message')}
                className={cn(
                  'h-8 w-8 rounded-full',
                  speech.listening
                    ? 'text-destructive animate-pulse'
                    : 'text-muted-foreground hover:text-foreground',
                )}>
                <Mic className="h-4 w-4" />
              </Button>
            )}
            <PermissionModeSelector className="ml-1" />
            <ModelSelector />
          </div>
          {isBusy ? (
            <Button
              size="icon"
              variant="destructive"
              onClick={onAbort}
              aria-label="Stop"
              className="h-8 w-8 shrink-0 rounded-full">
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="Send"
              className="h-8 w-8 shrink-0 rounded-full">
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
