# Nurra: rules for AI coding agents

Nurra is a mobile-first installable web app (PWA) for people with dementia and their families.
Full spec: docs/NURRA_SPEC.md. When this file and the spec disagree, the spec wins.

## How to work
- Build ONLY the stage I name (S1, S2, ...). Never start another stage or add features that belong to one.
- Before coding, list the files you will create or change. Wait for no approval, but keep the list short.
- After coding: run tests, lint and typecheck. Report each "Done when" line from the spec as pass or fail with evidence. Then stop.
- If something is unclear or the spec conflicts with itself, ask one short question instead of guessing.
- Ask before installing any package that is not in the stack below.
- Never run destructive commands (drop database, delete folders, force push) without asking.

## Stack
Next.js (App Router, TypeScript), Tailwind, zod, Supabase (Auth, Postgres with RLS, Realtime, Storage), Vercel.
Scheduler is pg_cron calling a secured endpoint. Do NOT use Vercel Cron.
Alerts use Twilio WhatsApp. No SMS (India DLT rules).
This Next.js version differs from older versions: read node_modules/next/dist/docs/ before writing Next.js code.
Auth gating uses proxy.ts (Next 16 renamed middleware). cacheComponents stays OFF: private pages must never be cached on the server.

## Product rules (never break)
1. The LLM has no tools. Escalation, confirmation and red-flag handling are plain code.
2. A dose counts as taken only on an explicit yes (tap or exact affirmative). Ambiguous replies stay unconfirmed. Never prompt a confirmed dose again.
3. Any change to medicines, allergies or conditions needs a human and an audit_log row.
4. Never diagnose, suggest doses, or say a medicine is "safe". Safety checks show flags only: "Discuss with a pharmacist".
5. Never promise help that has not been summoned. Say "I am letting Anita know now".
6. Nurra never says "you forgot" or "as I told you". Short, warm sentences. Offer choices.
7. No cameras. Audio and motion only, with recorded consent.

## Security rules (every stage)
- Row-level security on every table. Add a test proving household A cannot read or write household B.
- The Supabase service-role key is server-only. Never in client code, NEXT_PUBLIC_ variables, logs, or git.
- Validate every input on the server with zod. Parameterised queries only. Escape all user and model text.
- Role, household_id and patient_id are never trusted from the client.
- Rate-limit login, sign-up, reset, WhatsApp sends, nudges and check-ins.
- Verify Twilio signatures. The cron endpoint requires a secret header.
- Tokens (device, acknowledge, invite) are hashed, expiring and single-use or revocable.
- Model output must pass schema validation. If invalid or uncertain, use the scripted fallback and alert a human.
- No health data or names in URLs, logs, analytics, or page titles. Authenticated pages send Cache-Control: no-store.
- Never print, log or commit secrets. Use .env.local. Keep .env.example free of real values.

## Design rules
- Colours come only from src/design/tokens.ts through Tailwind classes. No hex values in components.
- Status is always colour + icon + word, never colour alone. Raw status colours (ok, warn, danger) are for dots and fills, never text.
- Patient mode: warm cream background, Nunito, minimum 28px body text, 72px buttons, one action per screen, always light theme.
- Family app: Inter, 16px body, 48px touch targets, bottom tab bar (Today, Medicines, Vault, Plan, More), optional dark mode.
- Text contrast at least 4.5:1 (7:1 in patient mode). Respect prefers-reduced-motion. No flashing.
- Mobile first at 390x844. Check 360px wide.
- Copy: sentence case, no "please", no "successfully", no exclamation marks on system messages.

## Code rules
- TypeScript strict. No `any` without a comment explaining why.
- Keep server-only code behind `import "server-only"`.
- Write tests for every "Done when" line and every security gate.
- Small files, clear names, no dead code, no TODOs left silently.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
