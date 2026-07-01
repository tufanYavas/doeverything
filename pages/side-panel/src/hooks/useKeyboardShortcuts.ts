import { useEffect } from 'react';

/**
 * Side-panel keyboard shortcut registry.
 *
 * Bindings (active while the side panel has focus):
 *   - Cmd/Ctrl+J     → toggle theme
 *   - Cmd/Ctrl+/     → focus the composer
 *   - Cmd/Ctrl+\     → start a new conversation (clear)
 *   - Cmd/Ctrl+,     → open Options
 *   - Esc            → close any open modal (handled by Radix)
 *
 * Global (browser-level) shortcuts like toggling the panel live in the
 * manifest `commands` block and are handled by the service worker.
 *
 * The exact set of handlers is supplied by the parent so this hook stays
 * dumb. A key combo is only intercepted (preventDefault) when its handler
 * is actually provided — otherwise the event passes through untouched.
 */

export interface ShortcutHandlers {
  onToggleTheme?: () => void;
  onFocusComposer?: () => void;
  onClearConversation?: () => void;
  onOpenOptions?: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);
const cmdOrCtrl = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // AltGr on Windows reports ctrlKey+altKey, so typing AltGr characters
      // (e.g. '\' on a Turkish-Q layout) would otherwise trigger shortcuts.
      if (e.altKey) return;
      if (!cmdOrCtrl(e)) return;

      const run = (handler: (() => void) | undefined) => {
        if (!handler) return;
        e.preventDefault();
        handler();
      };

      switch (e.key.toLowerCase()) {
        case 'j':
          run(handlers.onToggleTheme);
          break;
        case '/':
          run(handlers.onFocusComposer);
          break;
        case '\\':
          run(handlers.onClearConversation);
          break;
        case ',':
          run(handlers.onOpenOptions);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers.onToggleTheme, handlers.onFocusComposer, handlers.onClearConversation, handlers.onOpenOptions]);
}

/** Display string for the modifier on the current platform. */
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';
