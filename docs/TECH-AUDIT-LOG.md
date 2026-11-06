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
| T-003 | Medium | Dev-only advisories (vitest/tinypool critical, vite, eslint-config-next chain) need semver-major upgrades; documented in SECURITY-ADVISORIES.md | Open — needs vitest 5 (major); dev-only |
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
| T-016 | High | Ticket transfer does not move the credential: old QR still admits the seller, recipient gets nothing **[mig]** [SEC-01, BE-04] | Open |
| T-017 | High | Growing a held table lets a new seat be sold twice; `fulfill_checkout` issues by table membership **[mig]** [DB-01] | Open |
| T-018 | High | Cutting a tier's allocation ignores live holds → paid checkout rolls back, no tickets **[mig]** [DB-02] | Open |
| T-019 | Medium | Login lockout counter is read-modify-write (bypassed by parallel attempts) **[mig]**; credential limiter keyed on un-normalised email [SEC-05] | In progress — limiter key fixed; atomic counter needs [mig] |
| T-020 | Medium | Unnamed rate limiters share one Redis counter when `REDIS_URL` is set [SEC-07, BE-05] | Fixed (verified) |
| T-021 | Medium | Verification code + email written to logs when mail fails (subject carries the code); raw IP logged at the gate [SEC-08] | Fixed (verified) |
| T-022 | Medium | Seat hoarding: 15 holds/5 min/IP × 35 min TTL [SEC-04] | Needs owner (policy) |
| T-023 | Medium | Refunded / charged-back tickets still scan in [BE-19, extends I-007] | In progress — refunds and lost disputes now void tickets (T-074); refund initiation stays with the organizer |
| T-024 | Low | `GET /public/reservations/:id/quote` needs no reservation token [SEC-09] | Open |
| T-070 | **High** | The Stripe account has **Managed Payments on by default**; it refuses any Checkout Session whose line item has no product `tax_code`. `createCheckoutSession` sends none, so on this account every card checkout would be refused | Fixed (owner-approved 2026-11-06; verified in units + test-mode API; full Connect pay pending T-073) |
| T-073 | **High** | The platform (test mode) cannot create organizer Connect accounts: Stripe refuses `accounts.create({ type: "express" })` while the platform has not confirmed it is the losses collector. The app's error translator sent operators to the wrong setting for this refusal | Superseded by T-074 (do NOT accept platform loss liability); translator fix kept |
| T-074 | **Critical** | Payment architecture contradicted the business model: destination charges made Eventsli the settlement merchant, payer of Stripe fees and disputes, and liable for organizer losses; the webhook trusted metadata alone (exploitable under direct charges) | Implemented; test mode FULLY verified for CA and US organizers with real webhook delivery and test payouts, no waiver; production steps pending |
| T-075 | High | Stripe delivers events out of order: a dispute arriving before its payment's checkout event was answered ORDER_NOT_FOUND and lost | Fixed (verified: integration + live redelivery) |

### Phase 2 — Reliability, operability, broken flows

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-030 | High | Cache revalidation never reaches Next in prod: comma-separated `FRONTEND_URL` → invalid URL; failures logged at `debug` [QA-01, BE-15, SEC F-2] | Fixed (verified; REVALIDATE_URL set on the VPS by owner 2026-11-05) |
| T-031 | Medium | Error handler turns body-parser 400/413 into 500 [BE-11] | Fixed (verified) |
| T-032 | Medium | Non-numeric `RESERVATION_TTL_MINUTES` → NaN passes the boot check; `FRONTEND_URL` not required in prod [BE-15, QA-10] | Fixed (verified) |
| T-033 | High | Gate crashes when "Stop the camera" is pressed after the camera failed; a cancelled start leaves the stream running [FE-03] | Fixed (verified in units; not run on a camera) |
| T-034 | High | A second hold silently strands the first; checkout uses whichever token is stored [FE-04] | Open |
| T-035 | High | Buyer seat map not operable by keyboard (Enter/Space do nothing) — blocks purchase [FE-02] | Open |
| T-036 | Medium | Success page says "Nothing was charged" for a payment still `unpaid`/pending [FE-07] | Open |
| T-037 | Medium | `apiClient`: a caller signal removes the 30 s timeout; body read is untimed [FE-08] | Open |
| T-038 | Medium | Webhook subscription list in DEPLOY.md misses `async_payment_succeeded`, `charge.dispute.created` [QA-05] | Open |
| T-039 | Medium | Ignored Supabase `error` on hold/checkout/Connect/release paths [BE-08 rest] | Open |
| T-040 | Medium | Raw DB error messages returned to clients [BE-10] | Open |
| T-041 | Medium | Invoice issued/settled emails never sent (dead functions) [BE-06] | Open |
| T-042 | Medium | `?maxPrice=` scans every tier, truncates at 1000, can build a 75 KB URL [BE-07] | Open |
| T-043 | Medium | pm2 `kill_timeout` (1.6 s) < app drain (10 s); DEPLOY.md claims zero-downtime reload in fork mode [QA-07] | Open |
| T-044 | Medium | No DB request timeout on the Supabase client [BE-16] | Open |
| T-045 | Medium | Ticket emails fire-and-forget, no outbox [BE-09] | Deferred (Phase 3, needs table) |
| T-046 | Medium | Search box drops `to`/`country`; gate undo leaves "Admitted"; map edits during save lost; Back loses map work; countdown announced every second [FE-05, FE-06, FE-09, FE-10, FE-11] | Open |

### Phase 3 — Data integrity & performance (all **[mig]**)

| ID | Sev | Summary | Status |
|---|---|---|---|
| T-050 | Medium | No DB guarantee of one live ticket per seat [DB-05] | Open |
| T-051 | Medium | Missing indexes: `orders(guest_email)`, `reservations(event_id,state)`, SET NULL FKs on tickets/order_items, `site_visits(path,day)` [DB-06] | Open |
| T-052 | Medium | PII retained forever (`webhook_events.payload`, abandoned `attendee_data`, resets, verifications) [DB-07] | Needs owner (retention periods) |
| T-053 | Low | Door sale lock order can deadlock with `hold_table` [DB-08] | Open |
| T-054 | Low | `invoices.due_at` nullable [DB-09]; check-in RPCs not event-scoped [DB-10]; promo code case-insensitive uniqueness [DB-11]; FKs blocking profile erasure [DB-12]; `search_path` without `pg_temp` [DB-13] | Open |
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
