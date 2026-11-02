// Red-flag words (PAT-10), checked in code BEFORE the model is called. A match skips the model.
// English, Hindi in Latin script (Hinglish) and Devanagari. Patterns are on normalised text.
import { normalizeSpeech } from "./text";

const PATTERNS: { id: string; re: RegExp }[] = [
  // Chest pain / heart
  { id: "chest_pain", re: /\b(chest (pain|hurts|is hurting|tightness|pressure)|pain in (my )?chest|heart attack)\b/ },
  { id: "chest_pain", re: /\b(seene|sine|seen|chhati|chhaati|chaati) (me|mein|main|mai) (dard|dukh|jalan)\b/ },
  { id: "chest_pain", re: /(सीने|छाती) में दर्द/ },
  // Breathing
  { id: "breathing", re: /\b(cant|cannot|can not|unable to|struggling to|hard to) breathe\b|\b(short of|out of) breath\b|\bdifficulty breathing\b|\bnot able to breathe\b/ },
  { id: "breathing", re: /\bsaa?ns (nahi|nahin|nai|na) (aa|aa rahi|aa raha|le pa)|\bsaa?ns (lene )?(me|mein) (dikkat|taklif|takleef|problem)|\bsaa?ns (ruk|phool)/ },
  { id: "breathing", re: /सांस (नहीं|लेने में)|साँस (नहीं|लेने में)/ },
  // Falls (but not "I fell asleep")
  { id: "fall", re: /\bi (have )?(fell|fallen)(?! asleep)\b|\b(fell|fallen) down\b|\bslipped and fell\b|\bcant get up\b|\bcannot get up\b/ },
  { id: "fall", re: /\bgir (gayi|gai|gaya|gaye|padi|pada|padi hoon|gayi hoon|gaya hoon)\b/ },
  { id: "fall", re: /गिर (गई|गया|गयी|पड़ी|पड़ा)/ },
  // Bleeding (not "blood pressure")
  { id: "bleeding", re: /\bbleeding\b|\bblood (is )?(coming|everywhere|wont stop)\b|\blot of blood\b/ },
  { id: "bleeding", re: /\bkhoon (beh|nikal|aa raha|aa rahi)/ },
  { id: "bleeding", re: /खून (बह|निकल)/ },
  // Stroke, fainting, unconscious
  { id: "stroke", re: /\b(stroke|face (is )?drooping|cant (move|feel) my (arm|leg|face)|slurred speech)\b/ },
  { id: "collapse", re: /\b(fainted|passed out|unconscious|collapsed|blacked out)\b|\bbehosh\b|बेहोश/ },
  // Calls for help, self-harm
  // A bare cry for help ("help me", "someone help"), not "help me find my glasses".
  { id: "help", re: /^(please )?help( me)?( please)?$|\b(somebody|someone) help\b|\b(emergency|call (an )?ambulance)\b|\b(bachao|madad karo)\b|बचाओ|मदद करो/ },
  { id: "self_harm", re: /\b(kill myself|end my life|want to die|suicide|hurt myself)\b|\b(marna chahti|marna chahta|mar jaana chahti)\b/ },
];

export type RedFlag = { matched: true; id: string } | { matched: false };

export function detectRedFlag(text: string): RedFlag {
  const t = normalizeSpeech(text);
  for (const p of PATTERNS) if (p.re.test(t)) return { matched: true, id: p.id };
  return { matched: false };
}
