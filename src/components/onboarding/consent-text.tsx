import { StatusChip } from "@/components/status-chip";
import { CONSENT_TEXT_VERSION } from "@/lib/care/schemas";

/**
 * Plain-language consent text (ONB-2). DRAFT: it must be reviewed by a lawyer before real use.
 * The version is stored with each consent so we always know which wording was shown.
 */
export function ConsentText({ basis }: { basis: "self" | "guardian" | "" }) {
  return (
    <section aria-labelledby="consent-text-title" className="space-y-3 rounded-card border border-line bg-primary-tint p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="consent-text-title" className="text-xl leading-7 font-semibold">
          What Nurra does with information
        </h2>
        <StatusChip tone="warn" icon="alert-triangle" word="Draft: have a lawyer review before real use" />
      </div>
      <p>Nurra helps with the day&apos;s routine and tells the family when something needs attention. To do that it keeps:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Name, birth year, language and time zone.</li>
        <li>Health conditions, medicines and allergies that the family or a clinician adds.</li>
        <li>The daily plan, reminders and whether they were done.</li>
        <li>What is said to Nurra, written down as text.</li>
        <li>Family contacts, and whether each one agreed to WhatsApp messages.</li>
      </ul>
      <p>These services process the information for Nurra:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Supabase stores it, encrypted, and handles sign-in.</li>
        <li>Anthropic&apos;s Claude turns what is said into Nurra&apos;s replies. It receives only what a reply needs, never the documents in the vault.</li>
        <li>Twilio sends WhatsApp messages to the family.</li>
        <li>
          When Nurra listens, the browser on the phone or tablet turns speech into text, and the browser maker (for
          example Google or Apple) may receive the sound to do that. Nurra itself never records or keeps audio.
        </li>
      </ul>
      <p>
        Conversations are kept as written text. Raw audio is not kept. No cameras are used. The family can export all of
        this information, or delete it, at any time.
      </p>
      <p>Nurra does not diagnose, does not suggest doses and does not replace a doctor or emergency services.</p>
      {basis === "guardian" && (
        <p className="rounded-input border border-line-input bg-surface p-3">
          If the person cannot decide for themselves, consent must come from a lawfully appointed guardian. Record who the
          guardian is and how they are appointed in the evidence note.
        </p>
      )}
      <p className="text-sm text-ink-muted">Version {CONSENT_TEXT_VERSION}</p>
    </section>
  );
}
