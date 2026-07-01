import { cn } from '@doeverything/ui';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

/**
 * RichTextEditor — TipTap v2 editor used by the doeverything composer.
 *
 * Behaviour:
 *   - Single-paragraph by default (Enter sends).
 *   - Shift+Enter inserts a hard break.
 *   - Cmd/Ctrl+Enter mirrors Enter so power users can submit while a slash
 *     menu is open.
 *   - Backspace at start-of-empty-doc keeps focus inside the editor (no
 *     accidental defocus).
 *
 * The component is controlled (value/onChange) so the parent owns the
 * canonical text — TipTap mirrors it.
 */

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function RichTextEditor({ value, onChange, onSubmit, placeholder, disabled, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        // Note: this class lands on the *inner* .ProseMirror contenteditable,
        // not on the EditorContent wrapper. Outer layout (flex, width) lives
        // on the wrapper div below.
        //
        //   - `[&_p]:m-0` : kill the browser's default 1em margin on <p>
        //                    so the cursor sits flush at the top.
        class: cn(
          'w-full max-w-none break-words text-current focus:outline-none',
          'min-h-[24px] max-h-40 overflow-y-auto text-sm leading-snug',
          '[&_p]:m-0 [&_p]:leading-snug',
        ),
      },
      handleKeyDown(_, event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      const next = editor.getText();
      if (next !== value) onChange(next);
    },
  });

  // Keep editor content in sync if the parent resets the value externally.
  useEffect(() => {
    if (!editor) return;
    if (editor.getText() === value) return;
    editor.commands.setContent(value, false);
  }, [editor, value]);

  // TipTap's `editable` is captured at construction time. Without this we
  // get stuck disabled after the first send: parent flips `disabled` back
  // to false but the editor remains read-only.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== !disabled) editor.setEditable(!disabled);
  }, [editor, disabled]);

  const isEmpty = !value;

  // CSS grid trick: place the invisible spacer and the editor in the same grid
  // cell (1/1). The spacer mirrors the placeholder (when empty) or typed text,
  // so the cell — and the composer box — grows to fit whatever wraps. The
  // editor overlaps the spacer and the visible placeholder via stacking order.
  return (
    <div className={cn('grid w-full min-w-0', className)}>
      {/* Invisible spacer drives the grid cell height */}
      <div
        aria-hidden="true"
        className="invisible pointer-events-none select-none whitespace-pre-wrap break-words text-sm leading-snug min-h-[24px] max-h-40 overflow-hidden"
        style={{ gridArea: '1/1' }}>
        {isEmpty && placeholder ? placeholder : value || ' '}
      </div>
      {/* Visible placeholder, shown only when the editor is empty */}
      {isEmpty && placeholder && (
        <div
          aria-hidden="true"
          className="pointer-events-none select-none text-muted-foreground/70 text-sm leading-snug break-words"
          style={{ gridArea: '1/1' }}>
          {placeholder}
        </div>
      )}
      {/* TipTap editor — same grid cell, rendered on top */}
      <EditorContent editor={editor} style={{ gridArea: '1/1' }} />
    </div>
  );
}
