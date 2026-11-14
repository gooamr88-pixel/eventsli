# Eventsli — Technical Audit & Remediation Log

Started 2026-11-05. This is the full-platform audit; it is a companion to
`AI-ISSUES-LOG.md` (AI features, I-001..I-031), which is not duplicated here.
The same rules apply:

- Nothing is deleted; an item is closed by changing its status.
- `Fixed (verified)` needs HOW it was verified (test name, command, output).
- `Fixed (unverified)` = code changed, but the proof needs something not
  available locally (a local Supabase stack, a live Stripe test key, a browser).
- `Deferred` needs a reason and a phase. `Needs owner` = a product/ops decision.
- No production database, Stripe account or server was touched during this
  work. There is no `backend/.env` on this machine; integration tests need a
  local Supabase stack (Docker), which is not installed here.

Statuses: `Open` · `In progress` · `Fixed (verified)` · `Fixed (unverified)` ·
`Deferred` · `Needs owner` · `Won't fix (owner-approved)`

## Baseline (2026-11-05, before any change)

| Check | Result |
|---|---|
| Backend unit (`node --test "test/*.test.js"`) | 401 / 401 pass |
| Frontend unit (`vitest run`) | 747 / 747 pass, 74 files |
| Frontend static checks (`npm run check`) | pass |
| Frontend lint (`eslint .`) | clean |
| Secret scan (`scripts/secretScan.js`) | clean, 777 files |
| `npm audit --audit-level=moderate` | **FAIL** — 18 advisories (3 critical, 4 high). CI's first backend step, so the CI unit job cannot reach `npm test`. |
| Integration tests | not runnable here (no local Supabase stack) |

Local Node is v26; `engines` says `>=22 <25`, CI uses 22. Local results are
indicative, not CI-equivalent.

## Audit method

Five specialist read-only audits ran in parallel (Security, Backend/API,
Database, Frontend/UX, QA/Perf/DevOps), and the integration lead consolidated
them. Findings reported by more than one auditor are merged under one ID with
the original IDs in brackets. Every Critical/High item was re-checked by the
lead against the code before being ranked; the evidence is under each phase.

---

## Roadmap

Ordered by severity × business impact, then by dependency. Phases 0–1 are code
changes testable without a database; items marked **[mig]** need a forward
migration and therefore a local Supabase stack to verify.

### Phase 0 — Runtime supply chain (do first)

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-001 | **Critical** | `next@16.3.8` carries an unauthenticated RCE advisory in the Image Optimization API (SVG) plus others; fixed in 16.4.5 | Fixed (verified) |
| T-002 | High | Runtime transitive advisories: `body-parser`/`qs` (via express), `undici`, `zod` — non-breaking fixes available | Fixed (verified) |
| T-003 | Medium | Dev-only advisories (vitest/tinypool critical, vite, eslint-config-next chain) need semver-major upgrades; documented in SECURITY-ADVISORIES.md | Fixed (vitest 4.1.12 + minimatch override; npm audit 0, T-078) |
| T-004 | High | CI: `npm audit` runs before backend tests in the same job, so a dev-only advisory hides every unit regression [QA-02] | Fixed (unverified — needs a CI run) |

### Phase 1 — Money, inventory and account security

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-010 | **Critical** | Stripe session can outlive the seat hold → buyer charged, no tickets [BE-01, DB-03] | Fixed (verified: units, integration, live Stripe probe — full Connect pay pending) |
| T-011 | High | Checkout idempotency key reused with changing params → retrying "Pay" is a 500 for 24 h [BE-03, QA-03, SEC F-1] | Fixed (verified: units + live Stripe test-mode probe) |
| T-012 | High | Amount charged never reconciled; promo can be removed after the session is created → order/ledger disagree with Stripe, single-use code reusable [SEC-02, BE-02] | Fixed (verified: units, integration — full Connect pay pending) |
| T-013 | High | Pre-account takeover: Google sign-in verifies an unverified account but keeps the squatter's password [SEC-03] | Fixed (verified) |
| T-014 | High | Open redirect after login/register/verify: `safeNext` accepts `/\evil.test` and `/<TAB>/evil.test` [FE-01, SEC-06] | Fixed (verified) |
| T-015 | High | `tableIsPrivate` ignores the lookup error and fails OPEN → private table holdable without its password [BE-08] | Fixed (verified by review) |
| T-016 | High | Ticket transfer does not move the credential: old QR still admits the seller, recipient gets nothing **[mig]** [SEC-01, BE-04] | Fixed (verified locally) — see "Check-in v2" below; production needs migration `20261108090000` |
| T-017 | High | Growing a held table lets a new seat be sold twice; `fulfill_checkout` issues by table membership **[mig]** [DB-01] | Fixed (verified locally, 2026-11-09): migration `20261111090000`, not yet applied to production — see "Tickets, seat map and buying" below |
| T-018 | High | Cutting a tier's allocation ignores live holds → paid checkout rolls back, no tickets **[mig]** [DB-02] | Fixed in the API (verified locally, 2026-11-09): a cut below sold + held is refused. A hold landing in the same millisecond can still pass; closing that needs the lock **[mig]** |
| T-019 | Medium | Login lockout counter is read-modify-write (bypassed by parallel attempts) **[mig]**; credential limiter keyed on un-normalised email [SEC-05] | In progress — limiter key fixed; atomic counter needs [mig] |
| T-020 | Medium | Unnamed rate limiters share one Redis counter when `REDIS_URL` is set [SEC-07, BE-05] | Fixed (verified) |
| T-021 | Medium | Verification code + email written to logs when mail fails (subject carries the code); raw IP logged at the gate [SEC-08] | Fixed (verified) |
| T-022 | Medium | Seat hoarding: 15 holds/5 min/IP × 35 min TTL [SEC-04] | Needs owner (policy) |
| T-023 | Medium | Refunded / charged-back tickets still scan in [BE-19, extends I-007] | In progress — refunds and lost disputes now void tickets (T-074); refund initiation stays with the organizer. The door now also refuses any ticket whose order is no longer `paid` (Check-in v2) |
| T-024 | Low | `GET /public/reservations/:id/quote` needs no reservation token [SEC-09] | Open |
| T-070 | **High** | The Stripe account has **Managed Payments on by default**; it refuses any Checkout Session whose line item has no product `tax_code`. `createCheckoutSession` sends none, so on this account every card checkout would be refused | Fixed (owner-approved 2026-11-06; verified in units + test-mode API; full Connect pay pending T-073) |
| T-073 | **High** | The platform (test mode) cannot create organizer Connect accounts: Stripe refuses `accounts.create({ type: "express" })` while the platform has not confirmed it is the losses collector. The app's error translator sent operators to the wrong setting for this refusal | Superseded by T-074 (do NOT accept platform loss liability); translator fix kept |
| T-074 | **Critical** | Payment architecture contradicted the business model: destination charges made Eventsli the settlement merchant, payer of Stripe fees and disputes, and liable for organizer losses; the webhook trusted metadata alone (exploitable under direct charges) | Implemented; test mode FULLY verified for CA and US organizers with real webhook delivery and test payouts, no waiver; production steps pending |
| T-075 | High | Stripe delivers events out of order: a dispute arriving before its payment's checkout event was answered ORDER_NOT_FOUND and lost | Fixed (verified: integration + live redelivery) |
| T-076 | **Critical** | Deploy window: a pre-release checkout paid after the deploy was re-quoted as direct and refused (charged, no tickets) | Fixed (verified: integration; released in `def1750`) |
| T-077 | **Critical** | Migration NULL bug dropped legacy ledger rows; verify-schema could not confirm the rollout; apply-migration lacked lock timeouts, re-run guards and RLS on schema_migrations | Fixed (verified: rehearsal + tests; released in `def1750`) |
| T-078 | High | CI run #73 red: seed check used `supabase db psql` (absent in pinned CLI 2.122.1); full audit failed on 11 dev-only advisories (vitest/tinypool critical, minimatch) | Fixed (verified: full CI replayed locally, all steps pass; released in `def1750`) |
| T-079 | High | The Connect webhook answered 500, and Stripe retried for days, for every organizer sale made OUTSIDE Eventsli on their full Stripe account (their own Checkout, Payment Links), and for refunds and disputes on those sales | Fixed (verified: integration, the new tests fail without the fix; released in `55a408f`, CI green) |

### Phase 2 — Reliability, operability, broken flows

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-030 | High | Cache revalidation never reaches Next in prod: comma-separated `FRONTEND_URL` → invalid URL; failures logged at `debug` [QA-01, BE-15, SEC F-2] | Fixed (verified; REVALIDATE_URL set on the VPS by owner 2026-11-05) |
| T-031 | Medium | Error handler turns body-parser 400/413 into 500 [BE-11] | Fixed (verified) |
| T-032 | Medium | Non-numeric `RESERVATION_TTL_MINUTES` → NaN passes the boot check; `FRONTEND_URL` not required in prod [BE-15, QA-10] | Fixed (verified) |
| T-033 | High | Gate crashes when "Stop the camera" is pressed after the camera failed; a cancelled start leaves the stream running [FE-03] | Fixed (verified in units; not run on a camera) |
| T-034 | High | A second hold silently strands the first; checkout uses whichever token is stored [FE-04] | Fixed (verified in the browser, 2026-11-09) |
| T-035 | High | Buyer seat map not operable by keyboard (Enter/Space do nothing) — blocks purchase [FE-02] | Fixed (verified in the browser, 2026-11-09) |
| T-036 | Medium | Success page says "Nothing was charged" for a payment still `unpaid`/pending [FE-07] | Fixed (units; not run against a delayed Stripe payment) |
| T-037 | Medium | `apiClient`: a caller signal removes the 30 s timeout; body read is untimed [FE-08] | Open |
| T-038 | Medium | Webhook subscription list in DEPLOY.md misses `async_payment_succeeded`, `charge.dispute.created` [QA-05] | Open |
| T-039 | Medium | Ignored Supabase `error` on hold/checkout/Connect/release paths [BE-08 rest] | In progress: the three hold RPCs now check their error (2026-11-09); checkout, Connect and release paths remain |
| T-040 | Medium | Raw DB error messages returned to clients [BE-10] | Open |
| T-041 | Medium | Invoice issued/settled emails never sent (dead functions) [BE-06] | Open |
| T-042 | Medium | `?maxPrice=` scans every tier, truncates at 1000, can build a 75 KB URL [BE-07] | Open |
| T-043 | Medium | pm2 `kill_timeout` (1.6 s) < app drain (10 s); DEPLOY.md claims zero-downtime reload in fork mode [QA-07] | Open |
| T-044 | Medium | No DB request timeout on the Supabase client [BE-16] | Open |
| T-045 | Medium | Ticket emails fire-and-forget, no outbox [BE-09] | Deferred (Phase 3, needs table) |
| T-046 | Medium | Search box drops `to`/`country`; gate undo leaves "Admitted"; map edits during save lost; Back loses map work; countdown announced every second [FE-05, FE-06, FE-09, FE-10, FE-11] | Open — the gate-undo part is Fixed (unverified: no browser run), see "Check-in v2" |

### Phase 3 — Data integrity & performance (all **[mig]**)

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-050 | Medium | No DB guarantee of one live ticket per seat [DB-05] | Open |
| T-051 | Medium | Missing indexes: `orders(guest_email)`, `reservations(event_id,state)`, SET NULL FKs on tickets/order_items, `site_visits(path,day)` [DB-06] | Open |
| T-052 | Medium | PII retained forever (`webhook_events.payload`, abandoned `attendee_data`, resets, verifications) [DB-07] | Needs owner (retention periods) |
| T-053 | Low | Door sale lock order can deadlock with `hold_table` [DB-08] | Open |
| T-054 | Low | `invoices.due_at` nullable [DB-09]; check-in RPCs not event-scoped [DB-10]; promo code case-insensitive uniqueness [DB-11]; FKs blocking profile erasure [DB-12]; `search_path` without `pg_temp` [DB-13] | Open — the DB-10 part (check-in RPCs) is Fixed (verified locally), see "Check-in v2" |
| T-055 | High | `verify-schema.js` checks names only — cannot confirm I-003/I-004 or most later migrations [DB-04] | Open |
| T-069 | High | Two migrations guarded `INSERT INTO storage.buckets` on the storage SCHEMA existing; current Supabase images create an empty `storage` schema with storage disabled, so every fresh stack failed at `20260905090000` | Fixed (verified) |

### Phase 4 — Tests, CI, docs, dead code

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-060 | High | No tests on checkout-session creation, free claim, success-page fulfil, open-checkout closing, admin settle, CheckoutClient/SuccessClient/HoldBar [QA-04] | Open |
| T-061 | Medium | Vacuous tests: `userAdmin` "last super admin" `assert.ok(true)`; `authRedirect` regex over source [QA-11] | Open |
| T-071 | Medium | 7 integration tests failed on `main` (pre-existing, identical on HEAD): six assume review-first publishing, off by default since 015a35a; one predates the I-024 overload retry | Fixed (verified) |
| T-072 | Medium | No integration test covers the DEFAULT publish path (direct publish + admin notification) — both suites that submit run in review mode | Open |
| T-062 | Medium | Secret scan not in CI; misses `gsk_`, postgres URLs, `sb_secret_`; prints 24 chars of a hit [QA-09, SEC-11] | Open |
| T-063 | Medium | Env docs drift (8 documented-but-unused, 5 used-but-undocumented) [QA-06] | Open |
| T-064 | Low | Stale cluster-mode comments (pm2 now fork ×1) across app.js, rateLimit.js, scheduler.js, rbacService.js, package.json | Open |
| T-065 | Low | Dead code: `sendInvoice*` (see T-041), `money.formatCents`, `charts/BarChart.jsx`, `charts/Ring.jsx`, `landing/Proof.js`, `safeUrl.safeHref` | Open |
| T-066 | Low | Public `__shot-*` screenshots (~1.1 MB, one a third-party logo); `.claude/launch.json` tracked | Open |
| T-067 | Medium | Ops: no log rotation, no written backup/restore policy, nothing monitors `/health`; DEPLOY.md uses `npm install` not `npm ci` [QA-08, QA-13] | Needs owner |
| T-068 | Low | a11y/design-system long tail [FE-12..FE-18], SEO canonical on /events [FE-19] | Open |

---

## Evidence for the items re-checked by the lead

- **T-001** `npm audit --json`: `next` critical, `fixAvailable: next@16.4.5`, non-major.
- **T-010** `backend/services/stripeService.js:131` `expires_at: now + 30 min`
  at Pay time; the hold's `expires_at` is set once at hold time (35 min) and no
  code path updates it (grep). `pricingService.js:42` refuses a lapsed hold in
  the webhook re-quote; the sweeper (`expire_stale_reservations`, latest in
  `20260915130000`) frees it.
- **T-011** same call, `idempotencyKey: checkout_${reservationId}` with a
  `Date.now()`-derived `expires_at` — Stripe rejects a reused key whose
  parameters differ.
- **T-013** `backend/services/googleAuthService.js:40-44` sets
  `email_verified_at` and returns the user; `password_hash` untouched.
- **T-014** `new URL('/\\evil.test', 'https://eventsli.com').href` →
  `https://evil.test/` and `'/\t/evil.test'` → `https://evil.test/` (Node 26,
  WHATWG parser, run locally).
- **T-015** `backend/controllers/seatMapController.js` `tableIsPrivate` reads
  `{ data }` only; its sibling `privateTablesFor` throws on error.

---

## Phase 0–1 remediation, 2026-11-05

Nothing is committed; every change is in the working tree for review.

### After (same commands as the baseline)

| Check | Before | After |
|---|---|---|
| Backend unit | 401 / 401 | **431 / 431** (+30 new: `checkoutSessions`, `googleClaim`, `rateLimitNames`, `appHardening`) |
| Frontend unit | 747 / 747 | **753 / 753** (+6: `gateShutdown`, the T-014 case in `authRedirect`) |
| Frontend static checks / lint | pass / clean | pass / clean |
| Frontend production build (CI env, Next 16.4.5) | not run | **pass** |
| `npm audit --omit=dev` | runtime critical present | **0 vulnerabilities** |
| `npm audit` (all) | 18 | dev-only remainder (vitest/tinypool, minimatch via typescript-eslint) — T-003 |
| Secret scan | clean | clean (784 files) |
| Integration | not runnable | **still not runnable** — no local Supabase stack |

### What changed, per item

- **T-001/T-002** — `next` and `eslint-config-next` 16.3.8 → 16.4.5 (exact), then
  `npm audit fix` (non-breaking): body-parser, qs, undici, zod, vite.
  Verified: `npm audit --omit=dev` → 0; production build passes.
- **T-004** — `.github/workflows/ci.yml`: the audit is its own blocking job
  (runtime-only audit, full audit at the same `moderate` threshold, and the
  secret scan — the CI half of T-062). The unit-test job no longer starts with it.
- **T-010/T-011/T-012** — new `backend/services/checkoutSessions.js`, used by
  `checkoutController.createSession` / `fulfillFromSession`, both promo
  endpoints and `seatMapController.release`:
  - the hold is lengthened (one conditional UPDATE, race-safe against the
    sweeper) so the session always ends 5 min before the hold; hold life is
    capped at TTL + 45 min so "Pay" cannot hoard seats;
  - a matching open session is reused; a stale one is expired first;
  - the idempotency key hashes every varying parameter;
  - what the session charges is snapshotted on `attendee_data.quote`, and
    fulfilment records it when `amount_total` matches (a mismatch logs
    `PAYMENT AMOUNT MISMATCH` at error level and still issues tickets);
  - promo apply/remove and release expire an open session first and refuse
    (`CONFLICT`) once it is paid. No migration.

  Verified: `test/checkoutSessions.test.js` (16) against a fake table that
  applies the real filters. **Not verified** against Stripe test mode or a
  local stack (I-005: no test key; no Docker).
- **T-013** — `googleAuthService.findOrCreate` nulls the unproven password,
  spends live codes and revokes sessions when Google confirms an unverified
  account; `verificationStatus` no longer signs in a waiting tab for an account
  with no password. Verified: `test/googleClaim.test.js` (4). Two of these fail
  against the old file (checked by swapping it back in).
- **T-014** — `safeNext` refuses backslashes and control characters, and asks
  the URL parser whether the origin changed. Verified: new case in
  `authRedirect.test.jsx` (6 payloads, each first asserted to escape the origin
  under `new URL`).
- **T-015** — `tableIsPrivate` throws on a lookup error (fails closed);
  `release` now also checks the `release_reservation` error.
- **T-019 (part) / T-020** — `makeLimiter` requires a unique `name`; six
  limiters named; the credential limiter is keyed on `accountKey(email)`.
  Verified: `test/rateLimitNames.test.js` (6), including a source walk of every
  `makeLimiter` call, and a full `require('./app')` smoke load.
- **T-021** — email log lines mask the address and blank digit runs in the
  subject (`emailService.loggable`); a failed gate login logs `hashIp`, not the IP.
- **T-030** — `revalidateService.target()` uses the first `FRONTEND_URL` entry;
  production without `REVALIDATE_URL` logs one error; delivery failures are
  `warn` in production. `REVALIDATE_URL` is documented in `backend/.env.example`
  and `docs/DEPLOY.md`. **Owner action:** add
  `REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate` to the VPS
  `backend/.env`.
- **T-031/T-032** — body-parser 413/400 mapped; a non-numeric TTL refuses to
  boot. Verified: `test/appHardening.test.js` (real HTTP round-trips).
- **T-033** — `useScanner.shutdown()` never throws; a start that resolves after
  cleanup is stopped. Verified: `test/gateShutdown.test.js` (5), including that
  html5-qrcode's `stop` really throws synchronously.

### Found and fixed during this phase

- A shell heredoc used for scripted edits stripped backslashes from two
  regexes. One (`accountKey`) would have collapsed every Gmail address into a
  single rate-limit key. It was caught when the masking check printed an
  unmasked code. Both were replaced with code that uses no regex. A test now
  asserts that different Gmail accounts stay distinct, and the diff was
  re-scanned for other damaged regexes (none found).

### Remaining risks

1. The 25 integration suites have not run on any of this. They need
   `supabase start` (Docker) or a CI run, and must pass before merge.
2. The checkout changes have not been run against Stripe. One test-mode pass
   (pay, retry, change promo) needs a test key (I-005).
3. The **[mig]** items are untouched: T-016, T-017, T-018, the T-019 counter,
   and Phase 3. These are real double-sell and charged-without-tickets paths.
   They are next, and need the local stack to verify.
4. I-002 (unrotated live secrets) still blocks production, as before.

---

## Integration and Stripe verification, 2026-11-05/06

Owner supplied a Stripe **test** key (resolves the I-005 blocker for test
mode), installed Docker, and set `REVALIDATE_URL` on the VPS.

### Local stack

- `npx supabase@2 start` (CLI 2.122.1). This is a local stack only: the
  gitignored `backend/.env` points at `127.0.0.1:54321` and holds freshly
  generated session secrets.
- The first start failed at migration `20260905090000`: `relation
  "storage.buckets" does not exist` (**T-069**). Both storage-bucket guards now
  test `to_regclass('storage.buckets') IS NOT NULL` instead of the schema. On
  any database where the table exists the statement is unchanged, and an
  applied migration never re-runs, so production is unaffected. This is the
  one case where editing an applied migration is justified: a forward
  migration cannot repair an earlier one that errors on a fresh database.
- After the fix: **51/51 migrations apply to an empty database**; seed present
  (current terms versions, 24 categories).

### Integration suites

| Run | Result |
|---|---|
| Working tree, first run | 304 / 311 — 7 failures |
| Clean `HEAD` (separate worktree, same stack), the 3 affected files | 42 / 49 — the **same 7**, failure sets diffed identical → pre-existing |
| Working tree after T-071 test fixes | **311 / 311, 0 skipped** |

What the 7 were (**T-071**):

- Six review-loop tests assumed review-first publishing. Commit 015a35a made
  direct publishing the default. The tests now switch review on through
  `test/helpers/reviewMode.js`. They do not restore it afterwards, on
  purpose; the header explains the concurrency reason.
- `aiCreator` expected 2 provider attempts. The I-024 overload retry makes it
  4 when both providers return 503. This is the documented behaviour, so the
  assertion now expects 4 and explains why.

An interruption along the way: Docker Desktop stopped mid-session, probably
because the machine slept. The `HEAD` runs made during that window had no
database, so they were thrown away and repeated after restarting the stack.

### Stripe test mode (plain Checkout Sessions, no Connect; every one expired afterwards)

| Check | Result |
|---|---|
| Same idempotency key, `expires_at` one second later — the OLD code's retry | **refused, `StripeIdempotencyError`** — T-011 confirmed against the real API |
| Same key, identical parameters — the fix's retry | **same session returned** |
| Expire → retrieve | `status: "expired"`; expiring again throws (the path `closeOpenSession` handles) |
| `amount_total` / `currency` read back | as sent (the fields the reuse check compares) |
| A 29-minute `expires_at` | accepted. Stripe's floor is lower than the 30 min the hold extension assumes, so the extension is conservative, not wrong |
| A session with no product `tax_code` | **refused: Managed Payments is enabled by default on this account** → **T-070** |

### T-070 — Managed Payments (needs the owner)

Stripe's error: product tax code is required for Managed Payments, "which is
enabled by default on your account". The probe passed every check once it
sent `managed_payments: { enabled: false }`. Eventsli computes and remits its
own event tax (README, Money model), so Stripe acting as merchant of record
does not fit this platform. The fix is a single parameter in
`createCheckoutSession`, but it changes how live money is processed, so it is
**not applied** without the owner's decision. Two questions for the owner:

1. Is Managed Payments also on for the **live** account? If so, no live card
   checkout can be completing today. Check the dashboard at Settings →
   Managed payments.
2. Should the platform turn it off account-wide (dashboard), or should the
   code send `managed_payments: { enabled: false }` on every session? Either
   works; doing both is safest.

### Still not verified

- **A full card payment through the app** (hold → Pay → test card → webhook →
  tickets). `organizerCanReceive` requires a test-mode Connect account with
  charges and payouts enabled. Creating one means Stripe's onboarding, with
  identity fields, which the owner completes. Easiest route: sign in locally
  as an organizer → Payments → Connect, and use Stripe's test-mode onboarding.
- **Webhook delivery locally** needs `stripe listen --forward-to
  localhost:5000/api/v1/payments/webhook` (Stripe CLI) and its `whsec_`
  secret in `backend/.env`.

Correction (same session): the T-069 migration edit broke one unit test, `eventMedia.test.js`, which pinned the old guard's wording. I had not rerun the unit suite after editing the migration; the final run caught it. The test now asserts the table guard and the absence of the schema guard. Final state: backend unit **431/431**, integration **311/311**, secret scan clean.

---

## T-070 Managed Payments — owner-approved change, 2026-11-06

Owner instruction: disable Managed Payments on every Checkout Session, provided
it is compatible with Connect and the event-tax flow. Test mode only, no Live
changes, no real payments, nothing committed, and **payment readiness is not
complete until the full flow passes.**

### 1. Parameter and API version

| Question | Evidence | Result |
|---|---|---|
| Exact parameter | Stripe docs, Managed Payments set-up page: "set managed_payments[enabled] to `false`" | `managed_payments: { enabled: false }` on `checkout.sessions.create` |
| Our API version | `stripe-node` 19.3.0 pins `2025-10-29.clover`; the SDK's `request` event confirmed that version on the wire | — |
| Accepted under it? | The changelog adds the field in 2026-02-25.preview / 2026-04-22.dahlia, which is **newer** than our pinned version. Checked empirically instead: a test-mode session created with the SDK's pinned version accepted the field and echoed `managed_payments: {"enabled":false}` | **Supported**; no SDK or version change needed. The SDK's TypeScript types lack the field, which does not matter in this JavaScript codebase |

### 2. Compatibility (Connect, payouts, fees, refunds, reconciliation)

From Stripe's documentation:

- Managed Payments "supports direct integrations only". It excludes "Connect
  platforms" and "Express accounts".
- It lists `payment_intent_data.transfer_data` and `application_fee_amount`
  (both used by this checkout) as unsupported: "Managed Payments doesn't
  support Connect integrations."
- It lists "Live in-person events" as an ineligible product.

So Managed Payments can never apply to Eventsli's sessions. Disabling it
leaves an ordinary Checkout Session where Eventsli is the merchant: the
architecture the code, the README money model and the event-tax arithmetic
already assume.

Everything else in the session is unchanged, and
`test/stripeSessionParams.test.js` pins it: same destination transfer,
application fee, transfer group, amount and currency, and the caller-supplied
expiry and idempotency key.

Refunds are already manual (I-007). When they are automated, a destination
charge's refund must use `reverse_transfer: true` and
`refund_application_fee: true`, or the organizer keeps the transfer and the
platform absorbs the refund. Stripe debits disputes from the **platform** for
destination charges.

**Not yet proven on a real charge:** that the transfer reaches the connected
account and the application fee is collected. `e2e.js fulfil` checks both and
cannot run yet (T-073).

### 3. Implementation (test mode only)

- `backend/services/stripeService.js`: `managed_payments: { enabled: false }`
  on every session, with the reasoning in a comment.
- `backend/test/stripeSessionParams.test.js` (4): captures the exact request
  through a stubbed SDK.
- Backend unit tests: **436 / 436**.

### 4. Full end-to-end flow — BLOCKED, not run

A scripted run is ready at
`C:\Users\youse\AppData\Local\Temp\claude\46c9e092d02dbb11\04cd1495-5e21-4be3-824b-8b7b5f7df670\scratchpad\e2e.js`.
It runs against the local database and refuses to run unless the key is
`sk_test_` and the database is `127.0.0.1`. It has three phases:

- **seed:** creates a local organizer and event, then a test-mode Express
  account through the app's own `ensureConnectedAccount`, and prints its
  onboarding link.
- **checkout:** holds seats over HTTP, presses "Pay" twice, and checks the real
  session for:
  - Managed Payments off;
  - expiry inside the hold;
  - the snapshot.
- **fulfil:** takes the real `checkout.session.completed` event from Stripe,
  signs it with a local secret, posts it to the webhook, redelivers it, and
  checks:
  - order, tickets and seats;
  - the total against what was charged;
  - the success page;
  - the Connect transfer destination, the application fee and the transfer group;
  - the ledger.

It stopped at **seed**: Stripe refused to create the connected account (**T-073**):

> You tried to create an Accounts v1 connected account using the legacy `type`
> field with your platform as the losses collector. Use Accounts v2, …

What the docs say about it (connected-accounts-with-managed-risk,
managed-risk, migrate-to-controller-properties):

- Stripe-managed risk ("losses collector = stripe") works with **direct**
  charges. Destination charges need `on_behalf_of`, which is in **private
  preview**. Express-dashboard plus Stripe-managed losses is a **public
  preview**.
- Eventsli's destination-charges-on-Express model is the configuration where
  the **platform** carries connected-account losses. That is v1's default
  Express mapping, `controller.losses.payments = application`.
- The documented place to confirm that is the Connect **platform profile**:
  `dashboard.stripe.com/settings/connect/platform-profile`.

Recommended owner action, **test mode first**: complete the platform profile,
accepting platform responsibility for connected-account losses. Then:

1. `node e2e.js <backend> seed`
2. Complete the printed onboarding link with Stripe's test data.
3. `node e2e.js <backend> checkout`
4. Pay the printed URL with card 4242 4242 4242 4242.
5. `node e2e.js <backend> fulfil`

The alternative, Stripe-managed losses, is not a setting. It means moving to
direct charges, or to an `on_behalf_of` preview: a payment-architecture change
that needs its own decision.

Translator fix: `stripeErrors.translateConnectError` matched "Accounts v1" in
this message and told operators to enable "Accounts v1 support", which does
not fix it. It now recognises the losses-collector refusal first and points at
the platform profile. Verified: `test/stripeConnect.test.js`, new regression
case (6/6).

### Payment readiness: **NOT COMPLETE**

Open before card payments can be called ready:

1. **T-073:** platform profile (owner, Dashboard; test mode, then live).
2. **The full flow above** must pass: checkout, real webhook processing,
   ticket issuance, Connect transfer and application fee.
3. **Real Stripe-delivered webhooks.** `e2e.js` signs Stripe's real event with
   a local secret. Delivery from Stripe's servers (registered endpoint, or
   `stripe listen` from the Stripe CLI) is still unproven, and so is the live
   endpoint's `whsec_` (troubleshooting row "Paid orders never fulfilled").
4. **Live account settings.** Managed Payments and the platform profile must
   be checked in **live** mode by the owner. Whether test and live share these
   settings is not documented.
5. **I-002:** unrotated live secrets still block production.

The local database still has one partial seed (a test organizer and event,
`e2e-organizer-*@eventsli-test.invalid`) from the refused run. It is local
only and harmless; `supabase db reset` clears it.

---

## T-074 — Payment architecture aligned with the business model (2026-11-06)

**Owner's requirement.** Eventsli is event-management software. Each organizer
is the independent merchant of record. Payments belong to the organizer's
Stripe account. Organizers pay their own processing fees and own their refunds,
disputes and chargebacks. Eventsli is never liable for an organizer's negative
balance (Stripe carries it where supported). Eventsli earns its platform fee
through Connect and never holds, pools or distributes ticket revenue.

**Status: implemented and verified locally (units, integration). End-to-end
in Stripe test mode is PENDING the owner's test onboarding of the two
organizer accounts.** Payment readiness is **not** complete.

### Recommended architecture

| Layer | Choice | Why it fits |
|---|---|---|
| Charge type | **Direct charges.** The Checkout Session is created *on the organizer's account* (`Stripe-Account` header). | Stripe: a direct charge is one where the connected account "is always the merchant of record". The money lands in the organizer's balance, never the platform's. |
| Platform revenue | `payment_intent_data.application_fee_amount` = commission + tax on the commission | Eventsli's only money. Stripe: "no additional Stripe fees on the application fee itself". |
| Connected accounts | **Accounts v2**: `dashboard: full`, `defaults.responsibilities.fees_collector: stripe`, `losses_collector: stripe`, merchant `card_payments`, Stripe-hosted onboarding | The organizer has their own full Stripe account and Dashboard (they refund and answer disputes there). Stripe bills its fees to them, and **Stripe is the losses collector**. |
| API version | v2 account creation under **`2026-10-28.endive` (GA)**. Everything else on the SDK's pinned `2025-10-29.clover`. | Measured on this platform: v1 creation is refused ("Stripe no longer recommends Accounts v1…"), and v2 under clover is preview-only. |
| Liability gate | `connectModel.checkAccount`, run on every checkout: requires `losses.payments=stripe`, `fees.payer=account`, `stripe_dashboard=full`, plus charges and payouts enabled | No checkout can ever run on an account that would make Eventsli liable, such as a legacy Express account. |
| Webhooks | A Connect endpoint (checkout, refunds, disputes, all carrying `event.account`) and a platform endpoint (`application_fee.refunded`). Each paid session must be the one Eventsli created for that hold, on that account. | Organizer isolation (see below). |

**Rejected alternatives.**

- **Destination charges** (the old code): the charge sits on the platform,
  the platform pays Stripe and every dispute, and it carries
  connected-account losses. That contradicts every requirement.
- **Destination charges with `on_behalf_of`:** in private preview for
  Stripe-managed risk.
- **v1 Express + Stripe-managed losses:** public preview.
- **v1 `type: standard`:** refused on this platform.
- **Managed Payments:** Stripe as merchant of record; "direct integrations
  only", and live events are ineligible.

### What Stripe applied on this Canadian platform (test mode, read back from the API)

| Account | dashboard | fees_collector | losses_collector | v1 view `controller` |
|---|---|---|---|---|
| CA organizer (`acct_1UYe…7j1A`) | full | stripe | stripe | `fees.payer=account`, `losses.payments=stripe`, `stripe_dashboard=full` |
| US organizer (`acct_1UYe…2qpd`) | full | stripe | stripe | same |

So a Canadian platform can create US and Canadian organizer accounts in this
configuration. Both await onboarding (19 and 20 requirements due).

### Conflicts found in the old implementation

1. **Destination charges** (`transfer_data.destination`): the platform was
   the settlement merchant, paid Stripe's fee, and was debited for every
   dispute.
2. **Fee model:** `application_fee_amount` included a "payment fee" to
   recover the platform's Stripe cost, and money.js judged margin by that
   cost. Under the new model the platform has no Stripe cost.
3. **Express accounts created with the platform as losses collector**: the v1
   `type: express` default.
4. **Ledger:** a `transfer` row paid the organizer their net. Ticket money was
   modelled as passing through Eventsli.
5. **Webhook trusted `metadata.reservation_id` alone.** Harmless while every
   session came from the platform. **Exploitable under direct charges:** any
   connected organizer can create a session with any metadata, and could have
   fulfilled, or released, a stranger's hold.
6. Refunds and disputes were only logged. Refunded and charged-back tickets
   still admitted their holder (BE-19).
7. Sessions were retrieved and expired on the platform account. Direct-charge
   sessions live on the organizer's.

### Code and database changes (uncommitted)

**Migration** `supabase/migrations/20261106090000_direct_charges_merchant_of_record.sql`:

- New `orders` columns: `charge_model`, `stripe_account_id`,
  `stripe_charge_id`, `refunded_cents`, `application_fee_refunded_cents`,
  `dispute_status`, `disputed_cents`. Each has a CHECK; one requires that a
  direct order has an account.
- `fulfill_checkout`: refuses a direct charge whose account is not the event
  organizer's own. Writes no `transfer` or `payment_fee` row for direct
  charges. The legacy path is unchanged.
- New: `record_stripe_refund`, `record_application_fee_refund`,
  `record_stripe_dispute`. They are idempotent, cumulative and
  account-checked. A full refund or a lost dispute voids unused tickets.
- An index for the success-page session lookup.

**Backend**

- `services/connectModel.js` (new, pure): the v2 account body and the
  liability gate.
- `services/stripeService.js`:
  - v2 account creation; a legacy account is replaced and logged;
  - direct-charge Checkout (`stripeAccount`, no `transfer_data`);
  - account-scoped retrieve, expire and charge reads;
  - two webhook secrets;
  - `refreshAccountStatus.needsReconnect`.
- `utils/money.js`:
  - `CHARGE_MODEL.DIRECT` and `describeDirectOrder`: application fee =
    commission + its tax; the organizer pays the Stripe fee; a buyer-paid
    service fee stays with the organizer;
  - the destination path is kept for its historical orders and for
    non-card callers.
- `services/pricingService.js` and `submissionService.js`: card quotes and
  the organizer preview use `DIRECT`.
- `services/checkoutSessions.js` and `openCheckouts.js`: the session's
  account is recorded and used.
- `controllers/checkoutController.js`:
  - a paid session must be the one recorded for its hold, on the recorded
    account;
  - the success page finds the account from Eventsli's own record, never the
    URL.
- `controllers/paymentController.js`:
  - the expiry release is checked against the recorded session;
  - refunds, fee refunds and all dispute events are recorded.
- `app.js`: `STRIPE_CONNECT_WEBHOOK_SECRET` is required when card payments
  are on.

**Frontend:** `MoneyLines.jsx` now says the money goes to the organizer's own
Stripe account, the Stripe fee is theirs, and Eventsli takes only its fee.

**Docs:** `DEPLOY.md` covers the two webhook endpoints, the event lists and
the required Stripe settings. `.env.example` adds
`STRIPE_CONNECT_WEBHOOK_SECRET`.

### Test results so far

| Suite | Result |
|---|---|
| Backend unit | **445 / 445**. New: `directCharges.test.js` (9: liability gate, legacy refusal, v2 body, direct fee arithmetic). `stripeSessionParams` now pins a direct charge: `stripeAccount` set; no `transfer_data`, `on_behalf_of` or `transfer_group`. |
| Integration (local Supabase, migration applied) | **318 / 318**. New in `stripeWebhook.test.js`: forged-session refusal, wrong-account refusal, database-level account refusal, a stranger's expiry ignored, partial refund, full refund voiding tickets, cross-account refund ignored, dispute withdrawn/lost (each recorded once). `fulfillment.test.js` now reconciles the ledger against `orders`. |
| Frontend unit / lint | 753 / 753 · clean |
| **Test-mode E2E, US and CA** | **PENDING.** The script is ready: `C:\Users\youse\AppData\Local\Temp\claude\46c9e092d02dbb11\04cd1495-5e21-4be3-824b-8b7b5f7df670\scratchpad\e2e2.js` (`status` → `links` → `checkout` → pay → `verify`). It checks all ten required outcomes against Stripe's own objects: the charge, the organizer's balance transaction (`stripe_fee`, `net`), the `ApplicationFee`, refunds on the organizer's balance, a dispute via card `4000 0000 0000 0259`, the platform balance not funding the refund, and per-order ledger reconciliation. |

### Remaining financial, legal and operational liabilities (not eliminated)

- **The platform is always liable for its own negative balance.** Stripe:
  "Your platform is always responsible for its own negative balances." An
  application fee refunded after Eventsli has paid it out could make the
  platform balance negative.
- **Stripe's liability for connected-account losses rests on its contract**
  (Stripe Services Agreement, Connect Platform Agreement, the CA and US
  Connected Account Agreements), not on this code. The code proves only the
  technical configuration. **Counsel should confirm the contractual
  allocation.** No agreement was reviewed in full.
- **Dispute and application fee:** Stripe's docs do not say whether the
  application fee is returned when a dispute is lost. Do not assume it is.
  E2E will show what Stripe does in test mode.
- **Refund policy (owner decision):** Stripe keeps Eventsli's fee on refunds
  unless `refund_application_fee` is set. Organizers refunding from their own
  Dashboard cannot set it. The code records whatever Stripe reports, in
  either direction.
- **Cross-border fee currency:** undocumented for a US organizer's USD
  charge. E2E prints the actual currency.
- **Tax:** the organizer is now the seller, so collecting and remitting event
  tax is theirs; the product and terms must say so. Eventsli still collects
  and remits tax on its own commission, which is a registration obligation.
- **Legal copy:** the terms, privacy policy and buyer receipts must name the
  organizer as the seller. Not changed here; it needs counsel.
- **Legacy organizers:** any organizer on an old Express account cannot sell
  by card until they reconnect. The gate refuses, and Connect creates a new
  account. The frontend does not yet show a "reconnect" prompt
  (`needsReconnect` is in the API response).
- **Real webhook delivery** has not been tested yet. E2E replays Stripe's
  real events, re-signed locally. Live needs both endpoints registered, or
  `stripe listen --forward-connect-to`.
- **Production:** the migration is unapplied, and live Stripe settings are
  unchanged and unchecked (Managed Payments default, Connect settings).
  I-002, unrotated keys, still blocks production.

### Dashboard actions for the owner

1. **Test mode now:** complete Stripe-hosted onboarding for the CA and US
   test organizers. Run `node e2e2.js <backend> links` for fresh links. Use
   Stripe's test values: SMS code `000-000`, DOB `1901-01-01`, address
   `address_full_match`, ID `000000000`, US bank `110000000`/`000123456789`,
   or "Use test account".
2. **Do not** accept platform responsibility for losses in Connect → platform
   profile (the earlier T-073 recommendation is withdrawn; this architecture
   does not need it).
3. **Before live:**
   - repeat the checks in live mode;
   - register both webhook endpoints;
   - set `STRIPE_CONNECT_WEBHOOK_SECRET`;
   - turn the Managed Payments default off;
   - apply the migration;
   - have counsel review the agreements and the seller wording.

---

## T-074 end-to-end in Stripe test mode — Canadian organizer (2026-11-06)

**Method (owner-approved Option 3).** Everything below is real Stripe test-mode
data, real app code over HTTP, the local database, and Stripe's own events.

- **One harness-only exception:** the end-to-end script waives
  `payouts_enabled` inside its own process. Stripe's test-mode onboarding
  cannot clear `proof_of_liveness` (no documented test value; Stripe Identity's
  testing page returns 404).
- **Still enforced:** every liability condition (`losses=stripe`,
  `fees=account`, `dashboard=full`) and `charges_enabled`. **No production
  file was changed for this.**

Scripts:

- `C:\Users\youse\AppData\Local\Temp\claude\46c9e092d02dbb11\04cd1495-5e21-4be3-824b-8b7b5f7df670\scratchpad\e2e2.js` (checkout + verify)
- `C:\Users\youse\AppData\Local\Temp\claude\46c9e092d02dbb11\04cd1495-5e21-4be3-824b-8b7b5f7df670\scratchpad\e2eDispute.js` (dispute ledger)

**Result: 13/13 checkout + 41/41 verify + 5/5 dispute = 59/59 passed** on the
CA organizer (`acct_1UYe…xbN9`, CAD). The owner paid both sessions with
`4242 4242 4242 4242` and `4000 0000 0000 0259`.

### Money, as Stripe recorded it

| | Organizer's Stripe balance | Eventsli platform balance |
|---|---|---|
| Sale 1, CA$116.68 (2 seats) | 11668 − Stripe fee 462 − Eventsli fee 170 = **net 11036** | +170 |
| Sale 2, CA$58.50 (1 seat) | 5850 − 246 − 85 = **net 5519** | +85 |
| Partial refund CA$10.00, created on the organizer's account | **−1000** | unchanged (255 → 255) |
| Dispute (card 0259) | **−5850 and −1500 dispute fee** (net −7350) | unchanged; the application fee was **not** returned (85, refunded 0) |
| **Total** | 11036 + 5519 − 1000 − 7350 = **8205 (positive)** | **255 = exactly the two application fees** |

### The ten required outcomes

| # | Outcome | Result | Evidence |
|---|---|---|---|
| 1 | US organizer connects | **NOT VERIFIED.** The account exists with the correct configuration, but Stripe asked again for `individual.id_number` and `card_payments` is inactive | `accounts.retrieve`: losses=stripe, fees=account |
| 2 | CA organizer connects | **Verified** (charges active; payouts blocked only by test-mode liveness) | `card_payments: active`, controller as required |
| 3 | Organizer accepts payments independently | **Verified** | The sessions live on the organizer's account; the charge has no `transfer`/`destination`; the checkout is in the organizer's branding |
| 4 | Eventsli collects its fee | **Verified** | `ApplicationFee` 170 and 85 CAD = commission + its tax, from this organizer's account. The platform balance holds exactly 255. |
| 5 | Organizer receives eligible proceeds | **Verified to their balance.** Bank payout is not verified. | Balance transaction `net` = amount − `stripe_fee` − `application_fee` |
| 6 | Refunds charged to the organizer | **Verified** | Refund balance transaction −1000 on the organizer's account; platform balance unchanged; fee not refunded (Stripe default) |
| 7 | Disputes follow the liability configuration | **Verified for the debit.** Win/lose not tested. | Disputed amount and the 15.00 dispute fee are debited from the **organizer**; the platform balance is unchanged |
| 8 | Eventsli not responsible for organizer losses | **Configuration verified.** Stripe absorbing an unrecoverable balance cannot be demonstrated in test mode; that rests on Stripe's agreements. | `controller.losses.payments = stripe` on both accounts |
| 9 | Webhooks process all relevant events | **Verified with Stripe's real events, re-signed locally** | Real `checkout.session.completed` (with `event.account`), `charge.refunded`, `charge.dispute.created` and `charge.dispute.funds_withdrawn`: fulfilment, redelivery no-op, wrong secret refused, refund and dispute recorded once |
| 10 | Ledger reconciles | **Verified per order** | Sale = Stripe amount; commission + its tax = application fee; refund rows = Stripe refunds; dispute adjustment = disputed amount; no `transfer`/`payment_fee` rows |

### Questions the run settled

- **A direct charge works while payouts are disabled.** Charges enabled is
  enough to take payment.
- **On a dispute, Stripe does not return Eventsli's application fee**, at
  least while the dispute is open (`needs_response`). The organizer bears the
  disputed amount and the dispute fee.
- **The application fee is paid in the charge's currency (CAD)** for a CA
  organizer on a CA platform. The cross-border **US→CA fee currency is still
  unverified.**

### Still open

1. **US organizer:** Stripe's test-mode verification has not activated
   `card_payments`. US coverage is integration-tested (318/318) but not
   end-to-end.
2. **Bank payouts:** blocked by test-mode liveness on both accounts.
3. **Real webhook delivery** (Stripe's servers → our endpoint): the events
   were Stripe's own but re-signed locally. This needs `stripe listen
   --forward-connect-to …` (CLI download, owner OK) or a deployed test
   endpoint.
4. **Dispute won/lost** and `funds_reinstated`: not exercised.
5. **Contract terms** for Stripe's loss liability: counsel.
6. **Payment readiness is NOT complete:** items 1–4 and the production steps
   in the T-074 section remain.

---

## T-074 — real webhook delivery from Stripe (2026-11-06)

**Setup.**

- Stripe CLI **1.55.8**, installed with winget from Stripe, Inc.'s official
  GitHub release (owner-approved). Stripe does not Authenticode-sign the
  Windows binary. The download's SHA-256 (`d0650b49…0efed`) matches the digest
  GitHub publishes for `stripe_1.55.8_windows_x86_64.zip`.
- `stripe listen --events <the 10 Eventsli handles> --forward-to … --forward-connect-to …`
  forwarded to the real app running in a harness on `:5055`. The key came
  from `backend/.env` through the environment, never on the command line or
  in any output. Stripe's event API version: `2026-08-26.dahlia`.
- The harness waived `payouts_enabled` only, as before.

**Every event below was delivered by Stripe**, not replayed. No success page
ran, so an order can only have come from a delivered webhook.

| Flow | Delivered events | Result |
|---|---|---|
| 2 paid checkouts (owner paid; 4242 and 0259) | `checkout.session.completed` ×2 | **9/9.** Orders created by delivery. Organizer pays Stripe 462/246; Eventsli takes 170/85; no transfer. |
| Dispute **won** (organizer submitted Stripe's test `winning_evidence`) | `charge.dispute.updated`, `charge.dispute.funds_reinstated`, `charge.dispute.closed` | **4/4.** Status `won`. Ledger has withdrawal and reinstatement, each once. Tickets stay valid. |
| Partial refund CA$20 with `refund_application_fee: true` | `charge.refunded` (Connect), `application_fee.refunded` (**platform**) | **6/6.** Stripe returned 29 of the 170 fee (proportional). Ledger: refund debit 2000 + commission credit 29. **Platform balance 510 → 481: it fell by the fee given back, never by the refund.** |
| Early dispute (see T-075) | `charge.dispute.created`, `funds_withdrawn`, resent with `stripe events resend` | Recorded on redelivery. Withdrawal written once. |

## T-075 — Stripe delivers events out of order; an early dispute was lost (High, Fixed)

**Found by real delivery.** For the 0259 payment, Stripe sent
`charge.dispute.created` and `charge.dispute.funds_withdrawn` at 07:33:16 and
that payment's `checkout.session.completed` at 07:33:17. The dispute events
found no order, were answered `200 ORDER_NOT_FOUND` (so Stripe would not
retry), and the chargeback never reached the ledger. Replayed tests could
never have shown this.

**Fix.** `paymentController.withOrder`: when a refund or dispute finds no
order, the webhook:

1. looks up the PaymentIntent's Checkout Session on the organizer's account
   (`stripeService.sessionForPaymentIntent`);
2. fulfils it through `fulfillFromSession`, with the same binding checks
   (our recorded session, this account);
3. records the event.

A charge Eventsli did not create still finds no session and is ignored. A
transient failure throws, so Stripe retries the delivery.

**Verified.**

- Integration: "a dispute that arrives BEFORE its payment's checkout event is
  not lost" and "an early dispute for a charge Eventsli never created is
  still ignored".
- Live: the two dropped events, resent through Stripe, were recorded.

### Totals after this step

| Suite | Result |
|---|---|
| Backend unit | 445 / 445 |
| Integration | **320 / 320** |
| Live Stripe test mode, CA organizer | replayed run 59/59; real-delivery run 19/19 |
| Secret scan | clean |

### Still not verified

- **US organizer end-to-end:** Stripe still has not activated
  `card_payments`.
- **Bank payouts:** test-mode `proof_of_liveness`.
- **Production setup:** migration; both webhook endpoints;
  `STRIPE_CONNECT_WEBHOOK_SECRET`; live Stripe settings; counsel review of
  the agreements and the seller wording; I-002.

**Payment readiness: NOT complete.**

---

## T-074 — FULL test-mode verification, CA and US organizers, no waiver (2026-11-06)

**Onboarding resolved.**

- **US:** the read-only investigation showed Stripe asking for the full SSN
  (v2 `identity.individual.id_numbers.us_ssn`, no error code). The owner
  entered the documented 9-digit test value through a Stripe-hosted link
  scoped to `collection_options[fields]=currently_due`.
- **CA:** the owner completed `proof_of_liveness` through the same kind of
  scoped link.

Both accounts then read `card_payments: active`, `charges_enabled: true`,
`payouts_enabled: true`, with nothing due and no errors. **The harness payout
waiver was no longer used: the production gate ran unmodified.**

All flows ran through **real Stripe webhook delivery** (`stripe listen` → app
on `:5055`). No events were replayed and no success page ran.

| Check | CA (CAD) | US (USD) |
|---|---|---|
| Account accepted by the production gate (losses=stripe, fees=account, full dashboard, charges + payouts) | PASS | PASS |
| Checkout sessions are direct charges on the organizer's account, Managed Payments off | PASS (26/26 across both) | PASS |
| Orders created by delivered `checkout.session.completed` | PASS | PASS |
| Organizer pays Stripe's fee | 462 / 246 | 353 / 192 |
| Eventsli's application fee = commission (+ tax where set) | 170 / 85 | 150 / 75 |
| Fee as received by the CA platform | 170 CAD | **211 CAD for a 150 USD fee** (Stripe FX, rate 1.40445) |
| Partial refund 1500 with `refund_application_fee` → delivered `charge.refunded` + `application_fee.refunded` recorded | PASS (fee back 22 of 170) | PASS (fee back 20 of 150 = 28 CAD) |
| Platform balance moves only by the fee share, never by the refund | PASS (1046 → 1024 CAD) | PASS (1024 → 996 CAD = 20 USD × 1.40; the first run's FAIL was a script bug that compared CAD with USD) |
| Dispute (0259): amount + fee debited from the organizer; delivered events recorded (CA events arrived in the same second as the payment; T-075 handled it) | PASS | PASS |
| Ledger reconciles per order (sale, fee, refund, fee refund, dispute adjustment; no transfer) | PASS | PASS |
| **Test payout from the organizer's balance to their bank** | **PASS: 40.64 CAD, `paid`**, after a top-up sale restored the balance from −124.92 (earlier test disputes and refunds) | **PASS: 20.78 USD, `paid`** |
| `payout.created` / `payout.paid` delivered | PASS | PASS |

**Observed behaviour worth keeping:** the CA organizer's balance went
negative from its own disputes and refunds. Stripe held payouts until that
organizer's own later sales covered the gap. The platform balance was never
debited. This matches the required model.

### The ten required outcomes: test-mode status

| # | Outcome | Status |
|---|---|---|
| 1 | US organizer connects | **Verified** |
| 2 | CA organizer connects | **Verified** |
| 3 | Each accepts payments independently | **Verified** (direct charges on their own accounts) |
| 4 | Eventsli collects its fee | **Verified** (incl. USD → CAD conversion for US organizers) |
| 5 | Organizer receives proceeds | **Verified** (balance net + real test payouts reached `paid`, both countries) |
| 6 | Refunds charged to the organizer | **Verified** (the platform returns only its fee share, and only when asked) |
| 7 | Disputes follow the liability configuration | **Verified** (debited from the organizer; won and withdrawn paths tested) |
| 8 | Eventsli not responsible for organizer losses | **Configuration verified, and observed:** a negative organizer balance did not touch the platform. That Stripe absorbs an *unrecoverable* balance rests on Stripe's agreements (counsel). |
| 9 | Webhooks process all relevant events | **Verified with real delivery**, including out-of-order delivery (T-075) |
| 10 | Ledger reconciles | **Verified** per order, both countries |

**Test-mode payment verification: COMPLETE.**

**Production readiness: NOT complete.** Remaining before live:

1. Apply migration `20261106090000` to production.
2. Register both live webhook endpoints (Connect + platform) and set
   `STRIPE_CONNECT_WEBHOOK_SECRET`.
3. Check the live Stripe settings: Managed Payments default off; do NOT
   accept platform loss liability; Accounts v2.
4. Have counsel review the Stripe agreements (loss allocation) and the
   terms, privacy and receipt wording naming the organizer as seller.
5. Owner policy decision: whether organizers' Dashboard refunds should also
   refund Eventsli's fee (Stripe's default is that they do not).
6. Frontend "reconnect your Stripe account" prompt for legacy accounts
   (`needsReconnect`).
7. I-002: rotate the exposed live keys.
8. Commit the work (nothing is committed).

---

## Production-safety review of the rollout (2026-11-06)

Scope: the nine pending migrations, `apply-migration.js`, `verify-schema.js`,
the runbook, backward compatibility, and Stripe coverage. **Nothing touched
production.**

The rehearsal ran on a local database rebuilt to production's expected state
(43 migrations; the nine held back). It was populated by the **current
production code** (`main` @ `48f8eef`, run from a worktree): 14 orders, 58
ledger rows. Then the nine were applied with the real `apply-migration.js`,
through a local stand-in for `scripts/db.js`.

### Found and fixed

| ID | Sev | Finding | Fix | Evidence |
|---|---|---|---|---|
| T-076 | **Critical** | **Deploy window.** A checkout opened by the previous release (destination charge on the platform; session id recorded, no account, no snapshot) and paid after the deploy was re-quoted as DIRECT, so `fulfill_checkout` refused it for having no account. The buyer would be charged with no tickets. | `fulfillFromSession`: a session with no recorded account is quoted and recorded as DESTINATION (`quoteReservation(id, { chargeModel })`). Runbook: the platform endpoint also receives `checkout.session.completed` and `checkout.session.expired`. | Integration "a checkout opened by the PREVIOUS release, paid after the deploy, still issues tickets" (charge_model `destination`, transfer row present). |
| T-077a | **Critical** | **NULL in the migration.** `v_direct BOOLEAN := (breakdown->>'chargeModel') = 'direct'` is NULL when the key is absent, which is every call from the current production code. `IF NOT v_direct` then skipped the `payment_fee` and `transfer` ledger rows: migration-before-code would have silently dropped legacy ledger rows. | `COALESCE(…, false)` (migration not yet applied anywhere but local). | The T-076 test failed on exactly this, then passed. In the rehearsal, all 22 current-code card orders have their transfer row. |
| T-077b | High | `verify-schema.js` checked names only and none of the nine's objects, so it could not confirm the rollout (DB-04). | It now checks the new functions, columns and constraints, plus a **definitions** section: 24 categories, the media and sponsor URL CHECK expressions (I-004), the launch_kit feature list, the direct-charge `fulfill_checkout` body, and the session index. | Rehearsal: `Schema verified.` |
| T-077c | Medium | `apply-migration.js` could queue an `ALTER TABLE` behind a long transaction (a site-wide stall), had no protection against files that break its transaction, and nothing stopped re-running the two old migrations that change live data on a re-run. | `SET LOCAL lock_timeout '5s'`, `statement_timeout '120s'`. Refuses own BEGIN/COMMIT, `INDEX CONCURRENTLY` and VACUUM, with comments ignored. **Refuses** `20260915090000_email_verification` (it would verify every unverified account) and `20260829120000_payment_fee_mode` (it would reset admin settings) unless `--first-time`. | `test/applyMigrationGuards.test.js` (4). The guard passes all 52 real migrations. |
| T-077d | Low | `schema_migrations`, created by `apply-migration.js`, had no RLS and no revoke, so it was readable with the anon key. `verify-schema.js` flagged it. | The script enables RLS and revokes access from PUBLIC, anon and authenticated on every run, which also fixes an existing table. | Rehearsal: the leak gone, `Schema verified.` |
| T-077e | Low | `application_fee.refunded` arriving before its payment's checkout event was dropped (same class as T-075). | Wrapped in the fulfil-first path, using the fee's account. | Integration "an EARLY fee refund … is not lost either". |

### Corrections to earlier advice

The re-run warnings given earlier for `20260917091000_organizer_experience`
("turns off payments on every event") and `20260919120000_account_types`
("overwrites every account's type") were **overstated**. Read in full:

- The first only affects display-only listings.
- The second only adds the organizer type to profiles that own an organizer.

Both are convergent on a re-run. The two genuinely unsafe ones are in T-077c.

### Rehearsal results

| Step | Result |
|---|---|
| Nine applied in order by `apply-migration.js` onto data written by the current code | 9/9 `applied` |
| Re-run, recorded | 9/9 `already recorded` |
| Re-run as raw SQL, unrecorded (SQL-editor case), one transaction each, ON_ERROR_STOP | 9/9 no error; data unchanged (24 categories, 14 orders, 58 ledger rows, constraints present once) |
| `verify-schema.js` | `Schema verified.` |
| **Current production code's** integration suite, before → after the nine | 285/311 → **304/311**. The 7 remaining failures are exactly the known stale tests (T-071). **New failures: 0.** |
| New code: backend unit / integration / frontend / build / audit / secret scan | **449/449 / 322/322 / 755/755 / pass / 0 vulns / clean** |

### Stripe coverage

| Requirement | Covered by |
|---|---|
| Direct charge on the organizer's account; no transfer; Managed Payments off | `stripeService.createCheckoutSession`; unit `stripeSessionParams`; live CA+US |
| Organizer pays Stripe fees; Eventsli takes commission (+ its tax) | `describeDirectOrder`; unit `directCharges`; live balance transactions |
| Liability: Stripe as losses collector; legacy accounts refused | `connectModel.checkAccount` on every checkout; `connect-audit.js`; live |
| Webhooks: Connect and platform secrets; binding to our session and account; idempotent; out-of-order safe | `paymentController`; integration `stripeWebhook` (22 cases); live delivery |
| Ledger: sale, fee, refund, fee refund, dispute adjustments; legacy shape preserved | migration RPCs; integration `fulfillment`, `stripeWebhook`; rehearsal |
| Refunds and partial refunds; fee refunds; disputes withdrawn, reinstated, won and lost | integration + live CA and US |
| Payouts | live: CA 40.64 CAD and US 20.78 USD reached `paid` (organizer's own balance) |
| Deploy window (legacy sessions) | T-076 fix and test; runbook platform endpoint events |

### Verdict

**Migrations, scripts and code: technically ready.** Every check above
passed.

**Production rollout overall: NOT READY.** These blockers remain:

1. **I-002:** the live secrets in the plaintext file are still unrotated,
   including the DB password the migration script uses.
2. **The T-076/T-077 fixes are uncommitted**, by instruction. Without them the
   migration drops legacy ledger rows and the deploy window charges buyers
   without tickets. They must be committed, pass CI, and be merged before
   step 3.
3. **Owner configuration:** live Stripe webhooks (both endpoints) and secrets,
   the Managed Payments default, the platform-profile choice.
4. **Owner decisions:** counsel review; the refund-fee policy.
5. **Unknown production state:** run step 2 of PRODUCTION-ROLLOUT.md
   (read-only) first. Stop if any older migration is missing or a `bad_*`
   count is non-zero.

---

## T-078 — CI run #73 (`e8bbc96`) failures: root causes and fixes (2026-11-06)

Job results from the GitHub API: Frontend, Unit tests and Migrations passed.
**Dependency audit** failed at "All dependencies"; the runtime-only audit
passed. **Integration tests** failed at "Check the seed landed", so no test
ran. The raw logs need GitHub auth (403); the causes below were reproduced
locally.

### Integration — caused by this branch's own CLI pin

`supabase db psql` does not exist in the pinned CLI 2.122.1
(`Unknown subcommand "psql" for "supabase db"`). The pin was added in
`8d49430` to avoid v3's `[inbucket]` removal; that removal is real, but the
seed check used a command the pinned version never had.

**Fix:** `supabase db query "…"`. It was verified locally both ways: exit 0
with the seed present, exit 1 when the statement raises. The assertion is
unchanged.

### Dependency audit — 11 advisories (2 critical, 9 moderate), all dev-only

| Chain | Advisories | Fix |
|---|---|---|
| `frontend → vitest@3.2.7 → tinypool`, `@vitest/mocker` | **critical** GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (tinypool RCE gadgets); moderate GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 | `vitest@4.1.12` (published 2026-10-15, no tinypool, patched mocker). vitest 4 removed `poolOptions`, so the Node 25+ webstorage flag moved to `test.execArgv`; without that, 21 tests failed locally on Node 26. |
| `eslint-config-next@16.4.5 → typescript-eslint → @typescript-eslint/typescript-estree@8.72.1 → minimatch@10.2.6` | moderate GHSA-g3hv-75wg-m249 (fixed in 11.0.1) | No upstream fix: typescript-estree 8.72.1, the newest, still requires `^10.2.2`. npm's "fix" was a **downgrade** of eslint-config-next to 15.5.29, refused. Root override `"minimatch@^10.0.0": "^11.0.1"`, resolved with `npm update minimatch` to 11.0.5. Documented in SECURITY-ADVISORIES.md. |

**Pitfall recorded.** npm 11.20's nested override form
(`"@typescript-eslint/typescript-estree": { "minimatch": … }`), and removing
lock entries by hand, both left typescript-estree with **no** minimatch at
all, while `npm audit` reported **0** (a false clean). The final tree was
checked by resolving what typescript-estree actually loads (minimatch
11.0.5), not by the audit count alone.

### Full CI replayed locally: every step PASS

| Job | Steps | Result |
|---|---|---|
| Dependency audit | `npm ci` (lockfile matches) · `npm audit --omit=dev --audit-level=moderate` · `npm audit --audit-level=moderate` · secret scan | PASS · **0 vulns** · **0 vulns** · clean |
| Unit tests | `npm test` (backend) | **449/449** |
| Frontend | check · eslint · test · next build | PASS · PASS · **755/755** · PASS |
| Integration | fresh `supabase db reset` (52 migrations, CLI 2.122.1) · seed check via `db query` · `npm run test:integration` with CI's env | PASS · PASS · **322/322** |
| Migrations | bare `postgres:17` + CI's stand-in roles · all 52 files, one transaction each, ON_ERROR_STOP | PASS · PASS |

The audit threshold, the test set and the migrations job are unchanged.
Nothing is skipped and no `|| true` was added.

## T-079 — the webhook retried organizers' own non-Eventsli sales forever (High, Fixed, 2026-11-06)

**Cause.** Organizers have full Stripe accounts (`dashboard: full`, T-074),
and the Connect endpoint receives every event on them, including sales they
make outside Eventsli. Two paths treated those as transient failures:

| Event | What happened | Where |
|---|---|---|
| `checkout.session.completed` / `async_payment_succeeded`, organizer's own session | No `metadata.reservation_id`, so `fulfillFromSession` returned `VALIDATION_ERROR`. That is not in `PERMANENT`, so the answer was 500 with an error on the row. The duplicate branch re-runs errored rows, so every Stripe retry failed again. | `paymentController.js` checkout case |
| `charge.refunded`, `charge.dispute.*` on such a sale | `ORDER_NOT_FOUND`, then the T-075 path called `sessionForPaymentIntent`. It returns the organizer's **own** paid session, not null, so fulfilment ran, refused, and threw a 500. One extra Stripe API call per retry. | `withOrder` |
| Either, with a non-UUID `reservation_id` in the organizer's metadata | The `reservations.id` (UUID) lookup raised a Postgres error and threw, giving a 500. | `fulfillFromSession` read |

Impact: real ticket sales were unaffected. The cost was days of retries per
external sale, rows in the operator's error queue unrelated to Eventsli, and
a Connect endpoint that is always partly failing (Stripe warns about these
and can disable them). The existing test "an early dispute for a charge
Eventsli never created" mocked `sessionForPaymentIntent` to return null,
which real Stripe does not do for a Checkout sale, so the bug was hidden.

**Fix (`backend/controllers/paymentController.js` only).** A shape check,
`couldBeOurs(session)`: `metadata.reservation_id` must be a UUID.
- Checkout events failing it are acknowledged (200,
  `ignored: 'not an Eventsli checkout'`), marked processed with **no** error.
- `withOrder` does not fulfil from a session failing it, so external refunds
  and disputes return `ORDER_NOT_FOUND` (200), as already documented for
  charges we did not create.

**What is preserved.** Ownership (T-074): the guard only turns away sessions
that could never be fulfilled. Any UUID-bearing session still goes through
the recorded-session and recorded-account check and `fulfill_checkout`'s
re-check. A forged session naming a real hold is still `FORBIDDEN`. Early
events (T-075) and legacy sessions (T-076) carry our reservation id and are
unaffected. Idempotency and retries: the claim row, the duplicate re-read
and `mark` are unchanged, and genuine transient failures still answer 500.

**Evidence.** Three integration tests in `stripeWebhook.test.js`: an
external paid Checkout, one with a non-UUID `reservation_id`, and an external
refund plus dispute where `sessionForPaymentIntent` returns the organizer's
own session. Each test fails on the previous controller (20/23) and passes
with the fix (23/23). Full backend suite: **774/774** (local Supabase stack,
Node 26; CI uses Node 22).

## Check-in v2 — Phase 0 of the native check-in app (2026-11-08)

The owner approved a native iOS/Android check-in app built on the existing
`/scan/*` API. The `/gate` PWA stays, as the fallback that needs no install.
Phase 0 hardens the gate that both clients share. Migration
`20261108090000_checkin_v2.sql` adds `check_in_ticket_v2` and
`undo_check_in_v2`. The v1 functions are kept so that a code-only rollback
still works.

**Fixed:**
- **T-016.** A transfer now bumps `tickets.qr_version`, and the QR carries `v`.
  A code older than its ticket is refused as `transferred`.
  - The buyer's order views (My tickets, `/t/<token>`, resent emails) return a
    transferred ticket with `qr: null` and `transferredAway: true`. Before
    this, a freshly minted code there would have let the seller back in.
  - `GET /tickets` now also lists tickets *received* by the signed-in address
    (`ticketService.receivedBy`). Before this, "it is in your account" was
    false.
  - Tickets transferred before this change keep v0, so their current holders'
    emailed codes still work. Those few tickets are still exposed.
- **T-023 (door part).** The door refuses a ticket whose order is not `paid`.
- **T-054 / DB-10.** Both v2 functions match on (ticket, event).
- **T-046 (gate undo).** `GateScanner` updates the result card after an undo.
- **Other changes:**
  - Events that are not `published`/`archived` are refused as
    `event_not_open`. This is the same set staff sign-in allows; before, a PIN
    device could admit people to a suspended event.
  - The replay check runs again under the row lock, and a unique violation is
    answered as the replay. Before, simultaneous uploads of the same scan
    could return `error`.
  - The door is shown the buyer's name when the ticket has none, flagged with
    `holder_is_buyer`. After a transfer, no name is shown.
  - The duplicate message now gives the time in the event's time zone, not UTC.
  - `occurred_at` is clamped to [now − 48 h, now].
  - Refusals about a ticket are logged in `scans`.
  - New columns `scans.method` (`scan`/`manual`/`offline`) and
    `scans.conflict`. An offline admission that comes back as a duplicate is
    flagged, and `/scan/sync`'s summary gains `conflicts`.
  - New column `tickets.updated_at`, maintained by a trigger, for the app's
    offline manifest deltas.

**Evidence (local Supabase stack, Node 26; CI uses Node 22):**
- `checkin.test.js`: **22/22**. There are 6 new tests:
  - a transfer moves the code
  - a same-instant replay is never `error`
  - a closed event and an unpaid order are refused and logged
  - an offline conflict is flagged
  - the RPCs are event-scoped
  - name, tier and time zone are shown on admit and duplicate
- Full backend unit suite: **449/449**. Full integration suite: **330/330**.
- Frontend: vitest 752/755. The 3 failures are in `aiCreator.test.jsx` and
  fail identically with these changes stashed, so they pre-date this work and
  are unrelated.
- Frontend: lint clean, `npm run check` passes, `next build` passes.
- `gateOutcomes.test.js` now reads every migration that defines a check-in
  function, and fails if `transferred` or `event_not_open` has no screen.

**Production:** apply `20261108090000_checkin_v2.sql` (via
`backend/scripts/apply-migration.js`) BEFORE deploying the API that calls
`check_in_ticket_v2`.

---

## Check-in app: device test round 1, offline admission and launch hardening (2026-11-09)

Done on `feature/checkin-app`. Not committed, pushed or deployed. The API
contract is docs/CHECKIN-APP-API.md; the release runbook is mobile/RELEASE.md.

**Found on a real Android phone (round 1), now fixed:**
- **Unhandled `ROUTE_NAMES_CHANGED` warning.** Screens navigated after changing
  the session, which built the door's screens twice. Now only the session
  moves the phone, and Settings lives inside each group of screens.
- **Guest search found nobody who was already inside.** It searched within
  the "Not yet" filter. A search now covers every guest, and the door list
  matches each word, in any order, ignoring accents (migration
  `20261109090000`).

**Offline admission (migration `20261110090000`):**
- QR v2 codes are ES256 with a public key the device checks
  (`services/qrSigning.js`).
- `GET /scan/keys` and `GET /scan/manifest`, with paging and changes-only
  refreshes.
- A trigger makes any order-status change count as a change to its tickets.
- Offline conflicts appear on the website's door list.

**Found by the load test (`scripts/load-gate.js`) at 3× the target rate, now fixed:**
- **A failed device lookup was answered 401.** The app reads 401 as "this door
  was closed" and leaves it, so a database saturated by a rush would have
  signed every phone out. It is now a retryable 503; only a real revocation is
  a 401.
- **A scan the database did not answer came back as a 200 `error`.** Both
  clients showed it as settled, and an offline admission uploaded during
  overload was marked done and never retried, so the server would never have
  heard of it. Now `/scan/verify` and `/scan/manual-check-in` answer 503
  `SCAN_UNAVAILABLE`, and the app retries `error` rows in an upload up to 5
  times.
- Exactly-once held in every run, including under overload.

**Store readiness:**
- `expo-audio` and `expo-camera` defaults had added the microphone, a
  foreground media service, background audio and a Face ID text. All are gone,
  checked in the generated manifests.
- Android backup is off.
- Sentry is scrubbed of guest data, and off without a DSN.
- EAS Update is configured, with a fingerprint runtime.
- Contrast and screen-reader roles are now enforced by tests.

**Evidence (local stack, Node 26):**
- 50 scans/s sustained for 60 s over 20 doors: scan p95 68 ms, no errors,
  exactly-once OK.
- 100/s: p95 591 ms, no errors.
- 150/s: the laptop saturates. Rejected requests are retryable 503s, with no
  401 and no lost admission.

## Tickets, seat map and buying: walkthrough fixes (2026-11-09)

The owner reported problems in tickets, the seat map and buying. A guest
purchase was walked end to end on the local stack (event "Flow Test Dinner":
six tables, VIP / Standard / free tiers, one private table). Findings:

| ID | Severity | Finding | Status |
|---|---|---|---|
| T-080 | **Critical** | **Free tickets could not be claimed.** Since T-074 every quote is `chargeModel: 'direct'`, and `fulfill_checkout` refuses a direct order with no organizer Stripe account, so every free claim (and every order a 100%-off code brings to zero) answered 403 "That payment was not collected on this event organizer's account". Live in production since `def1750`. No integration test covered `/claim`. | Fixed in `claimFree`: quoted as DESTINATION, the model every non-Stripe order is recorded under (column default). No migration. Verified: claim 201, ticket issued |
| T-081 | High | The hold screen told every buyer "Finish within 1 minutes" on a 35-minute hold, and its ring never drew: `quoteReservation` did not select `created_at`, so `heldForMs` was always null | Fixed (verified: quote 2100000 ms, screen reads "35 minutes") |
| T-082 | Medium | Seats of every ticket type were drawn alike, with no price on the map; a buyer had to select a seat to learn its price | Fixed: a price legend per ticket type that highlights its seats, and the price in each seat's tooltip and accessible name (verified in the browser) |
| T-083 | Medium | An event whose tables are ALL private showed "This event has no seat map yet", and the invitation's unlock dialog was never reached | Fixed in `SeatPicker` (by review; no all-private event run) |
| T-084 | Low | Public seat map listed tables in id order, so keyboard and screen-reader order was random (T2, T5, T1…) | Fixed: label order (verified) |
| T-085 | Medium | Map editor: edits made while a save was in flight were wiped by the post-save re-read (the map part of T-046) | Fixed: the re-read keeps later edits and adopts the new tables' ids by label (by review and lint; not driven in the browser) |
| T-086 | **High** | **Changing a table's ticket type after its first save did nothing.** `save_venue_map` wrote `tier_id` and `price_override_cents` only for NEW tables, so an organizer who drew the room, saved, then assigned ticket types got a 200 and unchanged seats. Unpriced seats are refused at the hold ("These seats are not on sale yet"). | Fixed in migration `20261111090000`: available seats take the type and price; held and sold seats keep what was bought |

**T-017 and T-086, migration `20261111090000_venue_map_seat_integrity`.**
Both functions are the live definitions with only the marked changes:
`save_venue_map` refuses to add seats to a table with an active or converted
whole-table reservation and writes the ticket type and seat price to an
existing table's available seats; `fulfill_checkout` issues a whole-table
order's seats only where `held_by_reservation` is that reservation.

Evidence (local stack): on the OLD functions, a table held whole was grown to
9 seats (200) and seat 9 was then held separately (201), and assigning VIP to
an existing table left 0 of 8 seats VIP. On the new ones the growth is refused
(409 "booked as a whole table"), VIP reaches 8 of 8, and a free whole-table
claim still issues 8 tickets for 8 seats. Two new tests in
`test/integration/venueMap.test.js` fail on the old functions and pass on the
new; venueMap, fulfillment, seatConcurrency, privateTables and largeVenueMap
pass 68/68. `verify-schema.js` checks both bodies.

**Production:** apply `20261111090000` with `apply-migration.js`, then run
`verify-schema.js`. Deploy order: any; the API does not change shape.

Still open from this area: the rest of T-039, T-024, T-050, T-060 (now including a
`/claim` integration test, which would have caught T-080).

**Local test data, not product changes:** the demo organizer's organization
details were filled in, the check-in demo's LAN-only cover URLs
(`192.168.1.6`) were cleared because `next/image` refuses that host, and
"Flow Test Dinner" was created and published directly in the local DB.

---

## Seating, pricing and checkout audit (2026-11-09)

A code-traced audit of the seat map, ticket types, pricing, holds, checkout and
door sales, followed the same day by its remediation. Findings are numbered
S-01..S-21 (separate from T-numbers, which they reference where they overlap).
Everything below is verified on the local stack unless marked otherwise.

| ID | Sev | Finding | Status |
|---|---|---|---|
| S-01 | **Critical** | Private tables could never be bought: the hold sent the table key in `x-access-token`, the API reads `x-table-access`; a seat at a private table sent no key at all. Backend tests sent the right header by hand, so CI passed | Fixed (`useReservation`, `SeatPicker`); `test/holdHeaders.test.jsx` pins the request and the header name against the backend source. Not driven in a browser |
| S-02 | **High** | The editor read a table's ticket type and seat price from `seats[0]`, in id order; after a partial sale an unrelated save could put the old type back on every available seat | Fixed: `tables.tier_id` / `tables.seat_price_cents` are the source of truth (backfilled), returned by the API and read by the editor |
| S-03 | **High** | Map save was a full replace with no version check: a stale tab silently deleted another tab's new tables | Fixed: `save_venue_map(…, p_expected_version)` refuses with `MAP_STALE` (409); the editor sends its version and offers "Reload the map" |
| S-04 | **High** | Two pricing rules: the editor counted a whole-table price as pricing the seats, the database never did (`override → type → 0`). Editor said "Every table has a price", submission then refused; a live map could gain unsellable seats | Fixed: editor counts exactly as the server does, by purchase mode; a live (non-table-only) map cannot be saved with unpriced seats; the per-table seat price is now settable; comments corrected |
| S-05 | Medium | `hold_table` skipped the ticket types' sale window and the general-admission refusal | Fixed in the migration |
| S-06 | Medium | A ticket type's `max_per_order` was offered on reserved events and never enforced | Fixed in `hold_seats`, and checked in the seat picker before the hold |
| S-07 | Medium | The buyer map showed unpriced, off-sale and sold-out seats as available; ticket-type refusals reloaded the same map (loop) | Fixed: `seatSellability.js`; `available` now means "can be chosen now", with a `reason`; tiers carry `onSale`/`soldOut`/`maxPerOrder`; `canBookWhole` requires every seat sellable |
| S-08 | Medium | Blocked seats counted as booked: a fully blocked table could not be removed or shrunk ("booked"), blocked seats kept old prices, and they disabled the AI designer | Fixed: deletion and shrink checks read held/sold seats only; blocked seats follow the table's type; editor counts them separately |
| S-09 | Medium | Every save locked every table and rewrote every seat and table, so buyers' holds queued behind it | Fixed: only changed and deleted tables are locked and written. Verified: a no-op save of a 300-seat map rewrote 0 seats and 0 tables (rolled-back transaction) |
| S-10 | Medium | Map, ticket-type, category and blocking writes were not limited by event status | Fixed: `middleware/eventEditable.js` on all ten routes (cancelled/completed refused, archived unless admin); `save_venue_map` refuses cancelled/completed, general-admission and listing-only events. Owner decision 2026-11-10: no review; every price change is logged by trigger to `admin_audit` with its actor. Done — see "Owner decisions and the remaining seating work" |
| S-11 | Medium | "From $X" was the cheapest visible ticket type, used or not, on sale or not | Fixed: `event_from_prices` (sellable stock only), used by listings, landing and the assistant |
| S-12 | Medium | A whole table sold at the door wrote a line per seat at ticket-type prices; lines did not add up to the order | Fixed: one table line at the table price |
| S-13 | Medium (UX) | A general-admission event hid the seat map with no explanation | Fixed: the row stays, disabled, with the reason and where to change it; Back/Next walks past it |
| S-14 | Low | Swapping two table names hit the seat uniqueness rule and showed a raw Postgres error | Fixed: renamed tables' seats step aside first |
| S-15 | Low | "Sold individually … for good" for seats merely held or blocked | Fixed in `hold_table` and `errors.js` |
| S-16 | Low | Renaming a table renames sold seats' section; sent tickets show the old name | Owner decision 2026-11-10: snapshot. Done — immutable issued snapshot on `tickets`, read by tickets, emails, the door list and the check-in app |
| S-17 | Low | Ignored read errors: quote (items, event), the applied promo (charged full price on a failed read), the map save's event lookup, the editor's ticket-type and category lists | Fixed; the promo read fails closed |
| S-18 | Low | The ticket-type price lock is stricter than needed (each hold freezes its own price) and bypassable via seat prices | Owner decision 2026-11-10: prices may change after a sale. Done — lock dropped; sold orders and lines are immutable by trigger |
| S-19 | Low | Theatre rows are tables with `row_label` 'A'; section/row names live only in the layout blob | Fixed 2026-11-10: `tables.section_name` / `row_name`; seats addressed Section · Row · Seat |
| S-20 | Low | Signed-in buyers had to retype their email | Fixed: prefilled, still editable. `HoldConfirm` step kept (deliberate, T-081) |
| S-21 | Low | No test across the browser↔API contract | Fixed 2026-11-10: `holdHeaders.test.jsx` and `apiContracts.test.js` read the backend source and pin the seating and checkout requests to it. No browser end-to-end run exists (see blockers) |

**Migration `20261112090000_seating_pricing_integrity`.** Adds
`tables.tier_id` and `tables.seat_price_cents` (backfilled deterministically
from each table's available seats), replaces `save_venue_map` with a
four-argument version (old signature dropped, grants restated), re-issues
`hold_seats`, `hold_table` and `record_manual_sale` with only the marked
changes, and adds `event_from_prices`. Re-runnable. `verify-schema.js` checks
the new columns, function and bodies.

**DEPLOY ORDER: migration FIRST, then the API.** The old API's three-argument
call still matches the new `save_venue_map` (the version defaults to NULL, no
check); the new API's four-argument call does not exist before the migration.
After the deploy, any live map that already holds unpriced seats will refuse
its next save until a ticket type is chosen for the named tables; that is the
intent.

**Evidence (local stack).** Before the fix the 12 new integration tests all
failed, for the reasons in the table (e.g. `duplicate key … seats_venue_map_id_section_key…`
for S-14, "these tables have been booked … Gone" for S-08). After: backend
858/858 + 12 new + 5 unit (`seatSellability.test.js`); frontend 774/777. The
3 frontend failures are `aiCreator.test.jsx`, whose fixture event is dated
2026-11-07 and has gone stale (an extra "starts in the past" problem), not a
regression; it needs a relative date.

**Not done here:** inline ticket-type creation from the map, a single save
model for the Studio, splitting the three files now just over the 500-line
cap (`MapEditor.jsx`, `SeatMapCanvas.jsx`, `SeatPicker.jsx`), and the owner
decisions above (S-10 live review, S-16, S-18).

---

## Owner decisions and the remaining seating work (2026-11-10)

The owner approved three product decisions on 2026-11-10 and asked for the
remaining seating items. All of it is in migration `20261112090000` (amended;
it has never left this machine) and the working tree, **uncommitted**, and
**not applied to production**.

### Owner decisions

| Decision | What was built | Evidence |
|---|---|---|
| **S-10** Unsold prices change on a live event without review; sold prices preserved; every change logged | No review step on tier or map price changes (there was none; now explicit). `log_price_change` triggers on `ticket_tiers.price_cents` and on `tables.price_cents` / `seat_price_cents` / `tier_id` write `price.change` rows to `admin_audit` (old, new, event status, sold count). The actor comes from `set_tier_price(…, p_actor)` and `save_venue_map(…, p_actor)`. Admin audit screen: filterable "Changed a price" with readable detail lines | `S-10: every price change on a live event is logged…` (3 rows, actor, no review, a no-price save logs nothing) |
| **S-16** Issued tickets keep the original table name; new tickets take the new one | `tickets.issued_table_label / issued_section / issued_row / issued_seat_number`, filled by `snapshot_ticket_place` on INSERT (every issuing path) and immutable on UPDATE (`TICKET_PLACE_IMMUTABLE`). Backfilled from current names. Read first by `ticketService`, the attendee list, and the door's four functions (`check_in_ticket_v2`, `event_door_list`, `ticket_door_detail`, `event_door_manifest`, re-issued with only the label expressions changed) | `S-16: an issued ticket keeps the table name…` (old ticket "Rose", new "Lily", door detail "Rose", rewrite refused) |
| **S-18** Ticket-type prices may change after a sale; every order and ticket keeps its purchase price | `trg_lock_tier_price` dropped. `sale_prices_are_final` triggers refuse any UPDATE to an order's amounts or an order line's price/quantity (refund/dispute columns untouched). `PRICE_LOCKED_AFTER_SALE` removed from both error maps. Ticket types form: price editable after a sale, with the sold count kept at their price | `S-18: the price can change after a sale…` (catalogue; replaces the test that asserted the lock) and `S-18: a price change mid-hold and after a sale…` |

**Historical prices are independent of the current ticket-type price —
verified by reading every path.** A hold copies each line's price
(`reservation_items.unit_price_cents`); the quote and `fulfill_checkout` read
that copy; the order stores its whole breakdown and `order_items` each line's
price; refunds, disputes and every dashboard sum read orders. The only reads
of the live `ticket_tiers.price_cents` for an existing event are labels (the
sales summary's per-type price, the admin review preview) and NEW sales. A
ticket has no price column of its own; its price is its order line's.

**Not built: "sensitive changes may require Super Admin approval based on
platform policy".** No such policy is defined. Every change is in the audit
log for review; an approval gate needs the policy (what counts as sensitive)
before it can be built.

### The four follow-ups

| Item | Done |
|---|---|
| Create a ticket type from the map editor | `NewTierInline` (name + price, created at once) from the table panel, the multi-select panel and the section dialog; the new type joins the editor's list and is assigned. Inline, because the section dialog is already a dialog |
| One save model for the Venue Studio | Preview seat blocks/releases are draft state (`useStudioDraft.holds`), mark the map unsaved, and travel in the map save (`p_availability`) — applied in the same transaction, held/sold seats skipped and counted, a refused save changes none. The instant `PUT …/availability` endpoint is kept for older clients and its tests, but the editor no longer calls it |
| Theatre row labels (S-19) | `tables.section_name / row_name` (backfilled from the layout's sections, collision-safe, two-step), written from the Studio's sections on every save; seats addressed (section, row, number); duplicate addresses refused by name; ticket shows Section · Row · Seat with no table; seat picker names seats from their own fields, layout as fallback |
| Files over 500 lines | `MapEditor.jsx` 612 → split into `useMapPersistence.js`, `EditorSidePanel.jsx`, `MapNotices` (MapChrome); `useMapDraft.js` 511 → 476 (table builders to `draftRules.js`). `SeatMapCanvas.jsx` and `SeatPicker.jsx` were brought under by the Venue Studio session. Only `NewEventForm.jsx` (554, not in scope) remains over |

**Also fixed while doing it:** `hold_table` now locks a table's seats before
counting them (a seat blocked in the same instant could be sold with the
table), and the map save locks the tables of seats it blocks in its first,
id-ordered lock pass — taking them later could deadlock with a whole-table
booking (the pattern T-053 records for door sales).

**Date-dependent frontend tests:** `aiDraftFixture.js` now dates the draft
the next 15 January at least 45 days away (always standard time in Toronto,
so the UTC values stay exact); the four AI test files use its constants.

### Verification (local stack, 2026-11-10)

- Backend: **868/868** (unit + integration), including `seatingIntegrity.test.js` (17) and the rewritten catalogue S-18 test.
- Frontend: **781/781**, 80 files, including `apiContracts.test.js` and `holdHeaders.test.jsx`; ESLint clean; `npm run check` passes.
- Migration chain rehearsal: all **58** migrations applied in order to an empty database (auth stub only), then `20261111…` and `20261112…` re-applied cleanly; the rehearsal database was dropped.
- `verify-schema.js` checks (new columns, functions, triggers, the price lock's absence, the door functions' snapshot) all true on the local database; `api_roles_leak_check.sql` returns **0 rows**.
- No browser was driven: the editor, Studio preview and seat picker changes are verified by unit, contract and integration tests, not by a run in Chrome.

### Remaining blockers before production

1. **Commit packaging.** `feature/checkin-app` carries uncommitted work from several sessions (check-in app, Venue Studio, this audit). It needs reviewing and committing as a whole; this work depends on the Venue Studio files.
2. **SIX migrations, in order** — every one since the 2026-11-06 release (`55a408f`): `20261108090000`, `20261108100000`, `20261109090000`, `20261110090000`, `20261111090000`, `20261112090000`. *Corrected 2026-11-10:* this said "two"; `20261112090000` re-issues functions the four check-in migrations create, and run alone it failed with `function door_fold(text) does not exist`. It now refuses up front, changing nothing, and names the missing files.
3. **No end-to-end browser run** of the map editor, Studio preview, seat picker and checkout against the new API.
4. **Organizer payments** (from the earlier audit): the only live organizer was still completing Stripe onboarding (charges disabled), so card sales are not yet exercised in production.
5. Not blocking, still open: T-050 (no database guarantee of one live ticket per seat), T-053 (door sale vs whole-table lock order), T-060 (checkout/claim/success-page tests), T-039/T-040/T-044, the S-10 approval policy.

### Production deployment checklist

1. Review and commit the branch; CI green (backend unit + integration, frontend, `npm run check`).
2. Back up the production database (or confirm a fresh point-in-time restore point).
3. Confirm what production already has: `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 8;`
4. Apply, one at a time and in this order, each with `node scripts/apply-migration.js ../supabase/migrations/<file>` (it records each one and skips any already applied):
   `20261108090000_checkin_v2.sql`, `20261108100000_checkin_app_api.sql`, `20261109090000_door_list_search.sql`, `20261110090000_offline_manifest.sql`, `20261111090000_venue_map_seat_integrity.sql`, `20261112090000_seating_pricing_integrity.sql`.
   Rehearsed 2026-11-10 on a database built from the migrations up to the 11-06 release: all six apply in this order.
   Use `apply-migration.js`, not the Supabase SQL editor: it adds lock and statement timeouts and records the migration.
5. `node scripts/verify-schema.js` → "Schema verified."; run `supabase/checks/api_roles_leak_check.sql` → 0 rows.
6. Deploy the API (Node 22, `npm ci`), then the frontend; confirm `/health`.
7. Smoke test on a test event: draw a map with a section, assign a ticket type made in the editor, block two seats in Preview, Save map; buy a private table with its password; change a ticket type's price after a sale and see it in Admin → Audit as "Changed a price"; rename a table and confirm an existing ticket keeps the old name; scan at the door.
8. Watch logs for `MAP_STALE`, `SALE_PRICE_IMMUTABLE`, `TICKET_PLACE_IMMUTABLE` and `SEAT_NOT_PRICED` in the first day; any `SALE_PRICE_IMMUTABLE` is a code path trying to rewrite a sale and must be investigated.
9. Rollback: the API can roll back on its own (the old API works against the new schema). The migration is additive except the dropped price-lock trigger; restoring that trigger is the only schema rollback needed to return to the old price rule.
