# Phase 1: global registration and listings — production-readiness report (2026-11-17)

**Scope.** Organizers in 236 countries can register and create events.
Card checkout stays on in Canada and the US only. Buyers are never let into
a checkout that cannot take their money. Nothing has been committed, pushed,
migrated or deployed.

**Verdict.** Ready to deploy once the owner actions at the end are done. The
two items marked ⚠ are business or legal decisions, not code defects.

---

## 1. What Phase 1 changes

| Area | Behaviour after deploy |
|---|---|
| Sign-up | 236 countries, guessed from the visitor's clock or language; 6 countries under comprehensive sanctions excluded |
| Events | Priced in the country's own currency, with correct decimals (0 / 2 / 3) |
| Card checkout | **CA and US only**, unchanged. Admin can switch more on per country (Settings → Countries) |
| No card, paid event | **No Buy button.** The page says *"Tickets for this event are not sold online. Contact the organizer to buy."* `/seats` and `/tickets` redirect to the event page, and the hold API refuses with `TICKETS_NOT_SOLD_ONLINE` before any seat is held |
| No card, free event | Still claimable online, as today |
| Organizer Payments page | No Stripe section where card is off; no longer claims instructions are shown at checkout |
| Commission invoices | A payment submitted twice records once (idempotency key); a reused bank reference is refused |

## 2. Migrations

Apply in this order. Each runs in its own transaction.

| File | What it does | Depends on |
|---|---|---|
| `20261121090000_global_markets.sql` | Creates the `markets` table (236 rows); swaps the CA/US CHECKs for foreign keys **with the same constraint names**; opens every country in `currencies`, keeping `card` = what was on (CA, US); currency-aware `claim_promo_code`; currency in price-change audit entries | — |
| `20261121100000_invoice_payment_idempotency.sql` | `invoice_payments.idempotency_key` + unique index; `invoice_record_payment` gains a key parameter (default null) and a duplicate-reference refusal | — (independent; can ship alone) |

**Verified locally:**
- Both files apply on a database at production's schema (all earlier migrations
  applied first).
- Both re-run cleanly inside a rolled-back transaction.
- The `markets` seed matches `markets.json` row for row (a unit test fails on drift).

**Production cautions:**
- The foreign keys are validated against existing rows. Production organizers
  and events are all CA/CAD or US/USD, which are present, so validation is
  expected to pass. If it fails, the transaction rolls back and nothing changes.
- **Migrations before code.** The new frontend and backend read `markets`
  and the `card` setting. The new backend calls `invoice_record_payment` with
  eight arguments: on the old function, that call fails. Order: migrations → backend → frontend.
- **Production is ~12 migrations behind local** (20261111…20261120 were pending
  locally until this review; I can't see production). Apply any that are
  missing **first, in order**. `20261121090000` redefines functions created in
  `20260915130000` and `20261112090000`.
- **Rollback:** no down-migration. The safe path is to restore from backup, or
  re-add the CHECKs by hand while only CA/US rows exist. The setting change can
  be undone in Admin → Settings.
- Run `node backend/scripts/verify-schema.js` after deploy (it now expects `markets`).

## 3. Existing Stripe functionality (CA/US)

Unchanged and tested:

- **Charge model:** direct charges on organizer-owned Accounts v2,
  `application_fee_amount` = commission (+ tax), untouched. Amounts were
  already minor units, which is what Stripe takes for CAD and USD.
- **Onboarding** now also asks "is card on for this country?" first. True for
  CA and US, so behaviour is identical. Account creation keeps its idempotency
  key and model checks.
- **Every checkout** (`organizerCanReceive`) adds the same country check, before
  the Stripe call. A CA/US organizer passes exactly as before.
- **Event page:** `payments.card` for a CA/US event is true exactly when it was
  before (`accepts_stripe !== false`). The "pay manually" badge no longer shows,
  because no buyer can pay manually online in Phase 1.
- **Tests:**
  - Integration **455/455**, including checkout, webhook fulfilment, refunds,
    disputes and direct-charge tests.
  - A new test pins a Canadian paid event: purchasable, card true, CAD, hold allowed.
  - Backend unit **627/627**, frontend **892/892**.
- **Not exercised here:** a live Stripe payment. The local suite stubs Stripe's
  network. The last real test-mode end-to-end run was 2026-11-06 (CA and US).
  **Recommended:** one test-mode purchase on staging before go-live.

## 4. Country restrictions

| Rule | Enforced at |
|---|---|
| 6 countries never offered (BY, CU, IR, KP, RU, SY) | Not in `markets.json` or the `markets` table. Refused at sign-up, event creation, the settings API, and by database foreign keys |
| Country must be open | Sign-up, event creation (`currencies.by_country`) |
| Card only where Stripe operates (44) **and** switched on (default CA, US) | Settings API, onboarding (before an account is created), every checkout, the hold API (via purchasability), the event page |

⚠ **Owner and counsel decisions:**
- **Syria:** Canada eased its sanctions (February 2026), and US status was
  reported changing in 2026. Currently excluded, as the conservative choice.
- **Crimea, Donetsk and Luhansk** are inside Ukraine, which is open. They can't
  be blocked by country code; doing that needs address or region screening.
- **No identity or sanctions screening of organizers** who never connect Stripe.
  Phase 1 organizers abroad can list events, record door sales and owe
  commission without KYC.
- **Stripe cross-border:** documented for payouts from a Canadian platform to
  US/UK/EEA/CH only. Before ticking **Card** for any other country, create and
  onboard a test-mode account there.

## 5. Legal requirements before international launch

The full section-by-section list is in `docs/GLOBAL-LAUNCH-REVIEW.md` §8.
Minimum for Phase 1, which lists events abroad without online selling:

- **Privacy policy:**
  - laws (GDPR/UK GDPR and target countries)
  - international transfers (SCCs / IDTA)
  - rights and complaint bodies outside Canada
  - retention by jurisdiction
  - age of consent
- **Organizer agreement:**
  - governing law and jurisdiction
  - sanctions and export compliance
  - KYC/AML for organizers without Stripe
  - commission tax abroad (VAT/GST, reverse charge, withholding)
  - invoice currency, FX and bank charges
  - local permits and taxes as the organizer's responsibility
- **Ticket terms:** governing law; mandatory consumer rights by country
  (cancellation refunds); how buyers buy from organizers offline (Phase 1:
  outside Eventsli entirely).
- The privacy page's own header says it has not been reviewed by a lawyer.

⚠ Counsel sign-off is required before marketing Phase 1 outside Canada and the US.

## 6. Commission collection

- **What happens in Phase 1:** an organizer abroad records door sales (seated
  events only). Commission is invoiced in the **event's currency** (EGP, JPY…),
  and the invoice shows the single free-text setting **Admin → Settings →
  Door-sale invoices → How organizers pay Eventsli**. Admins record payments
  (now idempotent), reverse, waive or void; every step is in the audit log.
- **Not verifiable from code:** whether Eventsli can actually receive those
  currencies. ⚠ Owner decides one of:
  - (a) accept local currencies through a multi-currency account (e.g. a
    provider with local receiving details)
  - (b) ask organizers to pay the invoice amount converted to USD or CAD,
    in the instructions text
  - (c) build USD/CAD invoicing with a captured exchange rate. This isn't in
    Phase 1 or Phase 2.
- Some currencies have exchange controls (e.g. EGP, NGN, ARS). Outbound
  payments by organizers there may be slow or capped.
- **Required before launch:** set the instructions to international details
  (IBAN/SWIFT or equivalent) and say who pays transfer fees.

---

## Owner actions before Phase 1 deploy

1. ⚠ Counsel: sanctions list (Syria; Crimea, Donetsk, Luhansk), organizer
   screening, and the legal sections above.
2. ⚠ Decide the invoice currency approach; set international payment instructions.
3. Confirm which migrations production already has; apply any missing ones in order.
4. Approve the commit. Then: apply `20261121090000` and `20261121100000` →
   deploy backend → deploy frontend → run `verify-schema` → one Stripe test-mode
   purchase on staging (CA or US).
5. Optional: tick **Card** for more countries only after each passes a test-mode onboarding.

## Phase 1 file set

A snapshot of the Phase 1 working tree (a patch of tracked files plus the new
files) was taken before any Phase 2 work, so Phase 1 can be committed on its own.
See the Phase 2 report for how the two separate.
