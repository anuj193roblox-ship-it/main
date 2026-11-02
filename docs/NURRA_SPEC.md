# NURRA: Master Product Spec v1.0 (2 Nov 2026)

An AI care companion app for older people who forget their medicines, with a dashboard for the family. This file is written to be fed to a coding tool **one stage at a time**.

---

## 0. How to use this file

1. Save this file as `docs/NURRA_SPEC.md` in the repo. Create `CLAUDE.md` from Appendix A.
2. Build **one stage per session** (Section 9). Never ask the tool to build the whole app.
3. For each stage use the prompt template in Appendix B.
4. A stage is finished only when every "Done when" line passes and the "Security gate" is checked. Then start the next stage in a fresh session.
5. Phase 1 fits 20 hours and about $100 of credits. Phase 2 and 3 are the backlog. Do not start them early.

---

## 1. Product

**One-liner:** Dementia takes away independence one forgotten routine at a time. Nurra gently guides the day and tells the family only when it matters.

**Platform:** This is an app. Build it as a **mobile-first installable web app (PWA)** designed at 390x844 (minimum 360 wide). Phase 3 wraps the same code with Capacitor for Play Store / App Store builds. Do not start a separate native codebase.

**Surfaces**

| Surface | Who | Device | Notes |
|---|---|---|---|
| Patient mode | Patient | Phone or tablet on a stand | Full screen, voice first, one action at a time. No login: paired device token |
| Family app | Family | Phone | Bottom tab bar, information-rich |
| Clinician view | Doctor / nurse | Phone or laptop | Same app, role-gated extra permissions |

**Roles:** `family`, `clinician`, `admin` (household owner). The patient never has an account, only a revocable device token with a narrow scope.

**Core rules (never break these)**
1. Code decides, the model only talks. The LLM has no tools. Escalation, confirmation and red-flag handling run in plain code.
2. A dose counts as taken only on an explicit yes (tap, or exact affirmative). Ambiguous speech stays unconfirmed. A confirmed dose is never prompted again.
3. Every change to medical data (medicines, allergies, conditions) is made or approved by a human and is logged.
4. Nurra never diagnoses, suggests doses, or tells anyone to stop or change a medicine.
5. Nurra never says "safe". Safety checks only show flags and "discuss with a pharmacist".
6. Nurra never promises help it has not summoned. It says "I am letting Anita know now", never "help is coming".
7. No cameras. Audio and motion only, with recorded consent.

**Non-goals for v1:** diagnosis, dosing advice, emergency services replacement, video monitoring, native app code, billing.

---

## 2. Tech stack and architecture decisions

| Layer | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript + Tailwind + zod, deployed on Vercel, PWA manifest + service worker |
| Data and auth | Supabase: Auth, Postgres with RLS, Realtime, Storage (private buckets), `pg_cron` + `pg_net` |
| Conversation AI | Claude Sonnet for check-ins. Claude Haiku for daily story and red-flag classifier |
| Speech (v1) | Browser Web Speech + SpeechSynthesis, typed fallback always on |
| Alerts | Twilio WhatsApp (v1). Twilio Voice call step in Phase 2 |
| Security tools | Cloudflare Turnstile (CAPTCHA), OWASP ZAP baseline scan |

**Decisions**
- **Scheduler:** `pg_cron` every minute calls `/api/cron/tick` with a secret header via `pg_net`. Do **not** use Vercel Cron on the Hobby plan (once per day only).
- **Idempotency:** the tick selects due reminders with `FOR UPDATE SKIP LOCKED`. `escalation_steps` is unique on (`reminder_id`, `step`).
- **Patient device token:** 6-digit pairing code creates a hashed, revocable token scoped to one patient. It can only post check-ins and confirmations.
- **SMS is not used** (India DLT template registration). WhatsApp templates and opt-in are required for business-initiated messages. The WhatsApp sandbox expires 3 days after joining, so rejoin before any demo.
- **Consent has two paths:** the patient consents themselves, or a verified lawful guardian does. Store the basis, who gave it and an evidence note.
- **Model privacy:** send the model only what the reply needs (care plan facts and active medicine names). Never send documents or the full vault. Say so on the consent screen.

---

## 3. Design system

### 3.1 Colour palette (all ratios measured, WCAG contrast)

**Brand and surfaces (light)**

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--primary` | `#1F6F5C` | Buttons, links, active tab, Nurra identity | 6.02 on white; white text on it 6.02 |
| `--primary-pressed` | `#17594A` | Pressed / hover | white text on it 8.19 |
| `--primary-tint` | `#EEF5F3` | Cards, striped rows, soft panels | text on it 13.36 |
| `--primary-tint-2` | `#D9EAE5` | Selected states (decorative) | n/a |
| `--bg` | `#FFFFFF` | Family app background | n/a |
| `--bg-patient` | `#FFF9F0` | Patient mode warm background | text on it 14.11 |
| `--surface` | `#FFFFFF` | Cards on tinted backgrounds | n/a |
| `--text` | `#1B2B27` | Body text | 14.77 on white |
| `--text-muted` | `#4A5D58` | Secondary text | 7.01 on white, 6.33 on tint |
| `--text-placeholder` | `#5E726C` | Placeholders | 5.12 on white |
| `--border` | `#C9DAD5` | Dividers and card edges (decorative only) | 1.45, never for inputs |
| `--border-input` | `#6F8A83` | Input and control borders | 3.72 on white |

**Status colours: use only for dots, icons, bars, fills (never as text on white)**

| Token | Hex | Why not text |
|---|---|---|
| `--ok` | `#2E9E6B` | 3.38 on white |
| `--warn` | `#E0A100` | 2.27 on white |
| `--danger` | `#D64545` | 4.38 on white |
| `--info` | `#2F6FB5` | 5.17 (ok for text, white text on it too) |

**Status chips: tinted background + dark text + icon + word (never colour alone)**

| State | Chip bg | Chip text | Contrast | Icon | Word |
|---|---|---|---|---|---|
| OK / Taken | `#E6F5EE` | `#1E7A50` | 4.72 | check-circle | OK / Taken |
| Check / Refused | `#FFF4D6` | `#7A5600` | 6.07 | alert-triangle | Check / Refused |
| Urgent / Missed | `#FDECEC` | `#A82E2E` | 5.94 | alert-circle | Urgent / Missed |
| Info / Given by family | `#E8F1FB` | `#245A94` | 6.21 | user-check | Given by Anita |
| Pending / Neutral | `#EEF1F0` | `#505F5B` | 5.90 | clock | Due 8:00 |

**Other:** destructive button background `#C23A3A` with white text (5.30). Do not put text on a solid `--ok` or `--warn` fill. Use the tinted chips above.

**Dark mode (family app only; patient mode stays light)**

| Token | Hex | Contrast |
|---|---|---|
| `--bg` | `#0F1A17` | text 15.28 |
| `--surface` | `#16241F` | text 13.81 |
| `--text` | `#E6F0EC` | n/a |
| `--text-muted` | `#A8BDB6` | 8.13 on surface |
| `--primary` | `#4FB59A` | 7.12 on bg; dark button text `#0F1A17` |
| `--border-input` | `#6E8A82` | 4.30 on surface |
| `--ok` text | `#5FD39B` | 8.63 |
| `--warn` text | `#F2C14E` | 9.58 |
| `--danger` text | `#FF8A8A` | 7.08 |
| `--info` text | `#8AB8EA` | 7.75 |

Dark chips are outlined: 1px border in the status colour, transparent background, status text colour, icon and word.

```css
:root{
  --primary:#1F6F5C; --primary-pressed:#17594A; --primary-tint:#EEF5F3; --primary-tint-2:#D9EAE5;
  --bg:#FFFFFF; --bg-patient:#FFF9F0; --surface:#FFFFFF;
  --text:#1B2B27; --text-muted:#4A5D58; --text-placeholder:#5E726C;
  --border:#C9DAD5; --border-input:#6F8A83;
  --ok:#2E9E6B; --warn:#E0A100; --danger:#D64545; --info:#2F6FB5;
  --ok-bg:#E6F5EE; --ok-text:#1E7A50;
  --warn-bg:#FFF4D6; --warn-text:#7A5600;
  --danger-bg:#FDECEC; --danger-text:#A82E2E;
  --info-bg:#E8F1FB; --info-text:#245A94;
  --neutral-bg:#EEF1F0; --neutral-text:#505F5B;
  --destructive:#C23A3A;
}
[data-theme="dark"]{
  --bg:#0F1A17; --surface:#16241F; --text:#E6F0EC; --text-muted:#A8BDB6;
  --primary:#4FB59A; --border-input:#6E8A82;
  --ok-text:#5FD39B; --warn-text:#F2C14E; --danger-text:#FF8A8A; --info-text:#8AB8EA;
}
```

```ts
// tailwind.config.ts (extend.colors)
colors: {
  primary: { DEFAULT:'#1F6F5C', pressed:'#17594A', tint:'#EEF5F3', tint2:'#D9EAE5' },
  patient: '#FFF9F0',
  ink: { DEFAULT:'#1B2B27', muted:'#4A5D58', placeholder:'#5E726C' },
  line: { DEFAULT:'#C9DAD5', input:'#6F8A83' },
  ok:{DEFAULT:'#2E9E6B',bg:'#E6F5EE',text:'#1E7A50'},
  warn:{DEFAULT:'#E0A100',bg:'#FFF4D6',text:'#7A5600'},
  danger:{DEFAULT:'#D64545',bg:'#FDECEC',text:'#A82E2E',btn:'#C23A3A'},
  info:{DEFAULT:'#2F6FB5',bg:'#E8F1FB',text:'#245A94'},
  neutral:{bg:'#EEF1F0',text:'#505F5B'},
}
```

### 3.2 Medicine state mapping (used on dashboard grid, patient card, history)

| State | Chip | Meaning |
|---|---|---|
| Taken | OK green | Patient confirmed by tap or explicit yes |
| Given by [name] | Info blue | A family member confirmed on the patient's behalf |
| Pending | Neutral grey | Not due yet or waiting for reply |
| Missed | Urgent red | Escalation finished without confirmation |
| Refused | Check amber | Patient said no (logged, not pushed) |
| Unverified | Check amber outline | Vault entry not yet approved by a human |
| Verified by [Dr X] | OK green | Approved by a clinician |

### 3.3 Typography

| Mode | Font | Sizes |
|---|---|---|
| Patient | Nunito | Clock 56/64, greeting 40/48 bold, body and subtitles 28/40, button label 28 semibold |
| Family / clinician | Inter | h1 28/36, h2 20/28, body 16/24, caption 14/20, big numbers 32 bold |

No italics, no all caps for sentences, sentence case everywhere.

### 3.4 Layout tokens
- Spacing scale (4px base): 4, 8, 12, 16, 24, 32, 48.
- Radius: cards 16, inputs 12, chips 999, patient buttons 24.
- Touch targets: family at least 48px, patient at least 72px tall.
- Elevation: 1px border instead of shadows. One soft shadow only for sheets.
- Motion: 150 to 250 ms transitions. Nurra speaking indicator is a slow 2 s pulse. Respect `prefers-reduced-motion`. No flashing.

### 3.5 Components
- Bottom tab bar (family): 5 tabs, icon + label, active tab in `--primary`.
- Card: tint background, 16 radius, 1px `--border`.
- Status chip (see 3.1), medicine row, timeline item (dot, time, title, one-line outcome, chevron).
- Big button (patient): 72px tall, 24 radius, one primary per screen.
- Mic button (patient): 120px circle, `--primary`, white icon, label "Talk to Nurra".
- Bottom sheet (nudge, acknowledge, confirm dialogs), toast for results, skeleton loaders.
- Icons: Tabler outline set, 24px, always paired with a word on status.

### 3.6 Accessibility
- Contrast at least 4.5:1 for text (7:1 on patient mode). Controls at least 3:1.
- Every spoken line also appears as subtitle text. Adjustable speech speed and volume.
- Full keyboard and screen-reader support. Charts get a text summary.
- Offline banner. Never show raw errors or internal IDs.

### 3.7 Voice and tone
- Short warm sentences. Offer choices ("Shall we take your tablets now?"). Never "you forgot", never "as I told you".
- Examples: "Good morning, Meera. It's Sunday." / "No rush, Meera. I'm here." / "That's alright, we'll try again."
- Family alert: "Meera has not confirmed her 8am tablets. Nurra has tried three times."
- Red flag: calm, one instruction, "I am letting Anita know now."

---

## 4. Navigation and screens

**Public:** `/` landing (Log in button top-right), `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/[token]`

**Onboarding:** `/onboarding/patient` → `/consent` → `/contacts` → `/vault-start` → `/device` (pair patient device) → review and activate

**Patient mode:** `/patient`: states idle, speaking, listening, reminder, confirmed, calling-family, offline

**Family app (bottom tabs):**
1. **Today** `/app/today`: status header, daily story, glance cards, alert timeline; `/app/today/alerts/[id]`
2. **Medicines** `/app/medicines`: grid of medicines by time; `/app/medicines/[id]` history
3. **Vault** `/app/vault`: conditions, medicines, allergies, doctors, documents, emergency card
4. **Plan** `/app/plan`: care plan; `/app/plan/food`, `/app/plan/fitness`
5. **More** `/app/more`: messages, Alexa, settings, privacy, hidden `/app/more/demo`

When signed out, the app shows no patient data, only the Log in button in the top-right corner. Signed in, it becomes an account menu (Account, Switch patient, Log out).

---

## 5. Feature catalogue

Stage numbers refer to Section 9. "Done" = acceptance criteria.

### A. Accounts and access (AUTH)
| ID | Feature | Done | Stage |
|---|---|---|---|
| AUTH-1 | Sign up | Email + 12+ char password, CAPTCHA, email verification before any data access | S2 |
| AUTH-2 | Login | Identical error for wrong email and wrong password, rate limit, temporary lockout | S2 |
| AUTH-3 | Forgot / reset password | Single-use short-lived token, all sessions invalidated, email notice | S2 |
| AUTH-4 | Corner Log in button | Top-right on public pages, goes to `/login?next=/app/today` with allowlisted `next`; account menu when signed in | S2 |
| AUTH-5 | Roles | Role never taken from client. Clinician only by invite or verification | S2 |
| AUTH-6 | Household invites | Single-use, expires in 24 h | S2 |
| AUTH-7 | MFA (TOTP) | Required for clinician and admin, optional for family | S2 |
| AUTH-8 | Sessions | httpOnly Secure SameSite=Lax cookies, 30 min inactivity sign-out with warning | S2 |

### B. Onboarding and consent (ONB)
| ID | Feature | Done | Stage |
|---|---|---|---|
| ONB-1 | Add patient | Name, preferred name, birth year, language, timezone | S3 |
| ONB-2 | Consent | Basis `self` or `guardian`, given by, evidence note. Patient cannot be activated without it | S3 |
| ONB-3 | Contacts | Primary and secondary, channel preferences, WhatsApp opt-in timestamp | S3 |
| ONB-4 | Pair patient device | 6-digit code to hashed revocable token | S4 |
| ONB-5 | Review and activate | Summary screen, activate button | S3 |

### C. Care plan (CARE)
| ID | Feature | Done | Stage |
|---|---|---|---|
| CARE-1 | Plan builder | Item types: medication (linked to vault), meal, water, exercise, sleep, appointment, check-in question, reading | S3 |
| CARE-2 | Severity | normal / important / critical | S3 |
| CARE-3 | Presets | Dementia (default), diabetes, post-surgery as seed JSON | S3 |
| CARE-4 | Escalation settings | Delays per plan and per severity | S5 |
| CARE-5 | Edit control | Family and clinician edit, patient read-only, every edit audited | S3 |
| CARE-6 | Apply-change confirm | Medicine change in vault asks "Apply to reminders?", never silent | S3 |

### D. Patient mode (PAT)
| ID | Feature | Done | Stage |
|---|---|---|---|
| PAT-1 | Home screen | Big date and time, Nurra line as subtitles, speaking pulse | S4 |
| PAT-2 | Talk | Mic button plus typed fallback | S4 |
| PAT-3 | Greeting and reorientation | Uses care-plan facts that have an expiry date | S4 |
| PAT-4 | Reminder card | "Yes, I took them" / "Not yet" | S4 |
| PAT-5 | AI check-in | Strict JSON reply validated with zod, mood tag, logged | S4 |
| PAT-6 | Repeated questions | Answered as if new | S4 |
| PAT-7 | Refusal | Not pushed, logged, family alerted | S4 |
| PAT-8 | Unclear speech | After 2 failures, offers yes/no, then flags family | S4 |
| PAT-9 | Call my family | One big button, dials primary contact | S4 |
| PAT-10 | Red-flag handling | Words checked before and after the model call, immediate alert, calm script | S4 |
| PAT-11 | Medicine read-back | "What do I take now?" read from vault, read-only | S11 |
| PAT-12 | Offline / heartbeat | `last_seen_at` check, family told if device is silent | S11 |
| PAT-13 | Hindi / Kannada | Voice and text | S20 |

### E. Reminders and escalation (REM)
| ID | Feature | Done | Stage |
|---|---|---|---|
| REM-1 | Reminder instances | Generated daily from plan. States: scheduled, prompted, confirmed, escalating, resolved, missed | S5 |
| REM-2 | Scheduler | `pg_cron` each minute, secret header, safe against double tick | S5 |
| REM-3 | Ladder | Prompt, calmer re-prompt after 5 min, family alert after 10 more, secondary contact after 15 | S5 |
| REM-4 | Idempotency | Unique step per reminder, row locking | S5 |
| REM-5 | Stop on confirm | Any confirmation cancels remaining steps and tells family it resolved | S5 |
| REM-6 | Explicit yes / double-dose lock | Confirmed reminder never prompts again | S5 |
| REM-7 | Demo mode | Timers in seconds, env flag | S5 |
| REM-8 | Voice call step | Twilio Voice `Say` + `Gather` (press 1 or say yes) | S10 |

### F. Alerts (ALR)
| ID | Feature | Done | Stage |
|---|---|---|---|
| ALR-1 | WhatsApp alerts | Approved templates, opt-in checked | S6 |
| ALR-2 | Acknowledge | Signed single-use expiring link plus in-app button; stops escalation | S6 |
| ALR-3 | Delivery status and retries | Up to 3 retries, failures visible | S6 |
| ALR-4 | Secondary contact | Used when primary does not acknowledge in 15 min | S6 |
| ALR-5 | Abuse limits | Per-number and per-IP limits, daily Twilio spend cap | S6 |
| ALR-6 | Web push to family app | Installed PWA push notifications | S19 |

### G. Family dashboard (DASH)
| ID | Feature | Done | Stage |
|---|---|---|---|
| DASH-1 | Today screen | Status header, daily story, glance cards (tablets, meals, water, mood, last check-in), timeline | S7 |
| DASH-2 | Alert detail | What happened, what Nurra did, Acknowledge, Call | S7 |
| DASH-3 | Realtime | New alerts appear without refresh, respecting RLS | S7 |
| DASH-4 | Daily story | Haiku writes 2 to 3 plain sentences, template fallback if the call fails | S7 |
| DASH-5 | Weekly trends | Adherence, sleep, readings, with text summaries | S16 |
| DASH-6 | All states | Loading, empty, error with retry, offline banner | S7 |

### H. Patient vault (VLT)
| ID | Feature | Done | Stage |
|---|---|---|---|
| VLT-1 | Conditions | Name, since, treating doctor, notes | S3 |
| VLT-2 | Medicines (structured) | Brand and generic name, ingredient, strength, dose, frequency, time, food, purpose, prescriber, start and stop dates, status | S3 |
| VLT-3 | Allergies | Substance, reaction, severity | S3 |
| VLT-4 | Verification | Entries are Unverified until approved; clinician approval shows "Verified by" | S3 |
| VLT-5 | Audit log | Every change and every document read recorded | S3 |
| VLT-6 | Doctors and hospitals | Name, specialty, phone, address | S11 |
| VLT-7 | Emergency card | One-page summary plus expiring view-only link / QR | S11 |
| VLT-8 | Change history screen | Who changed what and when | S11 |
| VLT-9 | Patient notes | Patient can add notes, need family approval | S11 |
| VLT-10 | Documents | Private bucket, signed URLs, type and size limits, location data stripped | S12 |

### I. Family medicine tracking (MED)
| ID | Feature | Done | Stage |
|---|---|---|---|
| MED-1 | Medicine grid | Medicines by time slot with state chips, live | S7 |
| MED-2 | Nudge now | Allowed only while untaken. 10 min cooldown, max 3 per day per medicine, logged | S7 |
| MED-3 | "I gave it" | Confirm dialog, recorded as Given by [name], never as patient-confirmed | S7 |
| MED-4 | Medicine history | 7-day history per medicine with who confirmed | S11 |
| MED-5 | Per-medicine alert settings | Critical or normal, quiet hours | S11 |

### J. Prescription scan (RX)
| ID | Feature | Done | Stage |
|---|---|---|---|
| RX-1 | Capture | Camera or upload, private storage, validation | S12 |
| RX-2 | Extraction | Strict JSON with confidence per field. "Unreadable" allowed, guessing forbidden | S12 |
| RX-3 | Dose-shorthand parser | Code expands 1-0-1, OD, BD, TDS, QID, HS, SOS, AC, PC. Tested with 15 patterns | S12 |
| RX-4 | Review screen | Photo beside editable fields, low-confidence fields red, "I checked against the paper" tick required | S12 |
| RX-5 | Optional translation | Instructions translated to patient's language, labelled "machine translated" | S12 |
| RX-6 | Save as Unverified | Then "Apply to reminders?" with human approval | S12 |

Note: Google Translate only translates language. Reading handwriting needs a vision step first. Published results on Indian prescriptions are around 82% for medicine name and dose, so human review is mandatory.

### K. Medicine safety check (SAFE)
| ID | Feature | Done | Stage |
|---|---|---|---|
| SAFE-1 | Ingredient field | Every vault medicine has a normalised generic ingredient | S13 |
| SAFE-2 | Duplicate check | Same ingredient twice raises a flag | S13 |
| SAFE-3 | Allergy check | Ingredient or class matching a vault allergy raises a flag | S13 |
| SAFE-4 | Run on add and edit | Flags shown before the entry is saved | S13 |
| SAFE-5 | Flag handling | Family or clinician acknowledges with a note; high severity alerts family | S13 |
| SAFE-6 | Interaction pairs | Licensed or curated source with severity and citation (licence checked first) | S17 |
| SAFE-7 | Kidney / liver cautions | Needs lab values or flagged conditions in the vault | S17 |
| SAFE-8 | Label summaries | Model summarises retrieved label text with citations, pharmacist review | After pilot |

Wording rule: "Flag: discuss with a pharmacist" and "No flags found in our data. This is not confirmation of safety." Never "safe" or "OK to take". The NIH interaction API was discontinued in 2024, so there is no free drop-in source.

### L. Alexa (ALX)
| ID | Feature | Done | Stage |
|---|---|---|---|
| ALX-1 | Custom skill | Developer account, skill in development mode | S14 |
| ALX-2 | Account linking | OAuth to Nurra login, unlink deletes tokens | S14 |
| ALX-3 | Reminder permission | Requested by voice or app card | S14 |
| ALX-4 | Sync reminders | Plan changes create, update and delete Alexa reminders | S14 |
| ALX-5 | Voice confirm | "Alexa, tell Nurra I took my tablets" (explicit yes only) | S14 |
| ALX-6 | Fallback and status | WhatsApp if Alexa fails, "Alexa connected" status | S14 |

Limits: Alexa proactive notifications must use Amazon's predefined formats and only chime. Reminders need explicit permission and the skill can only manage its own reminders. Alexa can remind at medicine time, but it cannot speak an urgent family alert on demand. Escalation stays on WhatsApp and calls.

### M. Food and workout planner (FIT)
| ID | Feature | Done | Stage |
|---|---|---|---|
| FIT-1 | Preferences and limits | Veg / non-veg, cuisine, allergies from vault, restrictions entered by clinician, mobility level, clinician clearance switch | S15 |
| FIT-2 | Meal plan | Weekly JSON plan, code filters allergens and restricted items | S15 |
| FIT-3 | Food-medicine cautions | Only from a rules table filled by clinician or pharmacist | S15 |
| FIT-4 | Workout plan | Chair exercises, short walks, balance, 10 to 20 min, blocked without clearance | S15 |
| FIT-5 | Add to care plan | Meals, water and exercise reminders after approval | S15 |
| FIT-6 | Progress | Done / skipped on the dashboard | S15 |

No weight-loss or calorie targets unless a clinician sets them. Visible line: "Not medical advice."

### N. Sensors and demo (SENS)
| ID | Feature | Done | Stage |
|---|---|---|---|
| SENS-1 | Events endpoint | Same endpoint real devices will use | S8 |
| SENS-2 | Severity rules | info, warning, urgent; night door baseline 23:00 to 06:00 | S8 |
| SENS-3 | Speaks on warnings | "Meera, the stove is on. Shall we turn it off?" | S8 |
| SENS-4 | Demo panel | Stove on, door at night, high BP, fall reported. Visible only with demo flag and admin role | S8 |
| SENS-5 | Real devices | Door, motion, pill-box, plug, BP cuff, glucometer | After pilot |

### O. Memories (MEM)
| ID | Feature | Done | Stage |
|---|---|---|---|
| MEM-1 | Family voice notes | Record, upload, schedule | S16 |
| MEM-2 | Reminiscence mode | Songs, photos, voice notes for calm | S16 |
| MEM-3 | Calming response | If upset, plays calming content and notifies family | S16 |

### P. Clinician (CLN)
| ID | Feature | Done | Stage |
|---|---|---|---|
| CLN-1 | Clinician view | Adherence log, trends, verify vault entries | S18 |
| CLN-2 | Weekly PDF report | Exportable adherence report | S18 |

### Q. Privacy and platform (PRIV / PLAT)
| ID | Feature | Done | Stage |
|---|---|---|---|
| PRIV-1 | Data export and delete | JSON export, delete cascades to all rows and stored files | S11 |
| PRIV-2 | Minimal retention | Transcripts stored, raw audio not by default | S4 |
| PLAT-1 | RLS everywhere | Enabled on every table, tested household A vs B | S1 |
| PLAT-2 | Audit log | Auth events and vault changes, no PII or secrets in logs | S1 |
| PLAT-3 | Security headers | HSTS, CSP, nosniff, frame-ancestors none, Referrer-Policy | S2 |
| PLAT-4 | PWA install | Manifest, icons, service worker | S1 |
| PLAT-5 | Native wrap | Capacitor build for stores | S19 |
| PLAT-6 | Plan tiers | free / family / agency | After pilot |

---

## 6. Data model (summary)

Core: `households`, `users` (role), `patients`, `contacts` (priority, channels, `whatsapp_opt_in_at`), `consents` (basis, given_by, evidence_note), `care_plans`, `care_plan_items` (`medication_id` nullable), `reminders` (`next_action_at`, `attempt`, `locked_until`, status), `escalation_steps` (unique reminder_id + step), `events`, `alerts`, `conversations`, `messages`, `daily_summaries`, `media`.

Security: `device_tokens` (hash, patient_id, scope, expires_at, revoked_at), `ack_tokens` (hash, alert_id, expires_at, used_at), `audit_log`.

Vault: `conditions`, `medications` (ingredient, strength, dose, frequency, timing, with_food, purpose, prescriber, start_date, stop_date, status, verified_by, verified_at), `allergies`, `providers`, `vault_documents`.

Later: `safety_flags`, `rx_scans`, `food_plans`, `fitness_plans`, `food_cautions`, `alexa_links`.

Every table has `household_id` (directly or via patient) and an RLS policy.

## 7. API endpoints (summary)

`POST /api/checkin` (device token) · `POST /api/reminders/:id/confirm` · `POST /api/events` · `POST /api/cron/tick` (secret) · `POST /api/alerts/:id/ack` · `POST /api/medicines/:id/nudge` · `POST /api/medicines/:id/family-confirm` · `GET/PUT /api/patients/:id/careplan` · CRUD `/api/patients/:id/vault/*` · `POST /api/twilio/webhook` (signature checked) · `POST /api/device/pair` · `POST /api/rx/extract` · `POST /api/safety/check` · `GET /api/patients/:id/summary`

## 8. Security requirements (checklist for every stage)

- RLS on every table. A test proves household A cannot read or write household B.
- Service-role key server-side only. Never in client bundles, `NEXT_PUBLIC_` variables, logs or git history.
- Validate all input with zod on the server. Parameterised queries only. Escape all model and user text.
- Rate limits on login, sign-up, reset, OTP/WhatsApp, nudge, check-in.
- Verify Twilio signatures. Cron endpoint needs a secret header.
- Acknowledge links and device tokens are hashed, single-use or revocable, and expire.
- Model output must pass schema validation. Invalid or uncertain output falls back to a scripted reply and alerts a human.
- No health data in URLs, analytics, console logs or page titles. `Cache-Control: no-store` on authenticated pages.
- Medical data changes are human-approved and audited.
- Dependency audit and secret scan before each release.

---

## 9. Build stages

Credit caps are planning budgets, not measurements. Check real spend after S2 and adjust.

### Phase 1: the demo app (20 hours, $100)

| Stage | Name | Hours | Cap |
|---|---|---|---|
| S1 | Foundation and design system | 1.5 | $8 |
| S2 | Auth, roles, security basics | 3 | $14 |
| S3 | Onboarding, consent, Vault Lite, care plan | 3.5 | $12 |
| S4 | Patient mode and AI check-in | 3 | $12 |
| S5 | Reminders and escalation engine | 2.5 | $11 |
| S6 | WhatsApp alerts and acknowledge | 1.5 | $6 |
| S7 | Family dashboard, medicine grid, nudge | 3 | $12 |
| S8 | Sensor events and demo panel | 1 | $4 |
| S9 | Hardening and rehearsal | 1 | $10 |
| | Buffer | | $11 |

**S1 Foundation (feed sections 1, 2, 3, 6, 8)**
Build: Next.js + Tailwind + Supabase project, schema and RLS for all Phase 1 tables, design tokens from 3.1, PWA manifest, seed data (Meera, Anita, Ravi, a demo care plan).
Done when: app runs locally and on Vercel; seed loads; tokens render in a style page; RLS enabled on every table.
Security gate: no service key in client code; household A/B test exists.

**S2 Auth (feed 3, 4, 5A, 8)**
Build: AUTH-1 to AUTH-8, corner Log in button, route protection, security headers.
Done when: signed-out users see no data; sign-up cannot choose a role; enumeration, rate-limit, expired-token and open-redirect tests pass.
Security gate: full auth checklist from Section 8.

**S3 Onboarding, Vault Lite, care plan (feed 5B, 5C, 5H)**
Build: ONB-1, 2, 3, 5; VLT-1 to VLT-5; CARE-1, 2, 3, 5, 6.
Done when: a new family can activate Meera in under 3 minutes; medicines are structured and Unverified until approved; plan reminders link to vault medicines.
Security gate: server-side role checks; two-path consent stored.

**S4 Patient mode (feed 3, 5D)**
Build: ONB-4 plus PAT-1 to PAT-10, PRIV-2.
Done when: Meera can say or tap "Yes, I took them" and it logs; red-flag test set triggers alerts; invalid model JSON falls back safely.
Security gate: device token scoped to one patient; check-in rate limit.

**S5 Reminders and escalation (feed 5E, 6, 7)**
Build: REM-1 to REM-7, CARE-4.
Done when: a missed dose moves prompt, re-prompt, family alert, secondary contact; a confirmation at any step stops it; double tick causes no duplicate step.
Security gate: cron secret; idempotency test.

**S6 Alerts (feed 5F)**
Build: ALR-1 to ALR-5.
Done when: your real phone receives the WhatsApp alert; acknowledging stops escalation; reused link is rejected.
Security gate: Twilio signature check; spend cap set; rejoin sandbox before testing.

**S7 Family dashboard (feed 3, 4, 5G, 5I)**
Build: DASH-1 to DASH-4, DASH-6, MED-1 to MED-3.
Done when: dashboard shows seeded data live; medicine grid matches reminders; nudge obeys cooldown and cap; family confirm shows as "Given by".
Security gate: `no-store` headers; realtime respects RLS.

**S8 Sensors and demo (feed 5N)**
Build: SENS-1 to SENS-4.
Done when: stove button creates an amber event and Nurra speaks; door-at-night creates an urgent alert.
Security gate: demo panel hidden unless demo flag and admin role.

**S9 Hardening (feed 8)**
Build: one strong security review pass, OWASP ZAP baseline scan, two timed demo runs, backup demo video.
Done when: no Critical or High findings left; full demo works twice.

**Cut order if time slips:** S8 polish, DASH-4 story polish, then presets beyond dementia. Never cut security gates, escalation idempotency, or Acknowledge.

### Phase 2: after the demo (about 23 hours; plan roughly $100+ more credits)

Build one at a time, in this order. Each stage depends on the one before.

| Stage | Name | Hours | Features |
|---|---|---|---|
| S10 | Voice call escalation step | 1.5 | REM-8 |
| S11 | Vault complete and medicine history | 2.5 | VLT-6 to 9, MED-4, MED-5, PAT-11, PAT-12, PRIV-1 |
| S12 | Prescription scan | 4 | RX-1 to RX-6, VLT-10 |
| S13 | Safety check, level A | 2.5 | SAFE-1 to SAFE-5 |
| S14 | Alexa | 5.5 | ALX-1 to ALX-6 |
| S15 | Food and workout planner | 4.5 | FIT-1 to FIT-6 |
| S16 | Memories and trends | 3 | MEM-1 to 3, DASH-5 |

### Phase 3: optional

| Stage | Name | Features |
|---|---|---|
| S17 | Safety check, level B (needs a data-licence decision) | SAFE-6, SAFE-7 |
| S18 | Clinician view and PDF reports | CLN-1, CLN-2 |
| S19 | Push notifications and native wrap (Capacitor) | ALR-6, PLAT-5 |
| S20 | Hindi and Kannada voice and text | PAT-13 |

---

## 10. Acceptance tests (run at S9)

1. Missed tablet: prompt, re-prompt, WhatsApp to primary, acknowledge on phone, escalation stops, dashboard turns green.
2. Confirmed tablet: no repeat prompt for that dose.
3. Ambiguous reply ("maybe"): stays unconfirmed.
4. Red-flag phrase ("chest pain"): immediate alert to all contacts, calm script, no promise of help.
5. Stove on: Nurra speaks, amber event; door at 03:00: urgent alert.
6. Household A user requests household B patient: denied.
7. Sign-up with role "clinician" in the request body: ignored.
8. Reused acknowledge link: rejected.
9. Nudge on a taken medicine: blocked. Fourth nudge in a day: blocked.
10. Model returns invalid JSON: scripted fallback plus human alert.

## 11. What Nurra must not claim

No diagnosis, no dose advice, no "safe to take", no fall detection or sensor learning until real devices exist, no "licensed nurse", no results from pilot targets. "Health data stays in the family's account" is not accurate (transcripts pass through cloud services). Say: encrypted, consented, minimal retention, deletable.

---

## Appendix A: `CLAUDE.md` (put at repo root)

```
# Nurra
Mobile-first PWA (Next.js, Supabase, Tailwind). Full spec: docs/NURRA_SPEC.md.

Rules
- Build only the stage I name. Do not start other stages.
- Colours and type come from the tokens in spec section 3. No hardcoded hex in components.
- The LLM has no tools. Escalation, confirmation and red-flag handling are code.
- A dose is taken only on explicit yes. Never re-prompt a confirmed dose.
- Medical data changes need human approval and an audit row.
- Never say "safe". Safety checks show flags only.
- RLS on every table. Service-role key server-only. zod on every input.
- Scheduler is pg_cron, not Vercel Cron.
- No PII or health data in URLs, logs, analytics or page titles.
After each stage: list files changed, run tests, show each "Done when" as pass/fail, then stop.
```

## Appendix B: Stage prompt template

```
Read CLAUDE.md and docs/NURRA_SPEC.md sections [LIST FROM THE STAGE].
Build ONLY Stage [S#: NAME]. Do not build features from other stages.
1. List the files you will create or change.
2. Implement the features: [FEATURE IDS].
3. Use the design tokens in section 3. Mobile first at 390x844.
4. Write tests for every "Done when" line and for the security gate.
5. Run everything. Report each "Done when" as pass or fail with evidence.
6. List anything I must configure by hand (Supabase, Twilio, env vars).
Stop after reporting. Do not start the next stage.
```