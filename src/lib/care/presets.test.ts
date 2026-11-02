import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";
import { PRESET_ORDER, PRESETS, presetFileSchema } from "./presets";

const dir = path.join(process.cwd(), "src/lib/care/presets");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

// Common medicine names in India and worldwide. A preset must never contain any of them.
const MEDICINE_WORDS = [
  "paracetamol", "acetaminophen", "ibuprofen", "aspirin", "metformin", "insulin", "glimepiride", "amlodipine", "atorvastatin",
  "donepezil", "aricept", "memantine", "rivastigmine", "galantamine", "losartan", "telmisartan", "metoprolol", "omeprazole",
  "pantoprazole", "levothyroxine", "warfarin", "clopidogrel", "tramadol", "morphine", "diclofenac", "amoxicillin", "cefixime",
  "dolo", "crocin", "calpol", "glycomet", "ecosprin",
];
const DOSE_PATTERN = /\b\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|iu|units?|tabs?|tablets?|capsules?|drops?|puffs?)\b/i;
const FORBIDDEN_KEYS = ["medicationId", "medication_id", "dose", "strength", "ingredient", "brandName", "genericName", "frequency", "medicine"];

describe("care plan presets contain no medicine names or doses", () => {
  it("there are three presets and every file is loaded", () => {
    expect(files.sort()).toEqual(["dementia.json", "diabetes.json", "post_surgery.json"]);
    expect(PRESET_ORDER.map((k) => PRESETS[k].preset)).toEqual(["dementia", "diabetes", "post_surgery"]);
  });

  it.each(files)("%s names no medicine and no dose", (file) => {
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const word of MEDICINE_WORDS) expect(text.toLowerCase(), word).not.toContain(word);
    expect(text).not.toMatch(DOSE_PATTERN);
    for (const key of FORBIDDEN_KEYS) expect(text, key).not.toContain(`"${key}"`);
  });

  it.each(PRESET_ORDER)("%s: medication items are empty placeholders", (key) => {
    const meds = PRESETS[key].items.filter((i) => i.itemType === "medication");
    expect(meds.length).toBeGreaterThan(0);
    for (const m of meds) {
      expect(m.placeholder).toBe(true);
      expect(m.title).toMatch(/^(Morning|Afternoon|Evening|Night) medicines$/);
    }
  });

  it("the preset loader rejects a medicine field or a linked medicine", () => {
    const base = PRESETS.dementia;
    const withDose = { ...base, items: [{ ...base.items[0], dose: "1 tablet" }] };
    const linked = { ...base, items: [{ ...base.items[0], medicationId: "00000000-0000-4000-8000-000000000051" }] };
    const notPlaceholder = { ...base, items: [{ ...base.items[0], placeholder: false }] };
    expect(presetFileSchema.safeParse(withDose).success).toBe(false);
    expect(presetFileSchema.safeParse(linked).success).toBe(false);
    expect(presetFileSchema.safeParse(notPlaceholder).success).toBe(false);
    expect(presetFileSchema.safeParse(base).success).toBe(true);
  });
});

describe("phone numbers (server-side)", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["(+91) 6123 456 789", "+916123456789"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%j becomes %j", (input, e164) => {
    expect(normalizePhone(input)).toEqual({ ok: true, e164 });
  });

  it.each(["", "12345", "98765 4321", "58765 43210", "+91 12345 67890", "+0 1234 5678", "phone", "<script>", "+1 234", "9".repeat(30), 9876543210])(
    "%j is rejected",
    (input) => {
      expect(normalizePhone(input).ok).toBe(false);
    },
  );
});
