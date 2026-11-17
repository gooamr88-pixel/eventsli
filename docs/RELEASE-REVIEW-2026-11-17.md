# Global launch — release review and findings (2026-11-17)

Nothing in this review was committed, pushed, migrated in production or
deployed by me. Two new files are uncommitted: `backend/scripts/migration-gap.js`
and `backend/test/integration/offlineCheckoutDark.test.js`.

---

## 0. Urgent: Phase 1 and Phase 2 are already live in production

- Commit **`40a630b` "scghxbn"**: 100 files, authored under your git identity
  on 2026-11-17 at 07:45 +02:00. It contains **Phase 1 and Phase 2 together**
  and is **pushed to `origin/main`**.
- **Production is running it.** Read-only checks:
  - `/api/v1/health`: the process started about 2 minutes after that commit
    (uptime 30,336 s at 14:12 UTC).
  - `/public/markets`: returns **236 countries**, `card: ["CA","US"]`. That is
    new code, and its setting shows `20261121090000_global_markets` has run.
  - `/public/offline-payments/<id>`: answers with the Phase 2 message "That
    reservation was not found." Phase 2 routes are deployed.
  - A live CAD event (`starlight-symphony-gala-2027`) is `purchasable: true`,
    `card: true`; display-only listings have no Buy button, as before.
- **Unknown, and it matters now:** whether `20261121100000` and
  `20261122090000` are applied in production. The running code reads their
  columns. If they're missing:
  - **organizer event pages** fail (`events.offline_payment_hours`)
  - the **Door sales list** fails (`orders.manual_source`)
  - **admin "Record payment"** on invoices fails (the new
    `invoice_record_payment` signature)
  - **void/refund** and the **mobile money** method type fail

  Run `node scripts/migration-gap.js` on the server now (read-only), or this SQL:

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='offline_payment_hours') AS phase2_migration,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_payments' AND column_name='idempotency_key') AS invoice_fix_migration,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='markets') AS global_markets_migration;
```

- **Phase 2 is still dark in production either way.** The setting is
  `enabled:false` if the migration ran, or absent (treated as off) if not.
- **Phase 2 pieces visible to organizers even while off:**
  - the **Offline payments** item in each event's menu (it shows "not switched
    on" and the payment log)
  - **Refund / Void** buttons on Door sales
  - the **Mobile money** method type
  - an **Offline checkout** card in Admin → Settings that a super admin can
    switch on

  If you want those hidden until launch, that's a small change. Your call.

---

## 1. Durable Phase 1 snapshot

**Location:** `D:\Projects\eventsli\.snapshots\` (inside the project folder;
git-ignored through `.git/info/exclude`, a local setting that isn't committed,
so `git status` stays clean).

| Path | What it is |
|---|---|
| `.snapshots/phase1/phase1-tracked.patch` | Phase 1 changes to tracked files, against `05a31fe` (the commit before `40a630b`) |
| `.snapshots/phase1/new-files/` | Phase 1's new files, at their repo paths |
| `.snapshots/phase1/untracked-files.txt` | List of those new files |
| `.snapshots/phase1-tree/` | A **complete, runnable Phase 1 tree** (a git worktree of `05a31fe` with the patch and files applied; no commit) |

- **One hardening applied to the snapshot:** Phase 1's `purchasability.js` no
  longer reads the `offline_checkout` setting. As built, it would have offered
  Buy again on manual-payment events if that setting were ever switched on
  while only Phase 1 was deployed.
- Since `main` already contains both phases, the snapshot is your route to a
  Phase 1-only build if you ever need to roll Phase 2 back out. Example: a
  branch from `05a31fe` plus the snapshot, then cherry-pick anything later.

## 2. Evidence Phase 1 is independent of Phase 2

All run on the Phase 1 tree:

| Check | Result |
|---|---|
| Phase 2 identifiers in Phase 1 code (`offline_payments`, routes, `PayOptions`, `payment_audit`, `mobile_money`, `manual_source`…) | **None**, after the hardening above |
| Backend unit tests | **627/627** |
| Integration tests against a database with **Phase 2 stripped out** (tables, columns and functions dropped; the 3 redefined functions restored to their exact pre-Phase 2 versions) | **455/455** |
| Phase 2 API routes on the Phase 1 build (public and signed-in organizer) | **all 404** |
| Phase 1 settings schema | has no `offline_checkout` key, so it can't be switched on through the API |
| Phase 2 frontend routes (`/checkout/offline`, `/organizer/events/[id]/offline`) | not present |
| Re-applying `20261122090000` onto the Phase 1-only database | applied cleanly; the resulting schema is **identical** to before (pg_dump diff: only random session tokens differ) |

## 3. Confirmation Phase 2 stays inaccessible while off

New test `offlineCheckoutDark.test.js`, **4/4**. It uses a CA event that
accepts manual payment, from an organizer with a bank-transfer method, with
the setting off:
- event page: `payments = {card:true, manual:false}`
- checkout options: `{card:true, available:false}`
- `POST …/offline` returns **503 FEATURE_DISABLED**. No offline payment row, no
  terms acceptance, and the hold isn't extended.
- the public (anon) database key can't read `offline_payments` or
  `payment_audit`, or call any offline function
- the organizer view reports `enabled:false` with nothing to act on

Plus the existing flag-off test in `offlineCheckout.test.js`. Full suite:
**472/472**.

## 4. Production migration gap

I have **no read access to the production database** (by design; I didn't use
the owner-notes credentials). What's known:

| # | Migration (apply in this order) | Depends on | Risk | Production evidence |
|---|---|---|---|---|
| 1 | 20261108090000_checkin_v2 | base, 20261106 | low: adds ticket columns and check-in v2 | unknown |
| 2 | 20261108100000_checkin_app_api | 1 | low: session columns for the app | unknown |
| 3 | 20261109090000_door_list_search | 2 | low: functions | unknown |
| 4 | 20261110090000_offline_manifest | 3 | low: redefines `touch_tickets_on_order_status` | unknown |
| 5 | 20261111090000_venue_map_seat_integrity | 4 | **medium: redefines `fulfill_checkout`** (the card fulfilment path) | unknown |
| 6 | 20261112090000_seating_pricing_integrity | 5 | **medium: new table pricing; redefines `record_manual_sale`**, price-change triggers, check-in | seat map serves `tierId` → likely present |
| 7 | 20261113090000_ticket_type_details | 6 | low | **present** (tier `details` served) |
| 8 | 20261114090000_invoice_delivery | 7 | low | unknown |
| 9 | 20261115090000_invoice_and_gate_control | 8 | **medium: invoice money columns and functions** | unknown |
| 10 | 20261116090000_sms_platform | 9 | medium: large; many tables and a 243-country seed | unknown |
| 11 | 20261117090000_sms_consent_kinds_and_organizers | 10 | low | unknown |
| 12 | 20261118090000_scan_attribution_and_retention | 11 | **medium: adds the scan-retention job (deletes old scans by policy)** | unknown |
| 13 | 20261119090000_vip_events | 12 | low | **present** (`/public/vip-events` works) |
| 14 | 20261119100000_sponsor_logo_size | 13 | low | unknown |
| 15 | 20261120090000_purchase_signatures | 14 | **high if missing: card checkout records the signature and fails closed** | unknown, so **check first** |
| 16 | 20261121090000_global_markets | 6 (`log_price_change`), base CHECKs | medium: validates the foreign keys; opens every country | **ran** (236 countries) |
| 17 | 20261121100000_invoice_payment_idempotency | 9 | **high if missing: admin Record payment fails** on current code | unknown, so **check now** |
| 18 | 20261122090000_offline_checkout | 9, 16 | **high if missing: organizer event pages and Door sales fail** on current code | unknown, so **check now** |

- Everything before `20261108090000` was in the 2026-11-06 production release
  (`55a408f`, per `docs/PRODUCTION-ROLLOUT.md`).
- **`migration-gap.js`** reports, for each of the 18:
  - *recorded* (in `schema_migrations`)
  - *present* (a fingerprint object exists, so SQL-editor applies are caught too)

  It lists anything missing in order, inside a read-only transaction.
  Fingerprints were validated on a database with all 18 applied.

## 5. Canadian and US card flows: evidence they're intact

**Real Stripe test-mode purchases, run today** through the full UI on the
current code: event page → Buy → hold → checkout → sign → Stripe Checkout
(test card) → back → success page → tickets.

| | Canada | United States |
|---|---|---|
| Total | CA$51.80 (2 × CA$25 + CA$1.80 service fee) | US$26.06 (US$25 + US$1.06) |
| Stripe charge | `succeeded`, **CAD**, on connected account `acct_1UYeuYATUrLCxbN9`; billing country CA | `succeeded`, **USD**, on `acct_1UYeucAJG8Jow2C3`; billing country US |
| Eventsli application fee | 75 (1.5%) | 38 (1.5%) |
| Order | `paid`, `stripe`, `direct`, CAD, account matches | `paid`, `stripe`, `direct`, USD, account matches |
| Tickets / hold / ledger | 2 valid / converted / sale + commission | 1 valid / converted / sale + commission |

**Limits of this evidence:**
- Fulfilment ran through the success page's session check (`fulfillFromSession`).
  The **webhook** route couldn't be exercised locally: Windows Application
  Control blocks the Stripe CLI. The webhook code (`paymentController.js`,
  `checkoutSessions.js`) is **unchanged** since `05a31fe`. Staging step 6
  checks webhook delivery.
- The test card was US-issued for both. Staging uses Canada's test card.
- Local test data was deleted afterwards; the test payments remain in Stripe
  test mode.

**Code changes since `05a31fe` that touch these flows** (each covered by the
purchases above and the 472 integration tests):

| Change | Effect on CA/US |
|---|---|
| `purchasability.js` + hold endpoint refuse "no way to pay" | For CA/US with `accepts_stripe` it gives `card=true`, so the hold is allowed (pinned by a test) |
| `stripeService.organizerCanReceive` adds a country-card check before Stripe | CA and US are in `card`, so it passes. **Risk:** an admin unticking Card for CA or US stops card sales at once (intended) |
| `organizerController` onboarding refuses where card is off | No change for CA/US |
| `connectModel.accountCreateBody` allows the 44 Stripe countries | CA and US unchanged |
| `checkoutController.createSession` refuses if an offline payment awaits | Never true while Phase 2 is off |
| `pricingService.quoteReservation` gains an `offline` option | Default path unchanged (same totals seen in the test purchases) |
| `money.js` and frontend money: minor-unit decimals | 2 decimals for CAD/USD, so identical |
| `claim_promo_code` fixed discounts scaled by currency | ×100 for CAD/USD, so identical |
| `CheckoutClient` payment choice | Hidden unless offline is available; card button and text unchanged (seen in test) |
| `discoveryController` payments / purchasable | CA ticketed event: purchasable, card true (seen in production) |
| Migrations 5, 6 and 16 redefine payment-adjacent functions | Covered by integration tests; staging step 6 re-checks |

## 6. Invoice system audit

### Three different things — don't treat one as another
1. **Issued:** an admin clicks Raise. The invoice row records the amount owed,
   and the organizer is emailed. Nothing has been collected.
2. **Payment recorded:** an admin enters an amount they say arrived. Stored as
   an `invoice_payments` row, a ledger settlement and an `invoice_events`
   entry. That is **an assertion by an admin, not proof of funds.** There is
   no bank reconciliation, statement import or two-person check.
3. **Funds confirmed received:** only your bank statement proves it. The
   organizer's uploaded receipt (`proof_url`) is the organizer's claim, and
   it's reviewed by an admin.

### Verified
| Requirement | Status |
|---|---|
| Unique invoice number | ✅ `INV-YYYYMMDD-<event8>-<n>`, unique constraint |
| Issue date / due date | ✅ `issued_at`, `due_at` (+ original due date, admin-changeable, audited) |
| Amount = commission + its tax on paid manual orders not yet invoiced | ✅ from the manual ledger. Checked locally: on every event, ledger commission equals order commission |
| One unpaid invoice per event | ✅ |
| Currency 0/2/3 decimals | ✅ amounts are integer minor units; emails, admin UI and payment input use the currency's decimals (fixed in this release). The overpayment message no longer says "cents" |
| Partial payments | ✅ `paid_cents`, balance computed; status stays open/overdue until fully paid |
| Duplicate payment / overpayment | ✅ row lock + over-balance refusal + **idempotency key + duplicate-reference refusal** (new). Tested: 2 simultaneous submits give 1 payment and 1 audit row |
| Paid / overdue / waived / void / reopened / reversed | ✅ statuses `open, submitted, paid, overdue, waived, void`; reversal and reopen supported |
| History of every action | ✅ `invoice_events` (13 kinds: raised, reminder, overdue, receipt submitted/rejected, due changed, payment recorded/reversed, settled, waived, reopened, voided, note), append-only guard; plus `admin_audit` with the admin's reason |
| Emails | ✅ issued, reminder, overdue, settled, updates, receipt to admins (sent only when `BREVO_API_KEY` is set) |
| Overdue enforcement | ✅ hourly job; gate lock policy (grace, enforcement switch) |
| Tests | ✅ invoice suites **46/46** |

### Gaps (not built)
| Gap | Why it matters |
|---|---|
| **No invoice PDF / download / printable invoice** | Organizers abroad often need a formal invoice for accounting and bank transfers |
| **Invoice lacks a legal invoice layout:** no Eventsli legal name, address or business/GST number; no organizer legal name, address or tax ID; **no sales amount**; **commission and tax not shown separately** (one total); no tax rate | Required for a valid tax invoice in Canada (GST/HST) and many countries |
| **Commission tax defaults to 0%** (`commission_tax_pct`) | GST/HST likely applies to Canadian organizers; foreign organizers may be zero-rated or reverse-charge. Needs an accountant's rule per country |
| **Invoices are in the event's currency** (EGP, NGN, JPY…) | Eventsli must be able to receive them, or invoicing in USD/CAD needs an FX rate captured at issue (not built) |
| **One free-text payment-instructions field** for all countries and currencies | No per-currency bank details; no IBAN/SWIFT structure |
| **No "refunded" invoice / credit note** | After an organizer's refund reverses commission on a paid invoice, the ledger goes negative (a credit) with no credit note and no payout path |
| **No automatic raising** | An admin must remember to raise each event's invoice (there is a "Ready to invoice" list) |
| **No bank reconciliation** | Recording a payment is trusted entirely; consider requiring a reference, or a second admin above a threshold |
| **Offline-checkout commission (Phase 2)** | Flows into the same invoices; same gaps |
| Local test data | 16 local events have ledger rows whose test invoices were deleted by test cleanup. Not a product bug, but `admin_uninvoiced_commission` will show them locally |

### Production configuration needed before international invoice collection
- Set Admin → Settings → Door-sale invoices → **How organizers pay Eventsli**,
  with international details (IBAN/SWIFT, beneficiary, currency accepted, who
  pays bank fees).
- Confirm `BREVO_API_KEY` and the sender are set (invoice emails).
- `SCHEDULER_ENABLED=true` on exactly the API instance(s) that should run
  overdue and reminder jobs (they use leader locks).
- Decide the commission tax rate(s) and set per-event defaults.

## 7. Remaining legal, financial and business decisions (owner)

1. **Terms of Service (ticket terms, organizer agreement):**
   - governing law and venue
   - consumer refund rights by country
   - organizer as seller abroad
   - offline reservations (deadline, paying the organizer, cancellation)
     before Phase 2 is switched on
2. **Privacy policy:**
   - GDPR / UK GDPR and target-country laws (Egypt PDPL, Saudi PDPL, Brazil
     LGPD, India DPDP…)
   - international transfer mechanisms (SCCs / IDTA)
   - rights and supervisory authorities; EU/UK representative / DPO if required
   - retention by jurisdiction
   - age of consent
   - The page's own header says it hasn't had legal review.
3. **Sanctions:**
   - confirm the excluded list (BY, CU, IR, KP, RU, SY). **Syria** is eased
     by Canada (Feb 2026) and its US status reportedly changed.
   - Crimea, Donetsk and Luhansk inside Ukraine can't be blocked by country code.
   - screening of organizers and payers against consolidated lists
4. **Organizer verification (KYC/AML):** organizers who never connect Stripe
   aren't identity-checked. Decide the minimum (ID, business registration,
   sanctions screening) before they can sell or owe commission.
5. **Commission taxation:**
   - GST/HST on commission for Canadian organizers
   - zero-rating / reverse charge for foreign organizers
   - VAT registration thresholds abroad
   - withholding tax some countries apply to outbound service payments
   - **accountant sign-off**
6. **Invoice currency:** local currency vs USD/CAD with an FX rule. Who bears
   FX and bank charges?
7. **International banking details:** which account(s) receive which
   currencies (multi-currency provider?), and what the instructions text says.
8. **Collecting commission where Stripe isn't available.** Options:
   - (a) bank transfer to an international account (current design)
   - (b) a payment link from a provider that operates there
   - (c) mobile-money or local agents
   - (d) prepaid deposits or credit limits per organizer
   - (e) block selling once an invoice is overdue (the gate lock exists)

   Also decide the credit risk you accept per organizer.
9. **Launch scope and visibility:** keep Phase 2 dark; hide its organizer
   surfaces (nav item, void/refund, mobile money) until launch, or leave them?
10. **Per-country card enablement:** which Stripe countries to test-onboard,
    and when.

---

## Checklist

### Done (verified, nothing committed by me)
- [x] Durable Phase 1 snapshot + runnable Phase 1 tree (`.snapshots/`)
- [x] Phase 1 independence: no Phase 2 code; 627 unit + 455 integration on a Phase 2-free database; Phase 2 routes 404
- [x] Phase 2 dark: 4/4 dark tests; full suite 472/472
- [x] Phase 2 migration applies onto Phase 1-only schema → identical result
- [x] Real test-mode purchases: CAD (Canada) and USD (US) on the organizers' own accounts with the correct application fee
- [x] Production read-only probes; migration fingerprints; read-only gap script
- [x] Invoice audit; local ledger, invoice and order consistency check

### Remaining (engineering, if you want them)
- [ ] Invoice PDF / formal tax-invoice layout (legal names, tax IDs, sales, commission vs tax lines)
- [ ] Per-currency payment instructions; optional USD/CAD invoicing with an FX rate
- [ ] Credit note / negative-balance handling after refunds
- [ ] Optionally hide Phase 2 organizer surfaces while the setting is off
- [ ] Phase 2 follow-ups (expiry emails, general-admission door sales)

### Owner-required
- [ ] **Now:** run `node scripts/migration-gap.js` on production (read-only) and confirm migrations 15, 17 and 18
- [ ] Approve: committing the 2 new files; applying any missing production migrations (in order, after a backup)
- [ ] Run `docs/STAGING-CHECKLIST.md` (CA and US test purchases with webhooks)
- [ ] Legal and financial decisions in §7
