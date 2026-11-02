// Care plan presets (CARE-3). Plain routines only: they never name a medicine or a dose.
// Medication entries are empty placeholders that the family links to a vault medicine.
import { z } from "zod";
import dementia from "./presets/dementia.json";
import diabetes from "./presets/diabetes.json";
import postSurgery from "./presets/post_surgery.json";
import { ITEM_TYPES, scheduleSchema, SEVERITIES } from "./schemas";

const presetItem = z
  .object({
    itemType: z.enum(ITEM_TYPES),
    title: z.string().min(1).max(120),
    severity: z.enum(SEVERITIES),
    schedule: scheduleSchema,
    placeholder: z.boolean().optional(),
  })
  .strict()
  .refine((i) => (i.itemType === "medication") === (i.placeholder === true), "Medication items in a preset must be placeholders.");

export const presetFileSchema = z
  .object({
    preset: z.enum(["dementia", "diabetes", "post_surgery"]),
    name: z.string().min(1).max(120),
    items: z.array(presetItem).min(1),
  })
  .strict();

export type Preset = z.infer<typeof presetFileSchema>;
export type PresetKey = Preset["preset"];

export const PRESETS: Record<PresetKey, Preset> = {
  dementia: presetFileSchema.parse(dementia),
  diabetes: presetFileSchema.parse(diabetes),
  post_surgery: presetFileSchema.parse(postSurgery),
};

export const PRESET_ORDER: PresetKey[] = ["dementia", "diabetes", "post_surgery"];

export const PRESET_LABELS: Record<PresetKey, string> = {
  dementia: "Dementia",
  diabetes: "Diabetes",
  post_surgery: "After surgery",
};
