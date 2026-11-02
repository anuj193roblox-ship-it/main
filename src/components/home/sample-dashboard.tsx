"use client";

// A SAMPLE family dashboard for signed-out visitors. Everything here is fixed fake data written in
// this file. It never calls the database or any API, and nothing on it can change anything:
// every action asks the visitor to log in.
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { TabBar } from "@/components/app/tab-bar";
import { StatusChip, type ChipIcon, type ChipTone } from "@/components/status-chip";
import { Card } from "@/components/ui/card";
import { TimelineItem, type TimelineTone } from "@/components/ui/timeline-item";
import { medicineStates } from "@/design/tokens";

export const SAMPLE_LABEL = "Sample data. Not a real person. Log in to see your own.";
const LOGIN = "/login?next=/app/today";

type Chip = { tone: ChipTone; icon: ChipIcon; word: string };
const chip = (state: keyof typeof medicineStates, word: string): Chip => ({
  tone: medicineStates[state].tone as ChipTone,
  icon: medicineStates[state].icon as ChipIcon,
  word,
});

// Fixed fake data. Generic medicine labels only: no real names, people or doses.
export const SAMPLE = {
  person: "Sample patient",
  updated: "Last check-in 10:05",
  story: "Sample patient took the morning tablets, ate breakfast and went for a short walk. The evening tablet is still to come.",
  medicines: [
    { time: "08:00", name: "Morning tablet", chip: chip("taken", "Taken") },
    { time: "14:00", name: "Afternoon tablet", chip: chip("givenBy", "Given by family") },
    { time: "20:00", name: "Evening tablet", chip: chip("pending", "Due 20:00") },
  ],
  alerts: [
    {
      tone: "danger" as TimelineTone,
      time: "07:40",
      title: "Possible fall reported",
      outcome: "The family called back. Resolved.",
      chip: { tone: "danger", icon: "alert-circle", word: "Urgent" } as Chip,
    },
    {
      tone: "warn" as TimelineTone,
      time: "13:30",
      title: "Lunch not confirmed",
      outcome: "Nurra asked twice. Worth a check.",
      chip: { tone: "warn", icon: "alert-triangle", word: "Check" } as Chip,
    },
  ],
};

function LoginPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div role="status" className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-[calc(100%-2rem)] max-w-[528px] items-center justify-between gap-3 rounded-card border border-line-input bg-surface p-4">
      <span>Log in to use this.</span>
      <span className="flex items-center gap-2">
        <Link href={LOGIN} className="inline-flex min-h-12 items-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
          Log in
        </Link>
        <button type="button" onClick={onClose} className="inline-flex min-h-12 items-center rounded-input border border-line-input px-3 font-medium">
          Close
        </button>
      </span>
    </div>
  );
}

function SmallButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-12 rounded-input border border-line-input bg-surface px-3 text-sm font-medium text-ink hover:bg-primary-tint">
      {children}
    </button>
  );
}

export function SampleDashboard() {
  const [prompt, setPrompt] = useState(false);
  const ask = () => setPrompt(true);

  return (
    <div className="space-y-4 pb-24">
      <p className="rounded-input border border-line-input bg-info-bg p-3 text-sm font-medium text-info-text">{SAMPLE_LABEL}</p>

      <Card labelledBy="sample-person">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sample-person" className="text-xl leading-7 font-semibold">
            {SAMPLE.person}
          </h2>
          <StatusChip tone="ok" icon="check-circle" word="All okay" />
        </div>
        <p className="mt-1 text-sm text-ink-muted">{SAMPLE.updated}</p>
        <p className="mt-3">{SAMPLE.story}</p>
      </Card>

      <Card labelledBy="sample-medicines">
        <h2 id="sample-medicines" className="text-xl leading-7 font-semibold">
          Medicines today
        </h2>
        <ul className="mt-2">
          {SAMPLE.medicines.map((m) => (
            <li key={m.time} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-b-0">
              <span>
                <span className="block text-sm text-ink-muted">{m.time}</span>
                <span className="block font-semibold">{m.name}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusChip {...m.chip} />
                {m.chip.word.startsWith("Due") && <SmallButton onClick={ask}>Nudge</SmallButton>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card labelledBy="sample-alerts">
        <h2 id="sample-alerts" className="text-xl leading-7 font-semibold">
          Alerts today
        </h2>
        <ul className="mt-1">
          {SAMPLE.alerts.map((a) => (
            <TimelineItem
              key={a.time}
              tone={a.tone}
              time={a.time}
              title={a.title}
              outcome={a.outcome}
              chip={<StatusChip {...a.chip} />}
              action={(content) => (
                <button type="button" onClick={ask} className="w-full rounded-input focus:outline-2 focus:outline-primary">
                  {content}
                </button>
              )}
            />
          ))}
        </ul>
      </Card>

      {prompt && <LoginPrompt onClose={() => setPrompt(false)} />}
      <TabBar sample />
    </div>
  );
}
