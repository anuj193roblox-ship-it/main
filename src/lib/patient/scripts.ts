// Scripted lines. Code says these; the model never does. Short, warm, one instruction.
import type { GuardCategory } from "./output-guard";

/**
 * Red-flag reply. Until WhatsApp alerts are sent (Stage S6), it must not say anyone is being told.
 * Wording for the "not yet delivering" case was specified by the product owner.
 */
export function redFlagLine(contactName: string | null, alertsDeliveryEnabled: boolean): string {
  const who = contactName || "your family";
  if (alertsDeliveryEnabled) return `I am letting ${who} know now. Stay where you are. You can press the button to call ${who}.`;
  return `Please stay calm and stay where you are. Press the button to call ${who} now.`;
}

export function fallbackLine(name: string): string {
  return `I am here with you, ${name}. Shall we try that again?`;
}

export function unsafeReplacementLine(name: string, category: GuardCategory): string {
  if (category === "dose" || category === "medicine_change" || category === "safety_claim") {
    return `I cannot give advice about medicines, ${name}. Your doctor or pharmacist can help with that. Would you like to call your family?`;
  }
  if (category === "diagnosis") return `I cannot say what is wrong, ${name}. A doctor can help with that. How are you feeling right now?`;
  return `I am here with you, ${name}. How are you feeling right now?`;
}

export function yesNoLine(name: string, reminderTitle: string | null): string {
  return reminderTitle
    ? `Let us keep it simple, ${name}. Did you take your ${reminderTitle.toLowerCase()}? You can say yes or not yet.`
    : `Let us keep it simple, ${name}. Are you feeling alright? You can say yes or no.`;
}

export function confirmedLine(name: string): string {
  return `Thank you, ${name}. That is done.`;
}

export function notYetLine(name: string): string {
  return `That is alright, ${name}. We can do it a little later.`;
}

export function refusalLine(name: string): string {
  return `That is alright, ${name}. I will not push.`;
}

export function capReachedLine(name: string): string {
  return `I am here with you, ${name}. Let us rest our voices for a while.`;
}

/** "Morning walk" -> "morning walk"; "BP check" stays. Medicines are always "medicines". */
export function reminderPhrase(title: string, itemType: string): string {
  if (itemType === "medication") return "medicines";
  const t = title.trim() || "reminder";
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/** Step 0 (REM-3), wording from the spec. */
export function promptLine(name: string, title: string, itemType: string): string {
  return `It's time for your ${reminderPhrase(title, itemType)}, ${name}. Shall we do it together?`;
}

/** Step 1, the calmer re-prompt. */
export function repromptLine(name: string): string {
  return `No rush, ${name}. Whenever you're ready, I'm here.`;
}
