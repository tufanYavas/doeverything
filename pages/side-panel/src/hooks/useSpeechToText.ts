import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useSpeechToText — Web Speech API dictation for the composer.
 *
 * Chrome ships SpeechRecognition behind the `webkit` prefix and TypeScript's
 * lib.dom has no constructor type for it, so a minimal local shape is
 * declared below (no `as` casts — the Window augmentation gives us a typed
 * optional constructor).
 *
 * Design notes:
 *   - `lang` follows the browser UI locale (chrome.i18n.getUILanguage()),
 *     so a Turkish Chrome dictates in Turkish. Without it, recognition is
 *     pinned to the side panel document's hardcoded `lang="en"`.
 *   - Final transcripts are delivered through a ref-held callback that is
 *     refreshed every render, so across events the callback always sees the
 *     current composer value. Within ONE `onresult` event several results
 *     can finalize at once; those are joined and delivered in a single
 *     callback so a read-modify-write consumer can't drop the earlier ones.
 *   - Recognition auto-stops after silence; while the user-intent flag is
 *     still on we restart it, so one click means "listen until I toggle
 *     you off". Restart is skipped after fatal errors (permission denied).
 *   - 'not-allowed' means the chrome-extension:// origin lacks mic
 *     permission. The side panel can't reliably show the permission prompt
 *     itself; the Options page Microphone tab (a full tab) can, so we
 *     surface that as the fix in `error`.
 */

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export interface SpeechToTextState {
  /** False when the browser has no SpeechRecognition implementation. */
  supported: boolean;
  listening: boolean;
  /** Human-readable failure reason; null while everything is fine. */
  error: string | null;
  /** True when the failure is missing mic permission — fixable in Options. */
  permissionDenied: boolean;
  start: () => void;
  stop: () => void;
}

/** @param onFinalText Called once per result event with the newly finalized utterance(s), space-joined. */
export function useSpeechToText(onFinalText: (text: string) => void): SpeechToTextState {
  const supported = typeof window !== 'undefined' && typeof window.webkitSpeechRecognition === 'function';
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** User intent: keep listening across silence-triggered auto-ends. */
  const wantedRef = useRef(false);
  const onFinalTextRef = useRef(onFinalText);

  useEffect(() => {
    onFinalTextRef.current = onFinalText;
  }, [onFinalText]);

  const stop = useCallback(() => {
    wantedRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = window.webkitSpeechRecognition;
    if (!Ctor || wantedRef.current) return;

    const recognition = new Ctor();
    recognition.lang = chrome.i18n.getUILanguage();
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = event => {
      const finals: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const transcript = result[0]?.transcript.trim();
        if (transcript) finals.push(transcript);
      }
      if (finals.length > 0) onFinalTextRef.current(finals.join(' '));
    };

    recognition.onerror = event => {
      // Events from a superseded instance (stopped, then start() created a
      // fresh one before this one wound down) must not touch shared state.
      if (recognitionRef.current !== recognition) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantedRef.current = false;
        setPermissionDenied(true);
        setError('Microphone access is blocked. Grant it in Settings → Microphone, then try again.');
      } else if (event.error === 'network') {
        wantedRef.current = false;
        setError('Speech recognition needs a network connection.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        wantedRef.current = false;
        setError(`Speech recognition failed (${event.error}).`);
      }
    };

    recognition.onend = () => {
      // Only the current instance may restart or clear state — otherwise a
      // stopped instance's late onend would see the wanted flag a fresh
      // start() just raised and revive itself alongside the new recognizer.
      if (recognitionRef.current !== recognition) return;
      // Silence auto-end: keep going until the user toggles off.
      if (wantedRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          wantedRef.current = false;
        }
      }
      recognitionRef.current = null;
      setListening(false);
    };

    try {
      recognition.start();
    } catch {
      setError('Could not start speech recognition.');
      return;
    }
    recognitionRef.current = recognition;
    wantedRef.current = true;
    setError(null);
    setPermissionDenied(false);
    setListening(true);
  }, []);

  // Detached-recognition guard: stop listening when the panel unmounts.
  useEffect(
    () => () => {
      wantedRef.current = false;
      recognitionRef.current?.abort();
    },
    [],
  );

  // Self-heal a denial: once the user grants mic access (Options tab or
  // chrome://settings) the still-mounted panel re-enables the mic button
  // instead of dead-ending on the sticky permissionDenied flag.
  useEffect(() => {
    if (!permissionDenied) return;
    let active = true;
    let status: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: 'microphone' })
      .then(result => {
        status = result;
        const apply = () => {
          if (active && result.state === 'granted') {
            setPermissionDenied(false);
            setError(null);
          }
        };
        apply();
        result.onchange = apply;
      })
      .catch(() => {
        // Permissions API unavailable — the flag stays until remount.
      });
    return () => {
      active = false;
      if (status) status.onchange = null;
    };
  }, [permissionDenied]);

  return { supported, listening, error, permissionDenied, start, stop };
}
