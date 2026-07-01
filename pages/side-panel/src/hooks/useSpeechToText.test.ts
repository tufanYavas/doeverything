import { useSpeechToText } from './useSpeechToText';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Minimal controllable fake of the Web Speech API. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: { resultIndex: number; results: unknown }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  /** Build a SpeechRecognitionResultList-like array of final results. */
  emitFinals(...transcripts: string[]) {
    const results = transcripts.map(t => {
      const arr: { isFinal: boolean; 0: { transcript: string } } = { isFinal: true, 0: { transcript: t } };
      return arr;
    });
    (results as unknown as { length: number }).length = transcripts.length;
    this.onresult?.({ resultIndex: 0, results });
  }
}

function installSpeech() {
  (window as unknown as { webkitSpeechRecognition: typeof FakeRecognition }).webkitSpeechRecognition = FakeRecognition;
}
function uninstallSpeech() {
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}

afterEach(() => {
  FakeRecognition.instances = [];
  uninstallSpeech();
  vi.restoreAllMocks();
});

describe('useSpeechToText', () => {
  it('reports unsupported when the browser lacks SpeechRecognition', () => {
    uninstallSpeech();
    const { result } = renderHook(() => useSpeechToText(() => {}));
    expect(result.current.supported).toBe(false);
  });

  it('starts recognition with the UI language and continuous mode', () => {
    installSpeech();
    const { result } = renderHook(() => useSpeechToText(() => {}));
    act(() => result.current.start());
    const rec = FakeRecognition.instances.at(-1)!;
    expect(rec.start).toHaveBeenCalled();
    expect(rec.continuous).toBe(true);
    expect(rec.lang).toBe('en-US'); // from chrome.i18n.getUILanguage mock
    expect(result.current.listening).toBe(true);
  });

  it('delivers MULTIPLE finals from one event as a single joined callback (overwrite-bug guard)', () => {
    installSpeech();
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpeechToText(onFinal));
    act(() => result.current.start());
    const rec = FakeRecognition.instances.at(-1)!;
    act(() => rec.emitFinals('hello there', 'general kenobi'));
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith('hello there general kenobi');
  });

  it('always reads the freshest callback (no stale closure across events)', () => {
    installSpeech();
    let captured = '';
    const { result, rerender } = renderHook(({ cb }) => useSpeechToText(cb), {
      initialProps: { cb: (_t: string) => {} },
    });
    act(() => result.current.start());
    const rec = FakeRecognition.instances.at(-1)!;
    act(() => rerender({ cb: (t: string) => (captured = t) }));
    act(() => rec.emitFinals('updated'));
    expect(captured).toBe('updated');
  });

  it('surfaces a permission-denied state on not-allowed', () => {
    installSpeech();
    const { result } = renderHook(() => useSpeechToText(() => {}));
    act(() => result.current.start());
    const rec = FakeRecognition.instances.at(-1)!;
    act(() => rec.onerror?.({ error: 'not-allowed' }));
    expect(result.current.permissionDenied).toBe(true);
    expect(result.current.error).toMatch(/Microphone access is blocked/i);
  });

  it('stop() ends listening and does not auto-restart on the subsequent onend', () => {
    installSpeech();
    const { result } = renderHook(() => useSpeechToText(() => {}));
    act(() => result.current.start());
    const rec = FakeRecognition.instances.at(-1)!;
    rec.start.mockClear();
    act(() => result.current.stop());
    act(() => rec.onend?.());
    expect(result.current.listening).toBe(false);
    expect(rec.start).not.toHaveBeenCalled(); // no restart after an intentional stop
  });

  it('auto-restarts on a silence-triggered onend while still listening', () => {
    installSpeech();
    const { result } = renderHook(() => useSpeechToText(() => {}));
    act(() => result.current.start());
    const rec = FakeRecognition.instances.at(-1)!;
    rec.start.mockClear();
    act(() => rec.onend?.()); // silence auto-end, user never stopped
    expect(rec.start).toHaveBeenCalledTimes(1);
  });
});
