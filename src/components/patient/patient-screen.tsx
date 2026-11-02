"use client";

import { type FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { postJson } from "@/components/auth/post-json";
import { DEFAULT_VOICE, speak, stopSpeaking, useListen, useSpeechInputSupported, type VoiceSettings } from "./speech";

export type PatientScreenProps = {
  preferredName: string;
  language: "en" | "hi" | "kn";
  timezone: string;
  contact: { name: string; phone: string } | null;
  reminder: { id: string; title: string } | null;
  demoMode: boolean;
};

/** Spec states: idle, speaking, listening, reminder, confirmed, calling-family, offline. */
export type PatientState = "idle" | "speaking" | "listening" | "thinking" | "reminder" | "confirmed" | "calling-family" | "offline";

// Patient mode contrast is 7:1 or more: ink on cream (14.1), white on primary-pressed (8.2),
// ink on white (14.8). Muted and status text colours are not used here.
const BIG_PRIMARY =
  "flex min-h-[72px] w-full items-center justify-center rounded-patient-button bg-primary-pressed px-6 text-[28px] leading-10 font-semibold text-white focus:outline-4 focus:outline-offset-4 focus:outline-ink disabled:opacity-80";
const BIG_SECONDARY =
  "flex min-h-[72px] w-full items-center justify-center rounded-patient-button border-2 border-ink bg-surface px-6 text-[28px] leading-10 font-semibold text-ink focus:outline-4 focus:outline-offset-4 focus:outline-ink";

const subscribeClock = (cb: () => void) => {
  const id = window.setInterval(cb, 15_000);
  return () => window.clearInterval(id);
};
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

function clockParts(timezone: string, ms: number) {
  const d = new Date(ms);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(d);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long" }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(d));
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return { time, date, weekday, part };
}

function loadVoice(): VoiceSettings {
  if (typeof window === "undefined") return DEFAULT_VOICE;
  try {
    const v = JSON.parse(window.localStorage.getItem("nurra_voice") ?? "{}") as Partial<VoiceSettings>;
    return { rate: Number(v.rate) || DEFAULT_VOICE.rate, volume: Number.isFinite(Number(v.volume)) ? Number(v.volume) : DEFAULT_VOICE.volume };
  } catch {
    return DEFAULT_VOICE;
  }
}

export function PatientScreen({ preferredName, language, timezone, contact, reminder: initialReminder, demoMode }: PatientScreenProps) {
  const now = useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 15_000) * 15_000, () => 0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const speechInput = useSpeechInputSupported();
  const { listen, stop } = useListen(language);

  const clock = now ? clockParts(timezone, now) : null;
  const [line, setLine] = useState<string | null>(null);
  const [state, setState] = useState<PatientState>(initialReminder ? "reminder" : "idle");
  const [reminder, setReminder] = useState(initialReminder);
  const [typed, setTyped] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [voice, setVoice] = useState<VoiceSettings>(loadVoice);
  const [showSettings, setShowSettings] = useState(false);

  const greeting = clock ? `${clock.part}, ${preferredName}. It's ${clock.weekday}.` : `Hello, ${preferredName}.`;
  const shownLine = line ?? (reminder ? `It is time for ${reminder.title.toLowerCase()}, ${preferredName}.` : greeting);
  const view: PatientState = online ? state : "offline";

  const say = useCallback(
    (text: string, after: PatientState) => {
      setLine(text);
      speak(text, language, voice, { onStart: () => setState("speaking"), onEnd: () => setState(after) });
    },
    [language, voice],
  );

  useEffect(() => {
    window.localStorage.setItem("nurra_voice", JSON.stringify(voice));
  }, [voice]);

  async function sendText(text: string, source: "voice" | "typed") {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    setState("thinking");
    const res = await postJson("/api/checkin", { text: clean, source, reminderId: reminder?.id });
    const body = res.data as { say?: string; reminderConfirmed?: boolean; redFlag?: boolean; error?: string };
    if (body.redFlag) setUrgent(true);
    if (body.reminderConfirmed) {
      setReminder(null);
      say(body.say ?? "Thank you.", "confirmed");
      window.setTimeout(() => setState("idle"), 6000);
      return;
    }
    say(body.say ?? body.error ?? `I am here with you, ${preferredName}.`, reminder ? "reminder" : "idle");
  }

  async function answer(kind: "taken" | "not_yet") {
    if (!reminder) return;
    setState("thinking");
    const res = await postJson(`/api/reminders/${reminder.id}/confirm`, { answer: kind, source: "tap" });
    const body = res.data as { say?: string; confirmed?: boolean };
    if (body.confirmed) {
      setReminder(null);
      say(body.say ?? "Thank you.", "confirmed");
      window.setTimeout(() => setState("idle"), 6000);
    } else {
      // "Not yet": the card goes away for now. It is not pushed again from here.
      setReminder(null);
      say(body.say ?? "That is alright.", "idle");
    }
  }

  function talk() {
    if (state === "listening") return stop();
    stopSpeaking();
    setState("listening");
    listen(
      (text) => void sendText(text, "voice"),
      (error) => {
        if (error === "no-speech") say(`I did not hear anything, ${preferredName}. Shall we try again?`, reminder ? "reminder" : "idle");
        else if (error) setState(reminder ? "reminder" : "idle");
      },
    );
  }

  function onType(e: FormEvent) {
    e.preventDefault();
    const text = typed;
    setTyped("");
    void sendText(text, "typed");
  }

  function callFamily() {
    setState("calling-family");
    void fetch("/api/patient/call-family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: urgent ? "red_flag" : "button" }),
      keepalive: true,
    });
    window.setTimeout(() => setState(reminder ? "reminder" : "idle"), 15_000);
  }

  async function demoReminder() {
    const res = await postJson("/api/patient/demo-reminder");
    if (res.ok) window.location.reload();
    else setLine(typeof res.data.error === "string" ? res.data.error : "That did not work.");
  }

  const speaking = view === "speaking";
  const busy = view === "thinking" || view === "listening";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[640px] flex-1 flex-col gap-6 px-5 py-6 text-ink" data-state={view}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[56px] leading-[64px] font-bold tabular-nums" aria-label={clock ? `The time is ${clock.time}` : undefined}>
            {clock?.time ?? " "}
          </p>
          <p className="text-[28px] leading-10">{clock?.date ?? " "}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          className="min-h-[72px] rounded-patient-button border-2 border-ink bg-surface px-4 text-[28px] font-semibold text-ink"
        >
          Voice
        </button>
      </header>

      {showSettings && (
        <section aria-label="Voice settings" className="space-y-4 rounded-card border-2 border-ink bg-surface p-4 text-[28px] leading-10">
          <label className="block">
            Speed
            <input
              type="range"
              min={0.5}
              max={1.3}
              step={0.05}
              value={voice.rate}
              onChange={(e) => setVoice({ ...voice, rate: Number(e.target.value) })}
              className="mt-2 block h-12 w-full accent-primary-pressed"
            />
          </label>
          <label className="block">
            Volume
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.1}
              value={voice.volume}
              onChange={(e) => setVoice({ ...voice, volume: Number(e.target.value) })}
              className="mt-2 block h-12 w-full accent-primary-pressed"
            />
          </label>
        </section>
      )}

      {view === "offline" && (
        <p role="status" className="rounded-card border-2 border-ink bg-surface p-4 text-[28px] leading-10">
          Not connected. Nurra will work again when the internet is back.
        </p>
      )}

      {/* Nurra's line, always as subtitles. The pulse is on the circle, never on the text. */}
      <section className="flex items-start gap-4" aria-live="polite">
        <span aria-hidden="true" className={`mt-2 h-8 w-8 shrink-0 rounded-full bg-primary-pressed ${speaking ? "nurra-speaking" : ""}`} />
        <p className="text-[28px] leading-10">{shownLine}</p>
      </section>

      <div className="flex flex-1 flex-col justify-center gap-6">
        {view === "reminder" && reminder && (
          <section aria-labelledby="reminder-title" className="space-y-4 rounded-card border-2 border-ink bg-surface p-5">
            <h2 id="reminder-title" className="text-[32px] leading-10 font-bold">
              {reminder.title}
            </h2>
            <button type="button" className={BIG_PRIMARY} onClick={() => answer("taken")}>
              Yes, I took them
            </button>
            <button type="button" className={BIG_SECONDARY} onClick={() => answer("not_yet")}>
              Not yet
            </button>
            {speechInput && (
              // Spoken answers go through the check-in: only an exact clear "yes" confirms.
              <button type="button" className={BIG_SECONDARY} onClick={talk}>
                Answer by voice
              </button>
            )}
          </section>
        )}

        {view === "confirmed" && (
          <p role="status" className="text-center text-[40px] leading-[48px] font-bold">
            Done. Thank you.
          </p>
        )}

        {view === "calling-family" && contact && (
          <p role="status" className="text-center text-[32px] leading-10 font-bold">
            Calling {contact.name}
          </p>
        )}

        {(view === "idle" || view === "speaking" || view === "listening" || view === "thinking") && (
          <div className="flex flex-col items-center gap-6">
            {speechInput && (
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={talk}
                  disabled={view === "thinking"}
                  aria-label={view === "listening" ? "Stop listening" : "Talk to Nurra"}
                  className={`flex h-[120px] w-[120px] items-center justify-center rounded-full bg-primary-pressed text-white focus:outline-4 focus:outline-offset-4 focus:outline-ink ${
                    view === "listening" ? "nurra-speaking" : ""
                  }`}
                >
                  <svg aria-hidden="true" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3" />
                  </svg>
                </button>
                <span className="text-[28px] leading-10 font-semibold">{view === "listening" ? "Listening" : view === "thinking" ? "One moment" : "Talk to Nurra"}</span>
              </div>
            )}

            <form onSubmit={onType} className="w-full space-y-3" aria-label="Type to Nurra">
              <label htmlFor="patient-typed" className="block text-[28px] leading-10 font-semibold">
                {speechInput ? "Or type to Nurra" : "Type to Nurra"}
              </label>
              <input
                id="patient-typed"
                name="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                maxLength={500}
                autoComplete="off"
                autoFocus={!speechInput}
                disabled={busy}
                className="min-h-[72px] w-full rounded-patient-button border-2 border-ink bg-surface px-5 text-[28px] text-ink focus:outline-4 focus:outline-offset-2 focus:outline-primary-pressed"
              />
              <button type="submit" className={BIG_PRIMARY} disabled={busy || !typed.trim()}>
                Send
              </button>
            </form>
          </div>
        )}
      </div>

      {contact && (
        <a
          href={`tel:${contact.phone}`}
          onClick={callFamily}
          className={`${urgent ? BIG_PRIMARY : BIG_SECONDARY} flex-col py-2`}
        >
          <span>Call my family</span>
          <span className="text-[28px] leading-10 font-normal">{contact.name}</span>
        </a>
      )}

      {demoMode && (
        <button type="button" onClick={demoReminder} className="min-h-[72px] self-center rounded-patient-button border-2 border-dashed border-ink px-5 text-[28px] text-ink">
          Demo: show a reminder now
        </button>
      )}
    </main>
  );
}
