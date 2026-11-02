// Checks the model's reply in code AFTER the call (rules 4-6). Anything unsafe is replaced.
// The model may only talk; it may not advise on medicines, diagnose, blame or promise help.
import { normalizeSpeech } from "./text";

export type GuardCategory = "dose" | "medicine_change" | "diagnosis" | "blame" | "safety_claim" | "promise_of_help";

const RULES: { category: GuardCategory; re: RegExp }[] = [
  // Dose advice: amounts, doubling, extra, more or less.
  { category: "dose", re: /\b\d+(\.\d+)?\s*(mg|mcg|ml|units?|iu|tablets?|tabs?|pills?|capsules?|drops?|puffs?)\b/ },
  { category: "dose", re: /\b(double|triple|half|halve|extra|another|more|less|fewer|increase|decrease|reduce|raise|lower|skip)\b.{0,30}\b(dose|doses|dosage|tablet|tablets|pill|pills|medicine|medicines|medication|insulin)\b/ },
  { category: "dose", re: /\b(two|three|four|2|3|4) (tablets|pills|doses|capsules)\b/ },
  // Stop or change medicine.
  { category: "medicine_change", re: /\b(stop|quit|pause|discontinue|switch|change|replace)\b.{0,25}\b(taking|tablet|tablets|pill|pills|medicine|medicines|medication|dose)\b/ },
  { category: "medicine_change", re: /\b(dont|do not|no need to|you dont need to|you do not need to) (take|use)\b.{0,25}\b(tablet|tablets|pill|pills|medicine|medicines|medication|dose|it|them)\b/ },
  // Diagnosis wording.
  { category: "diagnosis", re: /\bdiagnos/ },
  { category: "diagnosis", re: /\b(you|she|he) (may|might|could|probably|likely)? ?(have|has|are having|is having|are suffering from|is suffering from) (a |an )?(stroke|heart attack|infection|fever|dementia|alzheimers|diabetes|covid|pneumonia|uti|depression|anxiety disorder|cancer|flu)\b/ },
  { category: "diagnosis", re: /\b(sounds|looks|seems) like (a |an )?(stroke|heart attack|infection|dementia|alzheimers|pneumonia|covid|uti)\b/ },
  { category: "diagnosis", re: /\bsymptoms? of\b/ },
  // Blame (spec 3.7): never "you forgot", never "as I told you".
  { category: "blame", re: /\byou (forgot|forget|have forgotten|had forgotten|keep forgetting|didnt remember|did not remember)\b|\bas i (already )?told you\b|\bi already told you\b/ },
  // "Safe" claims about medicines.
  { category: "safety_claim", re: /\bsafe to (take|use|have)\b|\b(medicine|medicines|tablet|tablets|pill|pills|dose)\b.{0,20}\bsafe\b/ },
  // Promises of help: only code may say someone is being told (rule 6).
  { category: "promise_of_help", re: /\bhelp is (coming|on (its|the) way)\b|\bambulance\b|\bi (have )?(called|alerted|notified|told|messaged)\b|\bi (am|m) (calling|alerting|notifying|messaging|letting)\b|\b(doctor|nurse) is coming\b/ },
];

export type GuardResult = { ok: true } | { ok: false; category: GuardCategory };

export function checkReply(say: string): GuardResult {
  const t = normalizeSpeech(say);
  for (const r of RULES) if (r.re.test(t)) return { ok: false, category: r.category };
  return { ok: true };
}
