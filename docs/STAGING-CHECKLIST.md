# Staging deployment and test checklist — global launch (Phase 1 + Phase 2)

Applies to commit `40a630b` (Phase 1 and Phase 2 together, already on
`origin/main`) plus the two uncommitted files from the 2026-11-17 review:
`backend/scripts/migration-gap.js` and
`backend/test/integration/offlineCheckoutDark.test.js`.

Phase 2 (offline checkout) ships **dark**. Every step below keeps it off,
except section 7, which turns it on in staging only.

---

## 0. Environment

| Need | Value or check |
|---|---|
| Staging Supabase project | A separate project, never production. Restore a recent production backup into it so the migrations run against real data |
| Staging API host | Node **22** (CI and production use 22; local runs on 26) |
| `backend/.env` (staging) | `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `JWT_SECRET`, `QR_JWT_SECRET`, `IP_HASH_SALT`, `BACKEND_URL`, `FRONTEND_URL`, `PUBLIC_SITE_URL`, `BREVO_API_KEY` (or accept no emails), `SCHEDULER_ENABLED=true` |
| Stripe (staging) | `PAYMENTS_STRIPE_ENABLED=true`, **test-mode** `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` from **two staging webhook endpoints** in the Stripe test dashboard (account events and Connect events, both pointing at `https://<staging>/api/v1/payments/webhook`) |
| Frontend (staging) | `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` pointing at staging |
| Test connected accounts | Already exist in the Stripe test platform: **CA `acct_1UYeuYATUrLCxbN9`** and **US `acct_1UYeucAJG8Jow2C3`**, both with charges and payouts on, full Dashboard, losses on Stripe. Link each to a staging organizer of that country (step 5) |
| Never | Live Stripe keys on staging; staging webhooks pointed at production; production database credentials on staging |

## 1. Back up

- [ ] Take a Supabase backup (or `pg_dump`) of **staging** before migrating. On
  production later, take a fresh backup first: there are no down-migrations.

## 2. Find the migration gap (read-only)

```bash
cd backend && node scripts/migration-gap.js
```

- [ ] Every line reads `present = true`, or you have the list of missing files,
  in order. The script uses `BEGIN READ ONLY` and writes nothing.
- [ ] `node scripts/verify-schema.js` for older objects.

## 3. Apply missing migrations — in filename order, one at a time

```bash
node scripts/apply-migration.js ../supabase/migrations/<file>.sql
```

The order and risks are in `docs/RELEASE-REVIEW-2026-11-17.md` §4. Notes:
- `20261116090000_sms_platform.sql` is large (it seeds 243 countries). Expect
  it to take longer.
- `20261121090000_global_markets.sql` validates new foreign keys against
  existing organizers and events. It fails and rolls back if any row is not a
  known country and currency.
- `20261121100000_invoice_payment_idempotency.sql` replaces
  `invoice_record_payment`. The new code calls the new signature, so **apply
  it before or together with the code**.
- `20261122090000_offline_checkout.sql` writes `offline_checkout = {enabled:false}`.
- [ ] After all of them: `node scripts/migration-gap.js` shows no missing
  migrations, and `node scripts/verify-schema.js` prints `Schema verified.`

## 4. Deploy code

- [ ] Backend, then frontend, both from the same commit.
- [ ] `curl https://<staging>/api/v1/health` returns `paymentsEnabled: true`.
- [ ] `curl https://<staging>/api/v1/public/markets` returns 236 countries and
  `card: ["CA","US"]`.

## 5. Prepare test data (staging)

- [ ] Create one **Canadian** organizer and one **US** organizer through the
  normal sign-up.
- [ ] Link the Stripe test accounts. On staging only, in SQL:
  `UPDATE organizers SET stripe_account_id='acct_1UYeuYATUrLCxbN9', stripe_onboarding_complete=true, stripe_payouts_enabled=true WHERE id='<CA org>';`
  and the same with `acct_1UYeucAJG8Jow2C3` for the US organizer. (Or run
  Stripe test onboarding from the Payments page.)
- [ ] Each organizer publishes one **general-admission** event (CA$25 / US$25)
  and one **reserved-seating** event with a seat map, taking card payments.

## 6. Real test-mode card purchases — must pass

Use Stripe's published test cards only. For a Canadian-issued card use
`4000 0012 4000 0000`; for a US card, `4242 4242 4242 4242`. Any future
expiry, any CVC.

### 6a. Canadian customer, CAD
- [ ] Open the CA event page → **Buy** is shown → choose 2 tickets → checkout
  shows card only (no "pay the organizer" option) and a total in **CA$**.
- [ ] Enter email, tick the 3 agreements, sign → redirected to Stripe test
  Checkout, which names the **CA organizer**.
- [ ] Pay with the Canadian test card, billing country **Canada** → redirected
  back → "Payment successful", tickets shown.
- [ ] Email with tickets received (if Brevo is configured).
- [ ] Stripe test dashboard → **connected account `…xbN9`** → the payment exists,
  in **CAD**, with an **application fee** equal to the commission on the order.
- [ ] Webhook delivered: Stripe → Developers → Webhooks → the Connect endpoint
  shows `checkout.session.completed` with a **200** response.
- [ ] In the database: order `status=paid`, `channel=stripe`,
  `charge_model=direct`, `currency=CAD`, `stripe_account_id` = the CA account;
  the right number of `valid` tickets; ledger `sale` credit + `commission`
  debit; reservation `converted`.
- [ ] Scan one ticket at the gate → admitted; scan it again → duplicate refused.
- [ ] Repeat on the **reserved-seating** event: the chosen seats become `sold`.

### 6b. US customer, USD
- [ ] The same steps on the US event with `4242 4242 4242 4242`, billing country
  **United States** plus a ZIP code. Check: **USD**, connected account
  **`…xCC3`**, the application fee, the webhook 200, tickets, the ledger, the gate.

### 6c. Card-path regressions
- [ ] Declined card (`4000 0000 0000 0002`) → Stripe shows the decline, no order,
  hold still active until it expires.
- [ ] A refund from the CA connected account's Stripe Dashboard → webhook → order
  `refunded_cents` set, tickets void at the gate.
- [ ] Hold expiry: hold seats, wait out the hold (35 min) → seats back on sale.
- [ ] Promo code (percentage and fixed) on a CA order → the discount appears on
  the Stripe amount.
- [ ] Free event → "Get my free tickets" works with no Stripe step.
- [ ] An organizer whose Stripe account is not ready → the event cannot take card
  payments (as before).

## 7. Global listings and Phase 2 (optional on staging)

- [ ] An organizer in **Egypt**: signs up, has no Stripe section, creates an
  event in **EGP**. Their paid event page shows **no Buy** and the notice
  "Tickets for this event are not sold online…". `/e/<slug>/tickets` redirects
  to the event page.
- [ ] Phase 2 still dark: Admin → Settings → Offline checkout is **off**.
  `node --test test/integration/offlineCheckoutDark.test.js` passes against staging.
- [ ] *(Only if testing Phase 2)* Switch it on, then:
  - reserve → instructions and reference → Mark as paid → tickets
  - reserve → expire (shorten the hours) → seats released
  - paid → refund → commission reversed
  - Door sale → void

  **Switch it off again** afterwards.

## 8. Invoices (staging)

- [ ] Record two door sales on the CA reserved event → Admin → Invoices → Raise → the
  organizer gets the "Commission invoice" email showing the instructions text.
- [ ] Record a part payment twice quickly (double-click) → **one** payment
  recorded; the same bank reference again → refused.
- [ ] Pay the rest → `paid`, the gate stays open; reverse a payment → reopened.
- [ ] Every step is listed in the invoice history and in Admin → Audit.

## 9. Rollback

| Situation | Action |
|---|---|
| Code bad, schema fine | Redeploy the previous commit. The migrations only add things, so older code keeps working, **except** an old backend calling the old 7-argument `invoice_record_payment`: re-create that function from `20261115090000` if you roll the code back past `40a630b` |
| A migration fails | It runs in one transaction and rolls back by itself; fix the cause and re-run it |
| A migration applied but wrong | Restore the step-1 backup (no down-migrations). For `20261121090000` only: the CA/US CHECKs can be re-added by hand while every organizer and event is CA/US |
| Offline checkout misbehaving | Admin → Settings → Offline checkout **off** (takes effect on the next request) |
| Card payments must stop | `PAYMENTS_STRIPE_ENABLED=false` and restart, or switch card off per country in Settings |

**Done when** sections 2 to 6 and 8 are all ticked on staging, with screenshots
of 6a and 6b (Stripe dashboard plus order) attached to the release notes.
