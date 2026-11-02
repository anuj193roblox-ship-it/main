"use client";

// Browser speech, input and output. Nurra never records audio itself: the browser's own speech
// recognition turns speech into text, and only that text is sent to the server.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/** The minimal part of the Web Speech API we use. Not in TypeScript's DOM library. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

export const SPEECH_LANG: Record<string, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

/** The browser's SpeechRecognition constructor, or null when there is none (then typing is used). */
export function getRecognitionCtor(win: unknown): RecognitionCtor | null {
  if (!win || typeof win !== "object") return null;
  const w = win as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribeNothing = () => () => {};

/** false on the server and in browsers without speech recognition. */
export function useSpeechInputSupported(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => getRecognitionCtor(window) !== null,
    () => false,
  );
}

/** Listens once and returns the transcript text. */
export function useListen(language: string) {
  const current = useRef<Recognition | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  const listen = useCallback(
    (onText: (text: string) => void, onDone: (error?: string) => void) => {
      const Ctor = getRecognitionCtor(window);
      if (!Ctor) return onDone("unsupported");
      const rec = new Ctor();
      rec.lang = SPEECH_LANG[language] ?? "en-IN";
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let got = false;
      rec.onresult = (e) => {
        const text = e.results[0]?.[0]?.transcript?.trim() ?? "";
        if (text) {
          got = true;
          onText(text);
        }
      };
      rec.onerror = (e) => onDone(e.error);
      rec.onend = () => {
        current.current = null;
        if (!got) onDone("no-speech");
        else onDone();
      };
      current.current = rec;
      rec.start();
    },
    [language],
  );

  const stop = useCallback(() => current.current?.abort(), []);
  return { listen, stop };
}

export type VoiceSettings = { rate: number; volume: number };
export const DEFAULT_VOICE: VoiceSettings = { rate: 0.85, volume: 1 };

/** Speaks a line with the browser's voice. Subtitles are always shown as well. */
export function speak(text: string, language: string, settings: VoiceSettings, events: { onStart: () => void; onEnd: () => void }) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return events.onEnd();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[language] ?? "en-IN";
  u.rate = settings.rate;
  u.volume = settings.volume;
  u.onstart = events.onStart;
  u.onend = events.onEnd;
  u.onerror = events.onEnd;
  synth.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}
