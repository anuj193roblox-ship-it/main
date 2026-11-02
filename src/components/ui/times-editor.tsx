"use client";

import { Icon } from "./icons";

/** A list of times of day (HH:MM) with add and remove. */
export function TimesEditor({ legend, times, onChange, max = 12, id }: { legend: string; times: string[]; onChange: (t: string[]) => void; max?: number; id: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <ul className="space-y-2">
        {times.map((t, i) => (
          <li key={`${id}-${i}`} className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-${i}`}>
              Time {i + 1}
            </label>
            <input
              id={`${id}-${i}`}
              type="time"
              value={t}
              onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))}
              className="min-h-12 flex-1 rounded-input border border-line-input bg-surface px-3 text-base focus:outline-2 focus:outline-offset-2 focus:outline-primary"
            />
            <button
              type="button"
              onClick={() => onChange(times.filter((_, j) => j !== i))}
              className="min-h-12 rounded-input border border-line-input px-3 text-sm font-medium hover:bg-primary-tint"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {times.length < max && (
        <button
          type="button"
          onClick={() => onChange([...times, "08:00"])}
          className="inline-flex min-h-12 items-center gap-1 rounded-input border border-line-input px-3 font-medium hover:bg-primary-tint"
        >
          <Icon name="plus" /> Add a time
        </button>
      )}
    </fieldset>
  );
}
