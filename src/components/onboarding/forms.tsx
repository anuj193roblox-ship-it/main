"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { errorText, goTo, postJson } from "@/components/auth/post-json";
import { Button, CheckboxField, ChipToggles, Notice, SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { ConsentText } from "./consent-text";

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिन्दी)" },
  { value: "kn", label: "Kannada (ಕನ್ನಡ)" },
] as const;

export const TIMEZONE_OPTIONS = [
  { value: "Asia/Kolkata", label: "India (Asia/Kolkata)" },
  { value: "Asia/Dubai", label: "Gulf (Asia/Dubai)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Europe/London", label: "United Kingdom" },
  { value: "America/New_York", label: "US Eastern" },
] as const;

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await postJson(url, body);
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setError(errorText(res));
  }
  return { busy, error, save };
}

export type PatientInitial = {
  fullName: string;
  preferredName: string;
  birthYear: string;
  language: string;
  timezone: string;
  conditions: string[];
};

export function PatientForm({ initial }: { initial: PatientInitial }) {
  const [p, setP] = useState(initial);
  const [newCondition, setNewCondition] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const { busy, error, save } = useSave();
  const set = (k: keyof PatientInitial) => (v: string) => setP((x) => ({ ...x, [k]: v }));

  function addCondition() {
    const name = newCondition.trim();
    if (!name) return;
    if (![...p.conditions, ...added].some((c) => c.toLowerCase() === name.toLowerCase())) setAdded((a) => [...a, name]);
    setNewCondition("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await save("/api/onboarding/patient", { ...p, birthYear: Number(p.birthYear), conditions: added });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Full name" name="fullName" autoComplete="off" value={p.fullName} onChange={(e) => set("fullName")(e.target.value)} />
      <TextField
        label="What they like to be called"
        name="preferredName"
        autoComplete="off"
        hint="Nurra uses this name when it speaks."
        value={p.preferredName}
        onChange={(e) => set("preferredName")(e.target.value)}
      />
      <TextField label="Year of birth" name="birthYear" inputMode="numeric" maxLength={4} value={p.birthYear} onChange={(e) => set("birthYear")(e.target.value.replace(/\D/g, ""))} />
      <SelectField label="Language Nurra speaks" name="language" value={p.language} onChange={set("language")} options={LANGUAGE_OPTIONS} />
      <SelectField label="Time zone" name="timezone" value={p.timezone} onChange={set("timezone")} options={TIMEZONE_OPTIONS} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Conditions Nurra should know about</legend>
        {[...p.conditions, ...added].length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {p.conditions.map((c) => (
              <li key={`saved-${c}`} className="rounded-chip bg-neutral-bg px-3 py-1 text-sm text-neutral-text">
                {c}
              </li>
            ))}
            {added.map((c) => (
              <li key={`new-${c}`} className="inline-flex items-center gap-1 rounded-chip bg-info-bg py-1 pr-1 pl-3 text-sm text-info-text">
                {c}
                <button type="button" onClick={() => setAdded((a) => a.filter((x) => x !== c))} className="min-h-8 min-w-8 rounded-chip" aria-label={`Remove ${c}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <div className="flex-1">
            <TextField
              label="Condition"
              name="newCondition"
              autoComplete="off"
              hint="For example: mild dementia. More details go in the Vault."
              value={newCondition}
              onChange={(e) => setNewCondition(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCondition();
                }
              }}
            />
          </div>
          <button
            type="button"
            onClick={addCondition}
            className="mt-6 inline-flex min-h-12 items-center gap-1 self-start rounded-input border border-line-input px-3 font-medium hover:bg-primary-tint"
          >
            <Icon name="plus" /> Add
          </button>
        </div>
      </fieldset>

      <Button type="submit" busy={busy}>
        {busy ? "Saving" : "Save and continue"}
      </Button>
    </form>
  );
}

export function ConsentForm({ recorded }: { recorded: { basis: string; givenBy: string; givenAt: string } | null }) {
  const [basis, setBasis] = useState<"self" | "guardian" | "">("");
  const [givenBy, setGivenBy] = useState("");
  const [note, setNote] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [again, setAgain] = useState(false);
  const { busy, error, save } = useSave();

  if (recorded && !again) {
    return (
      <div className="space-y-4">
        <ConsentText basis={recorded.basis === "guardian" ? "guardian" : "self"} />
        <Notice tone="ok">
          Consent recorded on {recorded.givenAt}, given by {recorded.givenBy} ({recorded.basis === "guardian" ? "guardian" : "the person themselves"}).
        </Notice>
        <Link href="/onboarding/contacts" className="inline-flex min-h-12 w-full items-center justify-center rounded-input bg-primary px-4 font-medium text-white hover:bg-primary-pressed">
          Continue
        </Link>
        <Button type="button" variant="secondary" onClick={() => setAgain(true)}>
          Record consent again
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await save("/api/onboarding/consent", { basis, givenBy, evidenceNote: note, agreed });
      }}
      className="space-y-4"
      noValidate
    >
      <ConsentText basis={basis} />
      {error && <Notice tone="danger">{error}</Notice>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who is giving consent</legend>
        {(
          [
            ["self", "The person themselves"],
            ["guardian", "A lawfully appointed guardian"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-12 items-center gap-3 rounded-input border border-line-input px-3">
            <input type="radio" name="basis" value={value} checked={basis === value} onChange={() => setBasis(value)} className="h-5 w-5 accent-primary" />
            {label}
          </label>
        ))}
      </fieldset>
      <TextField label="Name of the person giving consent" name="givenBy" autoComplete="off" value={givenBy} onChange={(e) => setGivenBy(e.target.value)} />
      <TextAreaField
        label="How consent was given"
        name="evidenceNote"
        hint="For example: agreed at home on 2 November, with Anita present. For a guardian, add how they are appointed."
        value={note}
        onChange={setNote}
      />
      <CheckboxField name="agreed" checked={agreed} onChange={setAgreed} label="Consent was given after reading or hearing the text above." />
      <Button type="submit" busy={busy}>
        {busy ? "Saving" : "Record consent and continue"}
      </Button>
    </form>
  );
}

export type ContactInitial = {
  name: string;
  phone: string;
  relationship: string;
  channels: ("whatsapp" | "call")[];
  whatsappAgreed: boolean;
};

const EMPTY_CONTACT: ContactInitial = { name: "", phone: "", relationship: "", channels: ["whatsapp", "call"], whatsappAgreed: false };
const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "call", label: "Phone call" },
] as const;

function ContactFields({ prefix, legend, value, onChange }: { prefix: string; legend: string; value: ContactInitial; onChange: (c: ContactInitial) => void }) {
  return (
    <fieldset className="space-y-3 rounded-card border border-line p-4">
      <legend className="px-1 text-xl leading-7 font-semibold">{legend}</legend>
      <TextField label="Name" name={`${prefix}Name`} id={`${prefix}-name`} autoComplete="off" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <TextField
        label="Mobile number"
        name={`${prefix}Phone`}
        id={`${prefix}-phone`}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        hint="India (+91) is assumed. For other countries start with + and the country code."
        value={value.phone}
        onChange={(e) => onChange({ ...value, phone: e.target.value })}
      />
      <TextField
        label="Relation"
        name={`${prefix}Relation`}
        id={`${prefix}-relation`}
        autoComplete="off"
        hint="For example: daughter, son, neighbour."
        value={value.relationship}
        onChange={(e) => onChange({ ...value, relationship: e.target.value })}
      />
      <ChipToggles legend="How Nurra can reach them" options={CHANNELS} selected={value.channels} onChange={(channels) => onChange({ ...value, channels })} />
      <CheckboxField
        name={`${prefix}WhatsappAgreed`}
        checked={value.whatsappAgreed}
        onChange={(whatsappAgreed) => onChange({ ...value, whatsappAgreed })}
        label="This person agreed to receive WhatsApp messages from Nurra"
      />
    </fieldset>
  );
}

export function ContactsForm({ primary, secondary }: { primary: ContactInitial | null; secondary: ContactInitial | null }) {
  const [p, setP] = useState<ContactInitial>(primary ?? EMPTY_CONTACT);
  const [s, setS] = useState<ContactInitial>(secondary ?? EMPTY_CONTACT);
  const [withSecondary, setWithSecondary] = useState(secondary !== null);
  const { busy, error, save } = useSave();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await save("/api/onboarding/contacts", { primary: p, secondary: withSecondary ? s : undefined });
      }}
      className="space-y-4"
      noValidate
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <ContactFields prefix="primary" legend="Primary contact" value={p} onChange={setP} />
      <CheckboxField name="withSecondary" checked={withSecondary} onChange={setWithSecondary} label="Add a secondary contact, for when the primary does not answer" />
      {withSecondary && <ContactFields prefix="secondary" legend="Secondary contact" value={s} onChange={setS} />}
      <Button type="submit" busy={busy}>
        {busy ? "Saving" : "Save and continue"}
      </Button>
    </form>
  );
}

export function ActivateButton() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; step?: string } | null>(null);

  async function activate() {
    setBusy(true);
    setProblem(null);
    const res = await postJson("/api/onboarding/activate");
    if (res.ok) return goTo(res.data.next);
    setBusy(false);
    setProblem({ error: errorText(res), step: typeof res.data.step === "string" ? res.data.step : undefined });
  }

  return (
    <div className="space-y-3">
      {problem && (
        <Notice tone="danger">
          {problem.error}{" "}
          {problem.step && (
            <Link href={problem.step} className="underline">
              Go to that step
            </Link>
          )}
        </Notice>
      )}
      <Button onClick={activate} busy={busy}>
        {busy ? "Turning on" : "Turn on Nurra"}
      </Button>
    </div>
  );
}
