"use client";

import { useState } from "react";
import { errorText, postJson } from "@/components/auth/post-json";
import { Button, Notice } from "@/components/ui/form";

export type ReviewView = {
  itemId: string;
  itemTitle: string;
  medicineName: string;
  changes: { field: string; label: string; before: string; after: string }[];
  proposal: { times?: string[]; deactivate: boolean };
};

/**
 * CARE-6: a vault medicine changed. Show before and after, and let a person decide.
 * Nothing in the plan changes until one of the two buttons is pressed.
 */
export function ReviewPrompt({ review, onDone }: { review: ReviewView; onDone: () => void }) {
  const [busy, setBusy] = useState<"apply" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "apply" | "keep") {
    setBusy(decision);
    setError(null);
    const res = await postJson(`/api/plan/review/${review.itemId}`, { decision });
    setBusy(null);
    if (res.ok) return onDone();
    setError(errorText(res));
  }

  const effects: string[] = [];
  if (review.proposal.times) effects.push(`Reminder times change to ${review.proposal.times.join(", ")}.`);
  if (review.proposal.deactivate) effects.push("This reminder is switched off, because the medicine was stopped.");
  if (effects.length === 0) effects.push("Reminder times stay the same. Reminders will use the new details.");

  return (
    <section role="group" aria-labelledby={`review-${review.itemId}`} className="space-y-3 rounded-card border border-warn bg-warn-bg p-4 text-ink">
      <h3 id={`review-${review.itemId}`} className="text-lg font-semibold">
        Apply this change to the reminders?
      </h3>
      <p>
        {review.medicineName} changed. It is used by the plan item &ldquo;{review.itemTitle}&rdquo;.
      </p>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Before and after</caption>
        <thead>
          <tr className="text-ink-muted">
            <th scope="col" className="py-1 pr-2 font-medium">
              What
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Before
            </th>
            <th scope="col" className="py-1 font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {review.changes.map((c) => (
            <tr key={c.field} className="border-t border-line align-top">
              <th scope="row" className="py-2 pr-2 font-medium">
                {c.label}
              </th>
              <td className="py-2 pr-2">{c.before}</td>
              <td className="py-2 font-semibold">{c.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-disc pl-5">
        {effects.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button onClick={() => decide("apply")} busy={busy === "apply"} disabled={busy !== null}>
          Apply to reminders
        </Button>
        <Button variant="secondary" onClick={() => decide("keep")} busy={busy === "keep"} disabled={busy !== null}>
          Keep reminders as they are
        </Button>
      </div>
    </section>
  );
}
