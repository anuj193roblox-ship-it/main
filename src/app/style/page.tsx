import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusChip, type ChipIcon, type ChipTone } from "@/components/status-chip";
import { medicineStates } from "@/design/tokens";
import { isStylePageEnabled } from "@/lib/demo";

export const metadata: Metadata = { title: "Nurra style page" };

// Decide at request time, so the environment at runtime (not build time) controls access.
export const dynamic = "force-dynamic";

// Class names are written out in full so Tailwind can see them at build time.
const swatches = [
  { name: "primary", cls: "bg-primary" },
  { name: "primary-pressed", cls: "bg-primary-pressed" },
  { name: "primary-tint", cls: "bg-primary-tint" },
  { name: "primary-tint-2", cls: "bg-primary-tint-2" },
  { name: "bg-patient", cls: "bg-patient" },
  { name: "ink (text)", cls: "bg-ink" },
  { name: "ink-muted", cls: "bg-ink-muted" },
  { name: "ink-placeholder", cls: "bg-ink-placeholder" },
  { name: "line (border)", cls: "bg-line" },
  { name: "line-input", cls: "bg-line-input" },
  { name: "ok", cls: "bg-ok" },
  { name: "warn", cls: "bg-warn" },
  { name: "danger", cls: "bg-danger" },
  { name: "info", cls: "bg-info" },
  { name: "danger-btn", cls: "bg-danger-btn" },
];

const chips: { key: string; label: string; tone: ChipTone; icon: ChipIcon; word: string }[] = [
  { key: "taken", label: "Taken", ...pick("taken", "Taken") },
  { key: "givenBy", label: "Given by Anita", ...pick("givenBy", "Given by Anita") },
  { key: "pending", label: "Due 8:00", ...pick("pending", "Due 8:00") },
  { key: "missed", label: "Missed", ...pick("missed", "Missed") },
  { key: "refused", label: "Refused", ...pick("refused", "Refused") },
  { key: "unverified", label: "Unverified", ...pick("unverified", "Unverified") },
  { key: "verified", label: "Verified by Dr Rao", ...pick("verified", "Verified by Dr Rao") },
];

function pick(state: keyof typeof medicineStates, word: string) {
  const s = medicineStates[state];
  return { tone: s.tone as ChipTone, icon: s.icon as ChipIcon, word };
}

function ChipRow() {
  return (
    <div className="flex flex-wrap gap-3">
      {chips.map((c) => (
        <StatusChip key={c.key} tone={c.tone} icon={c.icon} word={c.word} />
      ))}
    </div>
  );
}

export default function StylePage() {
  if (!isStylePageEnabled()) notFound();
  return (
    <main className="mx-auto w-full max-w-[390px] space-y-8 p-4 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-[28px] leading-9 font-bold">Nurra style page</h1>
        <p className="text-ink-muted">Design tokens from spec section 3. Family app, Inter.</p>
      </header>

      <section aria-labelledby="colours" className="space-y-3">
        <h2 id="colours" className="text-xl leading-7 font-semibold">
          Colours
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {swatches.map((s) => (
            <li key={s.name} className="rounded-card border border-line p-2">
              <div className={`h-10 rounded-input border border-line ${s.cls}`} />
              <p className="mt-1 text-sm">{s.name}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="chips" className="space-y-3">
        <h2 id="chips" className="text-xl leading-7 font-semibold">
          Status chips
        </h2>
        <p className="text-ink-muted">Every status has a colour, an icon and a word.</p>
        <ChipRow />
      </section>

      <section aria-labelledby="type" className="space-y-3">
        <h2 id="type" className="text-xl leading-7 font-semibold">
          Type and controls
        </h2>
        <div className="rounded-card border border-line bg-primary-tint p-4 space-y-3">
          <p className="text-[32px] leading-10 font-bold">3 of 4 tablets taken</p>
          <p>Body text, 16 on 24. Short warm sentences, sentence case.</p>
          <p className="text-sm leading-5 text-ink-muted">Caption, 14 on 20.</p>
          <label className="block text-sm font-medium" htmlFor="sample">
            Sample input
          </label>
          <input
            id="sample"
            placeholder="Placeholder text"
            className="min-h-12 w-full rounded-input border border-line-input bg-surface px-3 placeholder:text-ink-placeholder"
          />
          <div className="flex gap-3">
            <button className="min-h-12 rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
              Save
            </button>
            <button className="min-h-12 rounded-input bg-danger-btn px-4 font-medium text-white">Remove</button>
          </div>
        </div>
      </section>

      <section aria-labelledby="patient" className="space-y-3">
        <h2 id="patient" className="text-xl leading-7 font-semibold">
          Patient mode preview
        </h2>
        <div className="rounded-card border border-line bg-patient p-6 font-patient space-y-4">
          <p className="text-[56px] leading-[64px] font-bold">8:00</p>
          <p className="text-[40px] leading-[48px] font-bold">Good morning, Meera. It&apos;s Sunday.</p>
          <p className="flex items-start gap-3 text-[28px] leading-10">
            <span aria-hidden="true" className="nurra-speaking mt-3 h-4 w-4 shrink-0 rounded-full bg-primary" />
            Shall we take your tablets now?
          </p>
          <button className="min-h-[72px] w-full rounded-patient-button bg-primary text-[28px] font-semibold text-white hover:bg-primary-pressed">
            Yes, I took them
          </button>
          <div className="flex flex-col items-center gap-2">
            <button
              aria-label="Talk to Nurra"
              className="h-[120px] w-[120px] rounded-full bg-primary text-white hover:bg-primary-pressed"
            >
              <svg aria-hidden="true" className="mx-auto" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
            <span className="text-[28px] leading-10">Talk to Nurra</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="dark" className="space-y-3">
        <h2 id="dark" className="text-xl leading-7 font-semibold">
          Dark mode (family app only)
        </h2>
        <div data-theme="dark" className="rounded-card border border-line-input bg-bg p-4 space-y-3 text-ink">
          <p className="text-ink-muted">Outlined chips on the dark surface.</p>
          <ChipRow />
        </div>
      </section>
    </main>
  );
}
