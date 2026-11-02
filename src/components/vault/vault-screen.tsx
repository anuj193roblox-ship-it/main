"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { errorText, sendJson } from "@/components/auth/post-json";
import { type ReviewView, ReviewPrompt } from "@/components/plan/review-prompt";
import { StatusChip, type ChipIcon, type ChipTone } from "@/components/status-chip";
import { Button, Notice, SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { TimesEditor } from "@/components/ui/times-editor";
import { formatDay } from "@/lib/care/format";

export type ChipSpec = { tone: ChipTone; icon: ChipIcon; word: string };

export type ConditionView = { id: string; name: string; since: string; treatingDoctor: string; notes: string };
export type AllergyView = { id: string; substance: string; reaction: string; severity: "mild" | "moderate" | "severe" };
export type MedicineView = {
  id: string;
  brandName: string;
  genericName: string;
  ingredient: string;
  strength: string;
  dose: string;
  frequency: string;
  timing: string[];
  withFood: "" | "before" | "with" | "after" | "any";
  purpose: string;
  prescriber: string;
  startDate: string;
  stopDate: string;
  status: "active" | "stopped";
  chips: ChipSpec[];
  canApprove: boolean;
  canVerify: boolean;
};

const WITH_FOOD = [
  { value: "", label: "Not set" },
  { value: "before", label: "Before food" },
  { value: "with", label: "With food" },
  { value: "after", label: "After food" },
  { value: "any", label: "With or without food" },
] as const;
const SEVERITY = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

/** Shared save logic: one error line, refresh the server data after a change. */
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

function Section({ id, title, count, onAdd, adding, children }: { id: string; title: string; count: number; onAdd: () => void; adding: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-xl leading-7 font-semibold">
          {title} <span className="text-base font-normal text-ink-muted">({count})</span>
        </h2>
        {!adding && (
          <button type="button" onClick={onAdd} className="inline-flex min-h-12 items-center gap-1 rounded-input border border-line-input px-3 font-medium hover:bg-primary-tint">
            <Icon name="plus" /> Add
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function RowCard({ children }: { children: ReactNode }) {
  return <li className="space-y-2 rounded-card border border-line bg-primary-tint p-4">{children}</li>;
}

function RowActions({ onEdit, onDelete, busy, extra }: { onEdit: () => void; onDelete: () => void; busy: boolean; extra?: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const btn = "min-h-12 rounded-input border border-line-input bg-surface px-3 text-sm font-medium hover:bg-primary-tint";
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <button type="button" onClick={onEdit} className={btn}>
        Edit
      </button>
      {extra}
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
  );
}

function FormFrame({ title, onSubmit, onCancel, busy, error, children }: { title: string; onSubmit: (e: FormEvent) => void; onCancel: () => void; busy: boolean; error: string | null; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-card border border-line-input bg-surface p-4" noValidate>
      <h3 className="text-lg font-semibold">{title}</h3>
      {error && <Notice tone="danger">{error}</Notice>}
      {children}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="submit" busy={busy}>
          {busy ? "Saving" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---- Conditions ----------------------------------------------------------------------------

const EMPTY_CONDITION = { name: "", since: "", treatingDoctor: "", notes: "" };

function ConditionForm({ initial, id, onClose }: { initial: Omit<ConditionView, "id">; id?: string; onClose: () => void }) {
  const [c, setC] = useState(initial);
  const m = useMutation();
  return (
    <FormFrame
      title={id ? "Edit condition" : "Add a condition"}
      busy={m.busy}
      error={m.error}
      onCancel={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await m.run(id ? "PATCH" : "POST", id ? `/api/vault/conditions/${id}` : "/api/vault/conditions", c)) onClose();
      }}
    >
      <TextField label="Condition" name="conditionName" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
      <TextField label="Since" name="conditionSince" type="date" value={c.since} onChange={(e) => setC({ ...c, since: e.target.value })} />
      <TextField label="Treating doctor" name="conditionDoctor" value={c.treatingDoctor} onChange={(e) => setC({ ...c, treatingDoctor: e.target.value })} />
      <TextAreaField label="Notes" name="conditionNotes" value={c.notes} onChange={(notes) => setC({ ...c, notes })} />
    </FormFrame>
  );
}

/** One condition. Notes are user text: rendered as text, never as HTML. */
export function ConditionCard({ c, onEdit, onDelete, busy }: { c: ConditionView; onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <RowCard>
      <p className="text-lg font-semibold">{c.name}</p>
      {(c.since || c.treatingDoctor) && (
        <p className="text-ink-muted">
          {c.since && `Since ${formatDay(c.since)}`}
          {c.since && c.treatingDoctor && ". "}
          {c.treatingDoctor && `Doctor: ${c.treatingDoctor}`}
        </p>
      )}
      {c.notes && <p className="whitespace-pre-wrap">{c.notes}</p>}
      <RowActions onEdit={onEdit} onDelete={onDelete} busy={busy} />
    </RowCard>
  );
}

function Conditions({ items }: { items: ConditionView[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const m = useMutation();
  return (
    <Section id="conditions" title="Conditions" count={items.length} onAdd={() => setEditing("new")} adding={editing === "new"}>
      {editing === "new" && <ConditionForm initial={EMPTY_CONDITION} onClose={() => setEditing(null)} />}
      {m.error && <Notice tone="danger">{m.error}</Notice>}
      {items.length === 0 && editing !== "new" && <p className="text-ink-muted">No conditions yet.</p>}
      <ul className="space-y-3">
        {items.map((c) =>
          editing === c.id ? (
            <li key={c.id}>
              <ConditionForm id={c.id} initial={c} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <ConditionCard key={c.id} c={c} busy={m.busy} onEdit={() => setEditing(c.id)} onDelete={() => m.run("DELETE", `/api/vault/conditions/${c.id}`)} />
          ),
        )}
      </ul>
    </Section>
  );
}

// ---- Medicines -----------------------------------------------------------------------------

const EMPTY_MEDICINE: Omit<MedicineView, "id" | "chips" | "canApprove" | "canVerify"> = {
  brandName: "",
  genericName: "",
  ingredient: "",
  strength: "",
  dose: "",
  frequency: "",
  timing: [],
  withFood: "",
  purpose: "",
  prescriber: "",
  startDate: "",
  stopDate: "",
  status: "active",
};

function MedicineForm({ initial, id, onClose, onReviews }: { initial: typeof EMPTY_MEDICINE; id?: string; onClose: () => void; onReviews: (r: ReviewView[]) => void }) {
  const [v, setV] = useState(initial);
  const m = useMutation();
  const field = (k: keyof typeof EMPTY_MEDICINE) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <FormFrame
      title={id ? "Edit medicine" : "Add a medicine"}
      busy={m.busy}
      error={m.error}
      onCancel={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = await m.run(id ? "PATCH" : "POST", id ? `/api/vault/medications/${id}` : "/api/vault/medications", v);
        if (!data) return;
        if (Array.isArray(data.reviews) && data.reviews.length > 0) onReviews(data.reviews as ReviewView[]);
        onClose();
      }}
    >
      {id && <Notice tone="info">Saving a change returns this medicine to Unverified until someone approves it again.</Notice>}
      <TextField label="Name on the pack" name="brandName" value={v.brandName} onChange={field("brandName")} />
      <TextField label="Generic name" name="genericName" value={v.genericName} onChange={field("genericName")} />
      <TextField label="Active ingredient" name="ingredient" value={v.ingredient} onChange={field("ingredient")} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Strength" name="strength" hint="For example: 5 mg" value={v.strength} onChange={field("strength")} />
        <TextField label="Dose" name="dose" hint="For example: 1 tablet" value={v.dose} onChange={field("dose")} />
      </div>
      <TextField label="How often" name="frequency" hint="As written on the prescription" value={v.frequency} onChange={field("frequency")} />
      <TimesEditor id="med-times" legend="Times of day" times={v.timing} onChange={(timing) => setV({ ...v, timing })} max={8} />
      <SelectField label="Food" name="withFood" value={v.withFood} onChange={(withFood) => setV({ ...v, withFood: withFood as typeof v.withFood })} options={WITH_FOOD} />
      <TextField label="What it is for" name="purpose" value={v.purpose} onChange={field("purpose")} />
      <TextField label="Prescribed by" name="prescriber" value={v.prescriber} onChange={field("prescriber")} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Start date" name="startDate" type="date" value={v.startDate} onChange={field("startDate")} />
        <TextField label="Stop date" name="stopDate" type="date" value={v.stopDate} onChange={field("stopDate")} />
      </div>
      <SelectField
        label="Status"
        name="status"
        value={v.status}
        onChange={(status) => setV({ ...v, status: status as "active" | "stopped" })}
        options={[
          { value: "active", label: "Taking now" },
          { value: "stopped", label: "Stopped" },
        ]}
      />
    </FormFrame>
  );
}

function Medicines({ items }: { items: MedicineView[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const m = useMutation();
  const small = "min-h-12 rounded-input border border-line-input bg-surface px-3 text-sm font-medium hover:bg-primary-tint";
  return (
    <Section id="medicines" title="Medicines" count={items.length} onAdd={() => setEditing("new")} adding={editing === "new"}>
      {reviews.map((r) => (
        <ReviewPrompt
          key={r.itemId}
          review={r}
          onDone={() => {
            setReviews((list) => list.filter((x) => x.itemId !== r.itemId));
            m.refresh();
          }}
        />
      ))}
      {editing === "new" && <MedicineForm initial={EMPTY_MEDICINE} onClose={() => setEditing(null)} onReviews={setReviews} />}
      {m.error && <Notice tone="danger">{m.error}</Notice>}
      {items.length === 0 && editing !== "new" && <p className="text-ink-muted">No medicines yet. New medicines start as Unverified until someone approves them.</p>}
      <ul className="space-y-3">
        {items.map((med) =>
          editing === med.id ? (
            <li key={med.id}>
              <MedicineForm id={med.id} initial={med} onClose={() => setEditing(null)} onReviews={setReviews} />
            </li>
          ) : (
            <RowCard key={med.id}>
              <p className="text-lg font-semibold">
                {med.brandName}
                {med.strength && <span className="font-normal"> {med.strength}</span>}
              </p>
              {(med.genericName || med.purpose) && <p className="text-ink-muted">{[med.genericName, med.purpose].filter(Boolean).join(". ")}</p>}
              <p>{[med.dose, med.frequency, med.timing.length ? med.timing.join(", ") : ""].filter(Boolean).join(" · ") || "No dose or times yet"}</p>
              <div className="flex flex-wrap gap-2">
                {med.chips.map((c) => (
                  <StatusChip key={c.word} tone={c.tone} icon={c.icon} word={c.word} />
                ))}
              </div>
              <RowActions
                busy={m.busy}
                onEdit={() => setEditing(med.id)}
                onDelete={() => m.run("DELETE", `/api/vault/medications/${med.id}`)}
                extra={
                  <>
                    {med.canApprove && (
                      <button type="button" className={small} disabled={m.busy} onClick={() => m.run("POST", `/api/vault/medications/${med.id}/approve`)}>
                        Approve
                      </button>
                    )}
                    {med.canVerify && (
                      <button type="button" className={small} disabled={m.busy} onClick={() => m.run("POST", `/api/vault/medications/${med.id}/verify`)}>
                        Verify as clinician
                      </button>
                    )}
                  </>
                }
              />
            </RowCard>
          ),
        )}
      </ul>
    </Section>
  );
}

// ---- Allergies -----------------------------------------------------------------------------

const EMPTY_ALLERGY: Omit<AllergyView, "id"> = { substance: "", reaction: "", severity: "moderate" };

function AllergyForm({ initial, id, onClose }: { initial: Omit<AllergyView, "id">; id?: string; onClose: () => void }) {
  const [a, setA] = useState(initial);
  const m = useMutation();
  return (
    <FormFrame
      title={id ? "Edit allergy" : "Add an allergy"}
      busy={m.busy}
      error={m.error}
      onCancel={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await m.run(id ? "PATCH" : "POST", id ? `/api/vault/allergies/${id}` : "/api/vault/allergies", a)) onClose();
      }}
    >
      <TextField label="Allergic to" name="substance" value={a.substance} onChange={(e) => setA({ ...a, substance: e.target.value })} />
      <TextField label="Reaction" name="reaction" hint="For example: rash, swelling" value={a.reaction} onChange={(e) => setA({ ...a, reaction: e.target.value })} />
      <SelectField label="Severity" name="severity" value={a.severity} onChange={(severity) => setA({ ...a, severity: severity as AllergyView["severity"] })} options={SEVERITY} />
    </FormFrame>
  );
}

const SEVERITY_CHIP: Record<AllergyView["severity"], ChipSpec> = {
  mild: { tone: "neutral", icon: "clock", word: "Mild" },
  moderate: { tone: "warn", icon: "alert-triangle", word: "Moderate" },
  severe: { tone: "danger", icon: "alert-circle", word: "Severe" },
};

function Allergies({ items }: { items: AllergyView[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const m = useMutation();
  return (
    <Section id="allergies" title="Allergies" count={items.length} onAdd={() => setEditing("new")} adding={editing === "new"}>
      {editing === "new" && <AllergyForm initial={EMPTY_ALLERGY} onClose={() => setEditing(null)} />}
      {m.error && <Notice tone="danger">{m.error}</Notice>}
      {items.length === 0 && editing !== "new" && <p className="text-ink-muted">No allergies recorded.</p>}
      <ul className="space-y-3">
        {items.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AllergyForm id={a.id} initial={a} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <RowCard key={a.id}>
              <p className="text-lg font-semibold">{a.substance}</p>
              {a.reaction && <p>{a.reaction}</p>}
              <StatusChip {...SEVERITY_CHIP[a.severity]} />
              <RowActions busy={m.busy} onEdit={() => setEditing(a.id)} onDelete={() => m.run("DELETE", `/api/vault/allergies/${a.id}`)} />
            </RowCard>
          ),
        )}
      </ul>
    </Section>
  );
}

export function VaultScreen({ conditions, medicines, allergies }: { conditions: ConditionView[]; medicines: MedicineView[]; allergies: AllergyView[] }) {
  return (
    <div className="space-y-8">
      <Medicines items={medicines} />
      <Conditions items={conditions} />
      <Allergies items={allergies} />
    </div>
  );
}
