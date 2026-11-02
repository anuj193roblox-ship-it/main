"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { errorText, sendJson } from "@/components/auth/post-json";
import { StatusChip } from "@/components/status-chip";
import { Button, ChipToggles, Notice, SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { TimesEditor } from "@/components/ui/times-editor";
import { DAY_LABELS, formatDay, formatDays, ITEM_TYPE_LABELS, SEVERITY_LABELS } from "@/lib/care/format";
import type { Schedule } from "@/lib/care/schemas";
import { type ReviewView, ReviewPrompt } from "./review-prompt";

export type PlanItemView = {
  id: string;
  itemType: string;
  title: string;
  severity: "normal" | "important" | "critical";
  details: string;
  schedule: Schedule;
  medicationId: string | null;
  medicationName: string;
  medicationUnverified: boolean;
  isPlaceholder: boolean;
  active: boolean;
};

export type MedicineOption = { id: string; label: string; unverified: boolean; stopped: boolean };
export type PresetOption = { key: string; label: string; summary: string };

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_OPTIONS = DAY_LABELS.map((label, value) => ({ value, label }));
const TYPE_OPTIONS = Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const SEVERITY_OPTIONS = Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }));

const SEVERITY_CHIP = {
  normal: { tone: "neutral", icon: "clock", word: "Normal" },
  important: { tone: "warn", icon: "alert-triangle", word: "Important" },
  critical: { tone: "danger", icon: "alert-circle", word: "Critical" },
} as const;

export function scheduleText(s: Schedule): string {
  if (s.kind === "interval") return `Every ${s.everyMinutes} minutes from ${s.from} to ${s.to}. ${formatDays(s.days)}`;
  if (s.kind === "once") return `${formatDay(s.date)} at ${s.times.join(", ")}`;
  return `${s.times.join(", ")}. ${formatDays(s.days)}`;
}

function useMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await sendJson(method, url, body ?? {});
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res));
      return null;
    }
    router.refresh();
    return res.data;
  }
  return { busy, error, run, refresh: () => router.refresh() };
}

type Draft = {
  itemType: string;
  title: string;
  severity: PlanItemView["severity"];
  details: string;
  kind: Schedule["kind"];
  times: string[];
  days: number[];
  everyMinutes: string;
  from: string;
  to: string;
  date: string;
  medicationId: string;
};

function toDraft(item?: PlanItemView): Draft {
  const s = item?.schedule;
  return {
    itemType: item?.itemType ?? "meal",
    title: item?.title ?? "",
    severity: item?.severity ?? "normal",
    details: item?.details ?? "",
    kind: s?.kind ?? "times",
    times: s && s.kind !== "interval" ? s.times : ["08:00"],
    days: s && s.kind !== "once" ? s.days : ALL_DAYS,
    everyMinutes: s?.kind === "interval" ? String(s.everyMinutes) : "120",
    from: s?.kind === "interval" ? s.from : "09:00",
    to: s?.kind === "interval" ? s.to : "19:00",
    date: s?.kind === "once" ? s.date : "",
    medicationId: item?.medicationId ?? "",
  };
}

function fromDraft(d: Draft) {
  const schedule =
    d.kind === "interval"
      ? { kind: "interval", everyMinutes: Number(d.everyMinutes), from: d.from, to: d.to, days: d.days }
      : d.kind === "once"
        ? { kind: "once", date: d.date, times: d.times }
        : { kind: "times", times: d.times, days: d.days };
  return {
    itemType: d.itemType,
    title: d.title,
    severity: d.severity,
    details: d.details,
    schedule,
    medicationId: d.itemType === "medication" && d.medicationId ? d.medicationId : undefined,
  };
}

function ItemForm({ item, medicines, onClose }: { item?: PlanItemView; medicines: MedicineOption[]; onClose: () => void }) {
  const [d, setD] = useState<Draft>(toDraft(item));
  const m = useMutation();
  const chosen = medicines.find((x) => x.id === d.medicationId);
  const kinds = [
    { value: "times", label: "At set times" },
    ...(d.itemType === "water" ? [{ value: "interval", label: "Every few minutes" }] : []),
    { value: "once", label: "On one date" },
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await m.run(item ? "PATCH" : "POST", item ? `/api/plan/items/${item.id}` : "/api/plan/items", fromDraft(d));
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-card border border-line-input bg-surface p-4" noValidate>
      <h3 className="text-lg font-semibold">{item ? (item.isPlaceholder ? "Link a medicine" : "Edit plan item") : "Add to the plan"}</h3>
      {m.error && <Notice tone="danger">{m.error}</Notice>}
      <SelectField
        label="Type"
        name="itemType"
        value={d.itemType}
        onChange={(itemType) => setD({ ...d, itemType, kind: itemType !== "water" && d.kind === "interval" ? "times" : d.kind })}
        options={TYPE_OPTIONS}
      />
      {d.itemType === "medication" && (
        <div className="space-y-2">
          {medicines.length === 0 ? (
            <Notice tone="info">Add the medicine to the Vault first, then link it here.</Notice>
          ) : (
            <SelectField
              label="Medicine from the Vault"
              name="medicationId"
              value={d.medicationId}
              onChange={(medicationId) => setD({ ...d, medicationId })}
              options={[{ value: "", label: "Choose a medicine" }, ...medicines.map((x) => ({ value: x.id, label: `${x.label}${x.unverified ? " (Unverified)" : ""}${x.stopped ? " (stopped)" : ""}` }))]}
            />
          )}
          {chosen?.unverified && <StatusChip tone="warn" icon="alert-triangle" word="Unverified medicine: approve it in the Vault" />}
        </div>
      )}
      <TextField label="Title" name="title" hint="Short, as Nurra will say it. For example: Morning medicines" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      <SelectField label="How important" name="severity" value={d.severity} onChange={(severity) => setD({ ...d, severity: severity as Draft["severity"] })} options={SEVERITY_OPTIONS} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When</legend>
        {kinds.map((k) => (
          <label key={k.value} className="flex min-h-12 items-center gap-3 rounded-input border border-line-input px-3">
            <input type="radio" name="kind" value={k.value} checked={d.kind === k.value} onChange={() => setD({ ...d, kind: k.value as Draft["kind"] })} className="h-5 w-5 accent-primary" />
            {k.label}
          </label>
        ))}
      </fieldset>

      {d.kind === "interval" ? (
        <div className="space-y-3">
          <TextField label="Every how many minutes" name="everyMinutes" inputMode="numeric" hint="Between 15 and 240" value={d.everyMinutes} onChange={(e) => setD({ ...d, everyMinutes: e.target.value.replace(/\D/g, "") })} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="From" name="from" type="time" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} />
            <TextField label="Until" name="to" type="time" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} />
          </div>
        </div>
      ) : (
        <>
          {d.kind === "once" && <TextField label="Date" name="date" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />}
          <TimesEditor id="item-times" legend="Times of day" times={d.times} onChange={(times) => setD({ ...d, times })} />
        </>
      )}
      {d.kind !== "once" && <ChipToggles legend="Days" options={DAY_OPTIONS} selected={d.days} onChange={(days) => setD({ ...d, days })} />}
      <TextAreaField label="Details (optional)" name="details" value={d.details} onChange={(details) => setD({ ...d, details })} />

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="submit" busy={m.busy}>
          {m.busy ? "Saving" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ItemCard({ item, onEdit, onDelete, busy }: { item: PlanItemView; onEdit: () => void; onDelete: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const btn = "min-h-12 rounded-input border border-line-input bg-surface px-3 text-sm font-medium hover:bg-primary-tint";
  return (
    <li className="space-y-2 rounded-card border border-line bg-primary-tint p-4">
      <p className="text-sm text-ink-muted">{ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}</p>
      <p className="text-lg font-semibold">{item.title}</p>
      <p>{scheduleText(item.schedule)}</p>
      {item.medicationName && <p className="text-ink-muted">Medicine: {item.medicationName}</p>}
      {item.details && <p className="whitespace-pre-wrap">{item.details}</p>}
      <div className="flex flex-wrap gap-2">
        <StatusChip {...SEVERITY_CHIP[item.severity]} />
        {item.isPlaceholder && <StatusChip tone="warn" icon="alert-triangle" word="Needs a medicine from the Vault" />}
        {item.medicationUnverified && <StatusChip tone="warn" icon="alert-triangle" word="Unverified medicine" />}
        {!item.active && !item.isPlaceholder && <StatusChip tone="neutral" icon="clock" word="Off" />}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onEdit} className={item.isPlaceholder ? "min-h-12 rounded-input bg-primary px-3 text-sm font-medium text-white hover:bg-primary-pressed" : btn}>
          {item.isPlaceholder ? "Link a medicine" : "Edit"}
        </button>
        {confirming ? (
          <>
            <button type="button" onClick={onDelete} disabled={busy} className="min-h-12 rounded-input bg-danger-btn px-3 text-sm font-medium text-white">
              Confirm delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btn}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={btn}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function PresetChooser({ presets }: { presets: PresetOption[] }) {
  const [choice, setChoice] = useState(presets[0]?.key ?? "dementia");
  const m = useMutation();
  return (
    <section aria-labelledby="presets" className="space-y-3 rounded-card border border-line bg-primary-tint p-4">
      <h2 id="presets" className="text-xl leading-7 font-semibold">
        Start from a routine
      </h2>
      <p className="text-ink-muted">A preset adds meals, water, activity and empty medicine slots. Link each slot to a medicine from the Vault.</p>
      {m.error && <Notice tone="danger">{m.error}</Notice>}
      <fieldset className="space-y-2">
        <legend className="sr-only">Preset</legend>
        {presets.map((p) => (
          <label key={p.key} className="flex min-h-12 items-start gap-3 rounded-input border border-line-input bg-surface p-3">
            <input type="radio" name="preset" value={p.key} checked={choice === p.key} onChange={() => setChoice(p.key)} className="mt-1 h-5 w-5 accent-primary" />
            <span>
              <span className="block font-medium">{p.label}</span>
              <span className="block text-sm text-ink-muted">{p.summary}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button busy={m.busy} onClick={() => m.run("POST", "/api/plan", { preset: choice })}>
        {m.busy ? "Adding" : "Use this routine"}
      </Button>
    </section>
  );
}

export function PlanScreen({ items, medicines, reviews, presets }: { items: PlanItemView[]; medicines: MedicineOption[]; reviews: ReviewView[]; presets: PresetOption[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const m = useMutation();
  const placeholders = items.filter((i) => i.isPlaceholder).length;

  return (
    <div className="space-y-6">
      {reviews.map((r) => (
        <ReviewPrompt key={r.itemId} review={r} onDone={m.refresh} />
      ))}
      {items.length === 0 && <PresetChooser presets={presets} />}
      {placeholders > 0 && (
        <Notice tone="info">
          {placeholders === 1 ? "1 medicine slot needs" : `${placeholders} medicine slots need`} a medicine from the Vault before it can remind anyone.
        </Notice>
      )}
      {m.error && <Notice tone="danger">{m.error}</Notice>}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl leading-7 font-semibold">
          Plan items <span className="text-base font-normal text-ink-muted">({items.length})</span>
        </h2>
        {editing !== "new" && (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex min-h-12 items-center gap-1 rounded-input border border-line-input px-3 font-medium hover:bg-primary-tint">
            <Icon name="plus" /> Add
          </button>
        )}
      </div>
      {editing === "new" && <ItemForm medicines={medicines} onClose={() => setEditing(null)} />}
      <ul className="space-y-3">
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id}>
              <ItemForm item={item} medicines={medicines} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <ItemCard key={item.id} item={item} busy={m.busy} onEdit={() => setEditing(item.id)} onDelete={() => m.run("DELETE", `/api/plan/items/${item.id}`)} />
          ),
        )}
      </ul>
      <p className="text-sm text-ink-muted">The plan is saved now. Reminders start in a later stage.</p>
    </div>
  );
}
