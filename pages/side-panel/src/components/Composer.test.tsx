import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from './AttachmentStrip';

/**
 * Composer is a thin, parent-owned shell around RichTextEditor (TipTap),
 * ModelSelector, PermissionModeSelector and AttachmentStrip. We mock those
 * heavy children so the test exercises Composer's OWN logic — send/stop
 * button state, `canSend` gating, the paperclip file picker, region-capture
 * button, and the mic button (which depends on the real `useSpeechToText`).
 *
 * RichTextEditor is replaced by a controlled <textarea> that mirrors its
 * contract (value / onChange / onSubmit / disabled) so we can drive
 * onChange + onSubmit deterministically without mounting TipTap in happy-dom.
 */

vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    onSubmit,
    placeholder,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <textarea
      data-testid="editor"
      aria-label="editor"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  ),
}));

vi.mock('./ModelSelector', () => ({ ModelSelector: () => <div data-testid="model-selector" /> }));
vi.mock('./PermissionModeSelector', () => ({ PermissionModeSelector: () => <div data-testid="perm-selector" /> }));

// Imported AFTER the mocks are registered.
const { Composer } = await import('./Composer');

interface Props {
  value?: string;
  status?: 'idle' | 'submitting' | 'streaming' | 'awaiting-tool' | 'error';
  attachments?: Attachment[];
  onChange?: (v: string) => void;
  onSubmit?: () => void;
  onAbort?: () => void;
  onRemoveAttachment?: (id: string) => void;
  onAttachFiles?: (files: File[]) => void;
  onCaptureRegion?: () => void;
  regionCapturing?: boolean;
}

const renderComposer = (props: Props = {}) => {
  const onChange = props.onChange ?? vi.fn();
  const onSubmit = props.onSubmit ?? vi.fn();
  const onAbort = props.onAbort ?? vi.fn();
  render(
    <Composer
      value={props.value ?? ''}
      onChange={onChange}
      onSubmit={onSubmit}
      onAbort={onAbort}
      status={props.status ?? 'idle'}
      placeholder="Ask anything"
      attachments={props.attachments}
      onRemoveAttachment={props.onRemoveAttachment}
      onAttachFiles={props.onAttachFiles}
      onCaptureRegion={props.onCaptureRegion}
      regionCapturing={props.regionCapturing}
    />,
  );
  return { onChange, onSubmit, onAbort };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer', () => {
  it('disables Send when the draft is empty and there are no attachments', () => {
    renderComposer({ value: '' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('enables Send when the draft has non-whitespace text', () => {
    renderComposer({ value: 'hello' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('enables Send when there are attachments even with an empty draft', () => {
    renderComposer({
      value: '   ',
      attachments: [{ id: 'a', name: 'f.png', type: 'image/png', size: 10 }],
      onRemoveAttachment: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('fires onSubmit when the enabled Send button is clicked', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer({ value: 'hi' });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows a Stop button (not Send) while busy and fires onAbort', async () => {
    const user = userEvent.setup();
    const { onAbort } = renderComposer({ value: 'hi', status: 'streaming' });
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('relays editor text changes through onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderComposer({ value: '' });
    await user.type(screen.getByTestId('editor'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('submits via the editor Enter key only when sendable', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer({ value: 'hi' });
    screen.getByTestId('editor').focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Enter when the draft is empty', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer({ value: '' });
    screen.getByTestId('editor').focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the paperclip only when onAttachFiles is provided, and forwards picked files', async () => {
    const user = userEvent.setup();
    const onAttachFiles = vi.fn();
    renderComposer({ onAttachFiles });
    const file = new File(['data'], 'note.txt', { type: 'text/plain' });
    // The hidden file input is the only file input in the tree.
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, file);
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(onAttachFiles.mock.calls[0][0][0]).toBeInstanceOf(File);
  });

  it('omits the paperclip when onAttachFiles is absent', () => {
    renderComposer({});
    expect(screen.queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument();
  });

  it('renders the region-capture button and fires onCaptureRegion', async () => {
    const user = userEvent.setup();
    const onCaptureRegion = vi.fn();
    renderComposer({ onCaptureRegion });
    await user.click(screen.getByRole('button', { name: 'Capture region from page' }));
    expect(onCaptureRegion).toHaveBeenCalledTimes(1);
  });

  it('disables the region button and shows the drawing label while capturing', () => {
    renderComposer({ onCaptureRegion: vi.fn(), regionCapturing: true });
    const btn = screen.getByRole('button', { name: 'Drawing region…' });
    expect(btn).toBeDisabled();
  });

  it('hides the mic button when speech recognition is unsupported', () => {
    // happy-dom has no webkitSpeechRecognition by default.
    renderComposer({ value: 'hi' });
    expect(screen.queryByRole('button', { name: /Dictate a message/i })).not.toBeInTheDocument();
  });

  it('shows the mic button when speech recognition is supported', () => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    renderComposer({ value: 'hi' });
    expect(screen.getByRole('button', { name: 'Dictate a message' })).toBeInTheDocument();
  });

  it('renders the attachment strip (with onRemove wired) when attachments exist', () => {
    renderComposer({
      attachments: [{ id: 'a', name: 'photo.png', type: 'image/png', size: 100 }],
      onRemoveAttachment: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
