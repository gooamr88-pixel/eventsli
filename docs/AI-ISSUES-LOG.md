# Eventsli AI — Issues & Decisions Log

The single record of every bug, blocker, unresolved issue, deferred fix and
decision found while building Eventsli AI (Seating Designer, then Smart Event
Creator).

**Rules for this file**

- Nothing is deleted. An item is closed by changing its status, never by
  removing its row.
- An item is `Fixed` only with a note of HOW it was verified (test name,
  command, or observed result). "Should be fixed" is `Open`.
- `Deferred` needs a reason and the phase it is deferred to.
- Pre-existing problems found during this work are logged too, marked
  `pre-existing`, even when they are outside the AI scope.
- Final gate (owner instruction, 2026-10-17): after both features are complete,
  every item here is reviewed, fixed and verified before production deployment.
  Security blockers (exposed secrets) must be resolved before production.

Statuses: `Open` · `In progress` · `Fixed (verified)` · `Deferred` ·
`Needs owner` · `Won't fix (owner-approved)`

---

## Decisions

| ID | Date | Decision | Made by | Notes |
|---|---|---|---|---|
| D-001 | 2026-10-17 | Build order: AI Seating Designer first, then AI Smart Event Creator. | Owner | |
| D-002 | 2026-10-17 | Each organizer gets **2 AI generations per day in total**, shared across both features, enforced server-side in the database. | Owner | Window definition and refund rule: see D-009, D-010 (proposed). |
| D-003 | 2026-10-17 | Providers: **hybrid Gemini + Groq**. | Owner | Roles proposed in D-011. |
| D-004 | 2026-10-17 | **English-only UI.** | Owner | |
| D-005 | 2026-10-17 | The AI suggests layouts and ticket types only. **Deterministic geometry places tables** and prevents overlaps; the AI never outputs coordinates. | Owner | |
| D-006 | 2026-10-17 | **Never invent ticket prices** unless the organizer supplies a budget or a reference price. | Owner | Enforced in code, not only in the prompt — see D-012. |
| D-007 | 2026-10-17 | Preserve the existing architecture, map editor, save flow, permissions and sales restrictions; no unnecessary rewrites. | Owner | Design consequence: AI endpoints are read-only proposals; all writes go through existing endpoints (`PUT /venue-map`, `POST /tiers`, `POST /events`). |
| D-008 | 2026-10-17 | Maintain this log; review, fix and verify every item before production. | Owner | |
| D-009 | 2026-10-17 | "per day" = rolling 24 hours from each generation (timezone-free; the UI shows when the next one is available). | Owner approved 2026-10-17 | Alternative: calendar day in America/Toronto. |
| D-010 | 2026-10-17 | a generation counts once a provider returns a valid proposal. If every provider fails, or the output fails validation, the reserved slot is released and does not count. Requests refused before any AI call (wrong event type, sold seats) never consume quota. | Owner approved 2026-10-17 | |
| D-011 | 2026-10-17 | Gemini is the primary provider and Groq (strict `json_schema`) the automatic fallback on timeout, 429/5xx, safety block or invalid output. One organizer request = one quota unit, whichever provider answered. Provider order and model IDs are env settings. | Owner approved 2026-10-17 | |
| D-012 | 2026-10-17 | the server strips every AI price unless the request carried an explicit `budget` or `referencePrice` field (Designer), or the organizer's own text contains that exact amount (Creator). `0` only when the organizer marked the event free. | Owner approved 2026-10-17 | |
| D-013 | 2026-10-17 | call Gemini and Groq over REST with Node 22's built-in `fetch` (the `placesService.js` pattern), adding **no npm dependencies** — CI blocks on `npm audit --audit-level=moderate`. | Owner approved 2026-10-17 | |
| D-014 | 2026-10-17 | AI is organizer-only. Quota is keyed to `organizer_id`; an admin (who bypasses `verifyEventOwner`) is refused rather than silently spending an organizer's quota. | Owner approved 2026-10-17 | |
| D-015 | 2026-10-17 | the Seating Designer applies its layout as ONE undo step into the editor's unsaved draft (`useMapDraft.apply`) and is offered only for ticketed, reserved-seating events with no held or sold seats. | Owner approved 2026-10-17 | |
| D-016 | 2026-10-18 | **Build order changed: the AI Smart Event Creator is built first.** Supersedes the order in D-001. The shared foundation (quota table, provider client) is built with it and reused by the Seating Designer. | Owner | Answer "Ai event creation" to the Phase 1 report. |
| D-017 | 2026-10-18 | **Fix every bug found during the audit** (I-017 to I-022 where code can fix them). | Owner | Answer "Fix all". |
| D-018 | 2026-10-18 | **A suggested ticket type with no price blocks saving** until the organizer enters a price, marks it free, or removes it. | Owner | Answer "Yes restrict". Matches I-014: the API cannot create an unpriced tier. |
| D-019 | 2026-10-18 | **Free tiers of Gemini and Groq, as a hybrid**: Gemini primary, Groq automatic fallback (D-011 unchanged). | Owner | "grok" in the answer is read as Groq, the provider chosen in D-003; if xAI Grok was meant, it is one provider adapter. Consequence: Google's pricing page marks free-tier content "Used to improve our products: Yes" (checked 2026-10-18). This is disclosed on the describe screen and in the privacy policy. Resolves the billing half of I-011. |
| D-020 | 2026-10-18 | Defaults applied where the owner gave no answer (the recommendations in the Phase 1 report): emails and phone numbers are removed before text is sent; no prompt or AI output is stored, only usage metadata; the generation is linked to the event it created, and admins see "AI-assisted"; "Change it and regenerate" is allowed and costs one draft; new issues are recorded here. | Claude, on the owner's go-ahead | Any of these can be reversed by the owner. |
| D-021 | 2026-10-18 | Amends D-013: providers are called over `node:https` with an IPv4-only agent (the `placesService.js` pattern), not `fetch`. Gemini is called with `generateContent` + `responseSchema` (OpenAPI subset); Groq with strict `json_schema`. Both schemas are generated from one definition. | Claude | See I-019. Model IDs as env settings: `gemini-3.8-flash`, `openai/gpt-oss-120b` (both read from provider docs 2026-10-18; confirmed only by `scripts/probe-ai.js` with real keys, I-010). |

---

## Issues

| ID | Found | Type | Severity | Status | Summary |
|---|---|---|---|---|---|
| I-001 | 2026-10-17 | Bug, pre-existing | Medium | Open | Overlapping tables are not detected anywhere, despite a comment saying they are |
| I-002 | 2026-10-17 | Security blocker, pre-existing | **Critical** | Needs owner | Exposed live secrets have not been rotated |
| I-003 | 2026-10-17 | Blocker, pre-existing | High | Needs owner | Categories migration not applied to production |
| I-004 | 2026-10-17 | Unverified, pre-existing | High | Open | Gallery/sponsor URL-check migration: applied state unknown |
| I-005 | 2026-10-17 | Blocker, pre-existing | High | Needs owner | No Stripe test key; local `.env` holds a live key with `NODE_ENV=development` |
| I-006 | 2026-10-17 | Unverified, pre-existing | Medium | Open | Deployed state of the October readiness fixes is unknown |
| I-007 | 2026-10-17 | Known limitation, pre-existing | Medium | Needs owner | Refunds are not automated |
| I-008 | 2026-10-17 | Tech debt, pre-existing | Low | Open | `MapEditor.jsx` (547) and `NewEventForm.jsx` (538) exceed the 500-line cap |
| I-009 | 2026-10-17 | Dependency | High | Needs owner | Gemini and Groq API keys do not exist yet |
| I-010 | 2026-10-17 | Risk | Medium | Open | Model IDs and API shapes are unverified until a live smoke test |
| I-011 | 2026-10-17 | Risk / compliance | High | Needs owner | Provider data-use terms and the privacy policy |
| I-012 | 2026-10-17 | Risk | Low | Open | Groq organization-wide rate limits |
| I-013 | 2026-10-17 | Design constraint | Medium | Open | The map has no real-world scale and a fixed 1000×700 world |
| I-014 | 2026-10-17 | Design constraint | Medium | Open | A ticket type cannot be created without a price |
| I-015 | 2026-10-17 | Housekeeping, pre-existing | Medium | Needs owner | Production backup (PII) still sits in an old session's scratchpad |
| I-016 | 2026-10-17 | Process, pre-existing | Low | Open | Recent commits have meaningless messages; CI status unknown |
| I-017 | 2026-10-18 | Bug, pre-existing | High | Fixed (verified) | `POST /events` ignores `admissionType`, so every General admission event is stored as reserved seating |
| I-018 | 2026-10-18 | Gap, pre-existing | Low | Fixed (verified) | Event `description` has no length limit on `POST` or `PATCH /events` |
| I-019 | 2026-10-18 | Design correction | Medium | Fixed (verified) | D-013 named `fetch`; the Places client actually needs IPv4-forced `node:https`, and so will the AI client |
| I-020 | 2026-10-18 | Compliance, pre-existing | Medium | Needs owner | The privacy page's processor list omits Google Places, and will need Gemini and Groq |
| I-021 | 2026-10-18 | Constraint | Low | Fixed (verified) | The browser client gives up after 30 s, which caps the AI request budget |
| I-022 | 2026-10-18 | Design constraint | Low | Fixed (verified) | No bulk endpoints for ticket types or schedule, so saving an AI draft is several requests and not atomic |

### I-001 — Overlapping tables are not detected anywhere
- **Where:** `frontend/src/app/organizer/events/[id]/map/MapEditor.jsx:112-115` says the problem list (the Save-button gate) covers "overlapping tables, seats outside the world box … and the server rejects those plans". `draftRules.mapProblems` checks neither; `venueService.saveMap` and `save_venue_map` check neither. A search of frontend, backend and migrations for overlap/collision logic finds none.
- **Impact:** an organizer can save two tables on top of each other; buyers see an unreadable map. The comment misleads future maintainers.
- **Plan:** the Seating Designer adds a pure overlap test to `seatingGeometry` for its own generator (Phase 1). Wiring it into `mapProblems` for manually drawn maps, and correcting the comment, is deferred to the final review phase (non-AI behaviour change).
- **Status:** Open.

### I-002 — Exposed live secrets have not been rotated
- **Source:** memory `eventsli-production-readiness-2026-10` / `eventsli-key-rotation-followup`. A plaintext file on the Desktop holds the live Stripe secret key, a webhook secret, the Supabase service-role JWT, the anon JWT and the DB password. Checked by fingerprint 2026-10-15 and 2026-10-16: all still valid.
- **Impact:** full database and payment control for anyone holding that file.
- **Blocks:** production deployment (owner rule).
- **Fix:** owner rotates every key; verify with `keycheck.js` (session 68521cce scratchpad `inspect/`); then delete the plaintext file. New Gemini/Groq keys must never be written there.
- **Status:** Needs owner.

### I-003 — Categories migration not applied to production
- `20261015090000_more_event_categories.sql` is unapplied (memory, 2026-10-16). The Smart Event Creator constrains the AI's category to the DB's category list, so production would offer fewer categories than code and tests assume.
- **Status:** Needs owner (`apply-migration.js` was blocked as a production deploy; owner runs it).

### I-004 — Gallery/sponsor URL-check migration: applied state unknown
- `20261016090000_fix_event_media_and_sponsor_url_checks.sql` fixes every gallery insert returning 500 since 2026-09-17. Memory says "owner applies via SQL editor"; no confirmation recorded.
- **Fix:** verify read-only with `backend/scripts/verify-schema.js` (with the owner's permission).
- **Status:** Open.

### I-005 — No Stripe test key
- `backend/.env` holds an `sk_live` key with `NODE_ENV=development` and no `sk_test`, so a test-mode checkout cannot be run.
- **Status:** Needs owner. Not an AI dependency, but blocks the end-to-end verification before production.

### I-006 — Deployed state of the October readiness fixes is unknown
- The readiness-pass fixes (cookie scope, auth handling, paging, Permissions-Policy `geolocation=(self)`, the 404 fix, etc.) are present in the code (`csp.mjs:255` checked). Whether they are deployed to the VPS is not recorded.
- **Status:** Open — verify at the pre-production review.

### I-007 — Refunds are not automated
- `charge.refunded` only logs for manual review.
- **Status:** Needs owner (a product decision, outside the AI scope; logged so it is not lost).

### I-008 — Two files exceed the 500-line cap
- `fileSizeCheck.js` warns and does not fail. Adding the AI entry points will add a few lines to each file.
- **Mitigation:** all new UI goes in new files; edits to these two files are limited to mounting a component.
- **Status:** Open (split in the review phase if the owner wants).

### I-009 — Gemini and Groq API keys do not exist yet
- Needed before any live call. Keys go in `backend/.env` locally and `/var/www/eventsli/backend/.env` on the VPS, nowhere else.
- **Status:** Needs owner.

### I-010 — Model IDs and API shapes are unverified until a live smoke test
- Current IDs were read from provider docs on 2026-10-17 (Gemini 3.x Flash / Flash-Lite; Groq `openai/gpt-oss-120b` / `-20b` with strict `json_schema`). They are env settings, not hard-coded, and a smoke-test script must pass before each feature ships.
- **Status:** Open.

### I-011 — Provider data-use terms and the privacy policy
- Organizer text (event descriptions, venue details) will be sent to Google and Groq. Google's free Gemini tier may use prompts to improve its products (to verify against current terms); a paid tier is likely required for organizer data. The privacy policy needs to name both providers as processors (PIPEDA / Quebec Law 25). No buyer data is ever sent.
- **Status:** Needs owner (billing tier choice, policy text approval).

### I-012 — Groq organization-wide rate limits
- Developer-plan base limits per model: 30 requests/min, 1K requests/day, 8K tokens/min, 200K tokens/day. These are platform-wide, not per organizer. 2 per organizer per day keeps this far off at launch scale, but bursts can 429; Groq structured outputs also cannot stream.
- **Plan:** treat 429 as "fallback unavailable"; log provider usage per generation for monitoring.
- **Status:** Open.

### I-013 — The map has no real-world scale and a fixed 1000×700 world
- `seatingGeometry.WORLD` is abstract units; `toPercent` clamps positions to 0–100%. Table size comes from seat count, not metres, so a large room's tables may not fit the world.
- **Plan:** the generator places only what fits, reports "fits N of M" and never silently drops tables; real room dimensions can be stored in `layout_json.room` (unknown keys are preserved by `writeZones`) as an advisory.
- **Status:** Open.

### I-014 — A ticket type cannot be created without a price
- `POST /events/:id/tiers` requires `priceCents` (integer ≥ 0). An AI-suggested tier with no price (D-006) cannot be created as-is, which is correct and must be kept.
- **Plan:** suggested tiers are shown with an empty price field the organizer must fill before "Create"; or skipped, leaving tables without a tier — which `submissionBlockers` and `hold_seats` (`SEAT_NOT_PRICED`) already refuse to sell.
- **Status:** Open (design, resolved by implementation).

### I-015 — Production backup (PII) still in an old scratchpad
- The 2026-10-15 reset backup (production PII) is in session 68521cce's scratchpad `reset/backup/`, "until the owner says delete".
- **Status:** Needs owner — delete once the backup is no longer needed (part of the end-of-project cleanup with I-002).

### I-017 — `POST /events` ignored `admissionType`
- **Where:** `backend/controllers/eventController.js` `create`. The route validated `admissionType` and the wizard sent it (`NewEventForm.jsx`), but the insert never wrote `admission_type`, so the column default `'reserved'` won and every General admission event asked for a seating map.
- **Fix:** the insert writes `admission_type: req.body.admissionType || 'reserved'` (same default as the column).
- **Verified:** `backend/test/integration/aiCreator.test.js` — "the draft saves as an ordinary private draft, general admission kept (I-017)" asserts the created event reads back `admissionType: 'general'`; run on the local stack 2026-10-18, 11/11 pass.
- **Status:** Fixed (verified).

### I-018 — Event description had no length limit on the API
- **Fix:** `body('description')…isLength({ max: 5000 })` on `POST /events` and `PATCH /events/:id`, matching both forms' `maxLength`.
- **Verified:** `aiCreator.test.js` — "an event description is bounded on create and edit (I-018)": 5,001 characters refused on create and on PATCH, 5,000 accepted.
- **Status:** Fixed (verified).

### I-019 — The AI client must use IPv4-forced `node:https`, not `fetch`
- **Fix:** `backend/services/ai/aiHttp.js` copies the `placesService.js` agent (`family: 4`). Recorded as D-021.
- **Verified in code and unit tests** (`aiProviders.test.js` runs through the same transport seam). The IPv4 path against a real IP-restricted key can only be proven on the VPS: `node scripts/probe-ai.js` (deployment checklist).
- **Status:** Fixed (verified locally); VPS proof is part of I-010.

### I-020 — Privacy page processor list
- **Fix:** `frontend/src/app/privacy/page.jsx` now names Google for venue search and Gemini drafts — including that the free tier may use the description to improve Google's products (D-019) — and Groq as the fallback. The describe screen says the same at the moment of sending.
- **2026-10-18, owner asked "make the privacy policy ready":** `/privacy` rewritten in full from the schema and services, re-verified claim by claim (sessions keep a hashed IP and browser description; the visit counter; guest checkout; transfers; door scans; organizer and door-team data; OpenStreetMap, YouTube/Vimeo (on play only), Google sign-in; the database in AWS us-west-1; 24 h sessions, 10 min codes, 60 min reset links; transactional email only). Owner answers: name "Eventsli", contact info@eventsli.com, server in the United States, accounts 16+. Adds cross-border, retention, rights (PIPEDA, Quebec, US states), breach, children and changes sections. A claim the old page made but the terms on disk do not support ("organizers may not market to you") was removed.
- **Guard:** `frontend/test/privacyPolicy.test.jsx` fails if a host is added to the CSP or a provider to `services/ai/config.js` without being named on the page. Verified: 19/19 with `seoRoutes.test.js`; eslint, `npm run check` and a production build pass.
- **Still the owner's:** (1) a lawyer's review before launch; (2) confirm the VPS rotates and deletes nginx access logs, since the page says request logs are "deleted automatically after a short period"; (3) the account sign-up has no "I am 16 or older" confirmation yet; (4) consider adding a "no marketing to buyers without consent" clause to the organizer terms, which the page no longer claims.
- **Status:** Needs owner (the four items above).

### I-021 — The 30 s browser timeout caps the AI request
- **Fix:** provider deadlines 11 s + 9 s, and no fallback starts after 15 s (`services/ai/config.js`, `eventDraftService.js`), so the API answers well inside the browser's 30 s.
- **Verified:** `aiProviders.test.js` (fallback order and budget logic).
- **Status:** Fixed (verified).

### I-022 — Saving an AI draft is several requests, not one
- **Fix:** `saveAiDraft.js` creates the event first (the only request that can fail the save), then highlights, ticket types and schedule in order; anything that fails is named and "Try adding them again" retries only those. No item is sent twice.
- **Verified:** `frontend/test/aiCreator.test.jsx` — "a ticket type that fails to save is named, and retrying adds only that one".
- **Status:** Fixed (verified).

### I-016 — Recent commits have meaningless messages; CI status unknown
- `fc255f3 cxbnd`, `ac6dee5 cdjbnd`, `edc8370 cddghbn`, `184a39e gdhcdbh`. History is hard to audit, and whether CI is green on `main` is not recorded.
- **Status:** Open — check CI before AI work merges; AI work will use descriptive commits (only when the owner asks to commit).
