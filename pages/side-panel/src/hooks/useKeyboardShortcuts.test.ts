import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutHandlers } from './useKeyboardShortcuts';

/**
 * The hook binds to `window` and only fires a handler when the
 * Cmd/Ctrl modifier matches the platform. happy-dom reports a non-Mac
 * userAgent, so `cmdOrCtrl` checks `ctrlKey` — every test drives the
 * Windows/Linux branch with `ctrlKey: true`.
 */

/** Dispatch a keydown on window with the given key + modifiers. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

let handlers: Required<ShortcutHandlers>;

beforeEach(() => {
  handlers = {
    onToggleTheme: vi.fn(),
    onFocusComposer: vi.fn(),
    onClearConversation: vi.fn(),
    onOpenOptions: vi.fn(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useKeyboardShortcuts', () => {
  it('runs onToggleTheme for Ctrl+J', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    const event = press('j', { ctrlKey: true });
    expect(handlers.onToggleTheme).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('runs onFocusComposer for Ctrl+/', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    press('/', { ctrlKey: true });
    expect(handlers.onFocusComposer).toHaveBeenCalledTimes(1);
  });

  it('runs onClearConversation for Ctrl+\\', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    press('\\', { ctrlKey: true });
    expect(handlers.onClearConversation).toHaveBeenCalledTimes(1);
  });

  it('runs onOpenOptions for Ctrl+,', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    press(',', { ctrlKey: true });
    expect(handlers.onOpenOptions).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive on the key (Ctrl+Shift+J still toggles theme)', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    // Shift produces an uppercase `J`; the hook lowercases e.key.
    press('J', { ctrlKey: true });
    expect(handlers.onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the Cmd/Ctrl modifier', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    const event = press('j');
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores combos when Alt is held (AltGr guard)', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    // AltGr on Windows reports ctrlKey+altKey; must not fire a shortcut.
    const event = press('\\', { ctrlKey: true, altKey: true });
    expect(handlers.onClearConversation).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores unmapped keys even with the modifier', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    const event = press('k', { ctrlKey: true });
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
    expect(handlers.onFocusComposer).not.toHaveBeenCalled();
    expect(handlers.onClearConversation).not.toHaveBeenCalled();
    expect(handlers.onOpenOptions).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not intercept (preventDefault) a combo whose handler is absent', () => {
    renderHook(() => useKeyboardShortcuts({ onToggleTheme: handlers.onToggleTheme }));
    // No onFocusComposer provided → Ctrl+/ passes through untouched.
    const event = press('/', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it('removes its window listener on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    unmount();
    press('j', { ctrlKey: true });
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
  });
});
