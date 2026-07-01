/**
 * Keyboard key definitions for CDP `Input.dispatchKeyEvent`.
 *
 * Lowercase-keyed map; letter/digit fallback synthesised on demand.
 * Printable characters that have no entry here go through `Input.insertText`.
 */

export interface KeyDefinition {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  text?: string;
  isKeypad?: boolean;
  location?: number;
}

// Lowercase-keyed; lookup goes through `getKeyDefinition` which also
// accepts mixed-case input and synthesises single-character letters/digits.
const RAW_DEFINITIONS: Readonly<Record<string, KeyDefinition>> = {
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  numpadenter: { key: 'Enter', code: 'NumpadEnter', windowsVirtualKeyCode: 13, text: '\r', isKeypad: true },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, text: '\t' },
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  del: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  insert: { key: 'Insert', code: 'Insert', windowsVirtualKeyCode: 45 },
  capslock: { key: 'CapsLock', code: 'CapsLock', windowsVirtualKeyCode: 20 },
  numlock: { key: 'NumLock', code: 'NumLock', windowsVirtualKeyCode: 144 },
  scrolllock: { key: 'ScrollLock', code: 'ScrollLock', windowsVirtualKeyCode: 145 },
  pause: { key: 'Pause', code: 'Pause', windowsVirtualKeyCode: 19 },
  printscreen: { key: 'PrintScreen', code: 'PrintScreen', windowsVirtualKeyCode: 44 },
  shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
  control: { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
  ctrl: { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
  alt: { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
  option: { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
  meta: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
  cmd: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
  command: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
  win: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
  windows: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },
  f1: { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 },
  f2: { key: 'F2', code: 'F2', windowsVirtualKeyCode: 113 },
  f3: { key: 'F3', code: 'F3', windowsVirtualKeyCode: 114 },
  f4: { key: 'F4', code: 'F4', windowsVirtualKeyCode: 115 },
  f5: { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 },
  f6: { key: 'F6', code: 'F6', windowsVirtualKeyCode: 117 },
  f7: { key: 'F7', code: 'F7', windowsVirtualKeyCode: 118 },
  f8: { key: 'F8', code: 'F8', windowsVirtualKeyCode: 119 },
  f9: { key: 'F9', code: 'F9', windowsVirtualKeyCode: 120 },
  f10: { key: 'F10', code: 'F10', windowsVirtualKeyCode: 121 },
  f11: { key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 },
  f12: { key: 'F12', code: 'F12', windowsVirtualKeyCode: 123 },
  ';': { key: ';', code: 'Semicolon', windowsVirtualKeyCode: 186, text: ';' },
  '=': { key: '=', code: 'Equal', windowsVirtualKeyCode: 187, text: '=' },
  ',': { key: ',', code: 'Comma', windowsVirtualKeyCode: 188, text: ',' },
  '-': { key: '-', code: 'Minus', windowsVirtualKeyCode: 189, text: '-' },
  minus: { key: '-', code: 'Minus', windowsVirtualKeyCode: 189, text: '-' },
  subtract: { key: '-', code: 'Minus', windowsVirtualKeyCode: 189, text: '-' },
  equal: { key: '=', code: 'Equal', windowsVirtualKeyCode: 187, text: '=' },
  plus: { key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107, isKeypad: true, text: '+' },
  add: { key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107, isKeypad: true, text: '+' },
  '.': { key: '.', code: 'Period', windowsVirtualKeyCode: 190, text: '.' },
  '/': { key: '/', code: 'Slash', windowsVirtualKeyCode: 191, text: '/' },
  '`': { key: '`', code: 'Backquote', windowsVirtualKeyCode: 192, text: '`' },
  '[': { key: '[', code: 'BracketLeft', windowsVirtualKeyCode: 219, text: '[' },
  '\\': { key: '\\', code: 'Backslash', windowsVirtualKeyCode: 220, text: '\\' },
  ']': { key: ']', code: 'BracketRight', windowsVirtualKeyCode: 221, text: ']' },
  "'": { key: "'", code: 'Quote', windowsVirtualKeyCode: 222, text: "'" },
  numpad0: { key: '0', code: 'Numpad0', windowsVirtualKeyCode: 96, isKeypad: true, text: '0' },
  numpad1: { key: '1', code: 'Numpad1', windowsVirtualKeyCode: 97, isKeypad: true, text: '1' },
  numpad2: { key: '2', code: 'Numpad2', windowsVirtualKeyCode: 98, isKeypad: true, text: '2' },
  numpad3: { key: '3', code: 'Numpad3', windowsVirtualKeyCode: 99, isKeypad: true, text: '3' },
  numpad4: { key: '4', code: 'Numpad4', windowsVirtualKeyCode: 100, isKeypad: true, text: '4' },
  numpad5: { key: '5', code: 'Numpad5', windowsVirtualKeyCode: 101, isKeypad: true, text: '5' },
  numpad6: { key: '6', code: 'Numpad6', windowsVirtualKeyCode: 102, isKeypad: true, text: '6' },
  numpad7: { key: '7', code: 'Numpad7', windowsVirtualKeyCode: 103, isKeypad: true, text: '7' },
  numpad8: { key: '8', code: 'Numpad8', windowsVirtualKeyCode: 104, isKeypad: true, text: '8' },
  numpad9: { key: '9', code: 'Numpad9', windowsVirtualKeyCode: 105, isKeypad: true, text: '9' },
  numpadmultiply: { key: '*', code: 'NumpadMultiply', windowsVirtualKeyCode: 106, isKeypad: true, text: '*' },
  numpadadd: { key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107, isKeypad: true, text: '+' },
  numpadsubtract: { key: '-', code: 'NumpadSubtract', windowsVirtualKeyCode: 109, isKeypad: true, text: '-' },
  numpaddecimal: { key: '.', code: 'NumpadDecimal', windowsVirtualKeyCode: 110, isKeypad: true, text: '.' },
  numpaddivide: { key: '/', code: 'NumpadDivide', windowsVirtualKeyCode: 111, isKeypad: true, text: '/' },
};

/**
 * Case-insensitive key lookup. Falls back to synthesising a definition for
 * single-character ASCII letters (a–z, A–Z) and digits (0–9).
 * Returns `undefined` for anything else.
 */
export function getKeyDefinition(name: string): KeyDefinition | undefined {
  if (!name) return undefined;
  const direct = RAW_DEFINITIONS[name.toLowerCase()];
  if (direct) return direct;
  if (name.length === 1) {
    const upper = name.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') {
      return {
        key: name,
        code: `Key${upper}`,
        windowsVirtualKeyCode: upper.charCodeAt(0),
        text: name,
      };
    }
    if (name >= '0' && name <= '9') {
      return {
        key: name,
        code: `Digit${name}`,
        windowsVirtualKeyCode: name.charCodeAt(0),
        text: name,
      };
    }
  }
  return undefined;
}

/** Back-compat export. Prefer `getKeyDefinition` for case-insensitive lookup with fallback. */
export const KEY_DEFINITIONS = RAW_DEFINITIONS;

/** CDP modifier bitmask. */
export const MODIFIER = {
  Alt: 1,
  Ctrl: 2,
  Meta: 4,
  Shift: 8,
} as const;

export type ModifierName = keyof typeof MODIFIER;

export function modifiersToBitmask(mods: readonly ModifierName[] | undefined): number {
  if (!mods) return 0;
  return mods.reduce((acc, name) => acc | MODIFIER[name], 0);
}

/** True if the character requires Shift to type on a US layout. */
export function requiresShift(char: string): boolean {
  return '~!@#$%^&*()_+{}|:"<>?'.includes(char) || (char >= 'A' && char <= 'Z');
}

/**
 * Host platform detection. Runs once at module load. Used to decide whether
 * `pressKeyChord` should attach Mac NSEvent `commands` (e.g. `selectAll`,
 * `moveToBeginningOfLine`) to the dispatched key event so editors that
 * read the Mac key-binding layer (TextEdit-style fields, some PWAs) behave
 * the same way the agent would on a real Mac. On Windows/Linux this stays
 * `false` and Chrome handles `Ctrl+...` shortcuts natively as it always has.
 *
 * Both `navigator.platform` (legacy but still present in Chrome MV3 SW) and
 * `navigator.userAgent` are checked so the result is stable across
 * Chrome version updates that further deprecate `platform`.
 */
export const isMac: boolean = (() => {
  try {
    if (typeof navigator === 'undefined') return false;
    // `navigator.platform` is marked deprecated by lib.dom.d.ts but is still
    // populated in every shipping Chrome MV3 SW (and is the only synchronous,
    // string-form source). `userAgentData.platform` is async via
    // `getHighEntropyValues` so it can't drive a module-level constant.
    // Index access avoids the editor hint without weakening runtime safety.
    const nav = navigator as unknown as { platform?: unknown; userAgent?: unknown };
    const platform = typeof nav.platform === 'string' ? nav.platform : '';
    const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
    return platform.toUpperCase().indexOf('MAC') >= 0 || ua.toUpperCase().indexOf('MAC') >= 0;
  } catch {
    return false;
  }
})();

/**
 * Mac-specific NSEvent command mappings sent to CDP via the `commands` field
 * of `Input.dispatchKeyEvent`. On macOS, AppKit text views (and editors that
 * defer to Cocoa key bindings) react to these named selectors rather than
 * to raw key codes — without them, `cmd+a` won't select-all in a
 * `<textarea>`, `cmd+z` won't undo, etc.
 *
 * Derived from Chromium's `MacKeyCommandsMap` / NSResponder selectors.
 * Keep the keys lowercase: lookups are done on `chord.toLowerCase()`.
 */
export const MAC_KEY_COMMANDS: Readonly<Record<string, string | readonly string[]>> = {
  backspace: 'deleteBackward',
  enter: 'insertNewline',
  numpadenter: 'insertNewline',
  kp_enter: 'insertNewline',
  escape: 'cancelOperation',
  arrowup: 'moveUp',
  arrowdown: 'moveDown',
  arrowleft: 'moveLeft',
  arrowright: 'moveRight',
  up: 'moveUp',
  down: 'moveDown',
  left: 'moveLeft',
  right: 'moveRight',
  f5: 'complete',
  delete: 'deleteForward',
  home: 'scrollToBeginningOfDocument',
  end: 'scrollToEndOfDocument',
  pageup: 'scrollPageUp',
  pagedown: 'scrollPageDown',
  'shift+backspace': 'deleteBackward',
  'shift+enter': 'insertNewline',
  'shift+escape': 'cancelOperation',
  'shift+arrowup': 'moveUpAndModifySelection',
  'shift+arrowdown': 'moveDownAndModifySelection',
  'shift+arrowleft': 'moveLeftAndModifySelection',
  'shift+arrowright': 'moveRightAndModifySelection',
  'shift+up': 'moveUpAndModifySelection',
  'shift+down': 'moveDownAndModifySelection',
  'shift+left': 'moveLeftAndModifySelection',
  'shift+right': 'moveRightAndModifySelection',
  'shift+f5': 'complete',
  'shift+delete': 'deleteForward',
  'shift+home': 'moveToBeginningOfDocumentAndModifySelection',
  'shift+end': 'moveToEndOfDocumentAndModifySelection',
  'shift+pageup': 'pageUpAndModifySelection',
  'shift+pagedown': 'pageDownAndModifySelection',
  'shift+numpad5': 'delete',
  'ctrl+tab': 'selectNextKeyView',
  'ctrl+enter': 'insertLineBreak',
  'ctrl+numpadenter': 'insertLineBreak',
  'ctrl+kp_enter': 'insertLineBreak',
  'ctrl+quote': 'insertSingleQuoteIgnoringSubstitution',
  "ctrl+'": 'insertSingleQuoteIgnoringSubstitution',
  'ctrl+a': 'moveToBeginningOfParagraph',
  'ctrl+b': 'moveBackward',
  'ctrl+d': 'deleteForward',
  'ctrl+e': 'moveToEndOfParagraph',
  'ctrl+f': 'moveForward',
  'ctrl+h': 'deleteBackward',
  'ctrl+k': 'deleteToEndOfParagraph',
  'ctrl+l': 'centerSelectionInVisibleArea',
  'ctrl+n': 'moveDown',
  'ctrl+p': 'moveUp',
  'ctrl+t': 'transpose',
  'ctrl+v': 'moveUp',
  'ctrl+y': 'yank',
  'ctrl+o': ['insertNewlineIgnoringFieldEditor', 'moveBackward'],
  'ctrl+backspace': 'deleteBackwardByDecomposingPreviousCharacter',
  'ctrl+arrowup': 'scrollPageUp',
  'ctrl+arrowdown': 'scrollPageDown',
  'ctrl+arrowleft': 'moveToLeftEndOfLine',
  'ctrl+arrowright': 'moveToRightEndOfLine',
  'ctrl+up': 'scrollPageUp',
  'ctrl+down': 'scrollPageDown',
  'ctrl+left': 'moveToLeftEndOfLine',
  'ctrl+right': 'moveToRightEndOfLine',
  'shift+ctrl+enter': 'insertLineBreak',
  'shift+control+numpadenter': 'insertLineBreak',
  'shift+control+kp_enter': 'insertLineBreak',
  'shift+ctrl+tab': 'selectPreviousKeyView',
  'shift+ctrl+quote': 'insertDoubleQuoteIgnoringSubstitution',
  "shift+ctrl+'": 'insertDoubleQuoteIgnoringSubstitution',
  'ctrl+"': 'insertDoubleQuoteIgnoringSubstitution',
  'shift+ctrl+a': 'moveToBeginningOfParagraphAndModifySelection',
  'shift+ctrl+b': 'moveBackwardAndModifySelection',
  'shift+ctrl+e': 'moveToEndOfParagraphAndModifySelection',
  'shift+ctrl+f': 'moveForwardAndModifySelection',
  'shift+ctrl+n': 'moveDownAndModifySelection',
  'shift+ctrl+p': 'moveUpAndModifySelection',
  'shift+ctrl+v': 'pageDownAndModifySelection',
  'shift+ctrl+backspace': 'deleteBackwardByDecomposingPreviousCharacter',
  'shift+ctrl+arrowup': 'scrollPageUp',
  'shift+ctrl+arrowdown': 'scrollPageDown',
  'shift+ctrl+arrowleft': 'moveToLeftEndOfLineAndModifySelection',
  'shift+ctrl+arrowright': 'moveToRightEndOfLineAndModifySelection',
  'shift+ctrl+up': 'scrollPageUp',
  'shift+ctrl+down': 'scrollPageDown',
  'shift+ctrl+left': 'moveToLeftEndOfLineAndModifySelection',
  'shift+ctrl+right': 'moveToRightEndOfLineAndModifySelection',
  'alt+backspace': 'deleteWordBackward',
  'alt+enter': 'insertNewlineIgnoringFieldEditor',
  'alt+numpadenter': 'insertNewlineIgnoringFieldEditor',
  'alt+kp_enter': 'insertNewlineIgnoringFieldEditor',
  'alt+escape': 'complete',
  'alt+arrowup': ['moveBackward', 'moveToBeginningOfParagraph'],
  'alt+arrowdown': ['moveForward', 'moveToEndOfParagraph'],
  'alt+arrowleft': 'moveWordLeft',
  'alt+arrowright': 'moveWordRight',
  'alt+up': ['moveBackward', 'moveToBeginningOfParagraph'],
  'alt+down': ['moveForward', 'moveToEndOfParagraph'],
  'alt+left': 'moveWordLeft',
  'alt+right': 'moveWordRight',
  'alt+delete': 'deleteWordForward',
  'alt+pageup': 'pageUp',
  'alt+pagedown': 'pageDown',
  'shift+alt+backspace': 'deleteWordBackward',
  'shift+alt+enter': 'insertNewlineIgnoringFieldEditor',
  'shift+alt+numpadenter': 'insertNewlineIgnoringFieldEditor',
  'shift+alt+kp_enter': 'insertNewlineIgnoringFieldEditor',
  'shift+alt+escape': 'complete',
  'shift+alt+arrowup': 'moveParagraphBackwardAndModifySelection',
  'shift+alt+arrowdown': 'moveParagraphForwardAndModifySelection',
  'shift+alt+arrowleft': 'moveWordLeftAndModifySelection',
  'shift+alt+arrowright': 'moveWordRightAndModifySelection',
  'shift+alt+up': 'moveParagraphBackwardAndModifySelection',
  'shift+alt+down': 'moveParagraphForwardAndModifySelection',
  'shift+alt+left': 'moveWordLeftAndModifySelection',
  'shift+alt+right': 'moveWordRightAndModifySelection',
  'shift+alt+delete': 'deleteWordForward',
  'shift+alt+pageup': 'pageUp',
  'shift+alt+pagedown': 'pageDown',
  'ctrl+alt+b': 'moveWordBackward',
  'ctrl+alt+f': 'moveWordForward',
  'ctrl+alt+backspace': 'deleteWordBackward',
  'shift+ctrl+alt+b': 'moveWordBackwardAndModifySelection',
  'shift+ctrl+alt+f': 'moveWordForwardAndModifySelection',
  'shift+ctrl+alt+backspace': 'deleteWordBackward',
  'cmd+numpadsubtract': 'cancel',
  'cmd+backspace': 'deleteToBeginningOfLine',
  'cmd+arrowup': 'moveToBeginningOfDocument',
  'cmd+arrowdown': 'moveToEndOfDocument',
  'cmd+arrowleft': 'moveToLeftEndOfLine',
  'cmd+arrowright': 'moveToRightEndOfLine',
  'cmd+home': 'moveToBeginningOfDocument',
  'cmd+up': 'moveToBeginningOfDocument',
  'cmd+down': 'moveToEndOfDocument',
  'cmd+left': 'moveToLeftEndOfLine',
  'cmd+right': 'moveToRightEndOfLine',
  'shift+cmd+numpadsubtract': 'cancel',
  'shift+cmd+backspace': 'deleteToBeginningOfLine',
  'shift+cmd+arrowup': 'moveToBeginningOfDocumentAndModifySelection',
  'shift+cmd+arrowdown': 'moveToEndOfDocumentAndModifySelection',
  'shift+cmd+arrowleft': 'moveToLeftEndOfLineAndModifySelection',
  'shift+cmd+arrowright': 'moveToRightEndOfLineAndModifySelection',
  'cmd+a': 'selectAll',
  'cmd+c': 'copy',
  'cmd+x': 'cut',
  'cmd+v': 'paste',
  'cmd+z': 'undo',
  'shift+cmd+z': 'redo',
};
