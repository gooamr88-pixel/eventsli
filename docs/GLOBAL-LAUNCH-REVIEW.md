# Global launch — production-readiness review (2026-11-17)

Scope: the global markets change (`docs/GLOBAL-MARKETS.md`, migration
`20261121090000_global_markets.sql`). Nothing in this review was committed, pushed
or deployed, and no production migration was applied.

**Verdict:** card selling in Canada and the US is unchanged and ready. Opening
other countries for **sign-up and listings** is ready. **Offline selling in
countries without card payments is not ready for self-serve buyers.** Read
finding A before deciding the launch scope.

---

## Finding A: what "offline payments" actually is today (blocker)

There is **no buyer-facing "reserve, pay the organizer, organizer confirms"
flow.** "Manual payments" in this codebase means **Door sales**: the organizer is
paid first, in person or however they arrange it, and then records the sale in
their dashboard. Recording the sale issues the tickets.

The consequences for a country without card payments, such as Egypt:

1. **Buyers cannot buy online.** On the event page a buyer can pick seats and
   reach checkout, then gets *"This event does not take card payments. See the
   event page for how to pay"*. The event page shows no instructions. That is a
   dead end.
2. **The organizer's payment instructions are never shown to buyers.** They are
   stored, and they are counted to decide whether an event may go on sale. The
   Payments page's claim *"Your own instructions, shown to buyers at checkout"*
   predates this change, and it is not true.
3. **General-admission events cannot be sold offline at all.** `POST
   /events/:id/manual-sales` requires seat IDs or a table. An event with no
   seat map has no offline sale path.

I corrected the copy **I** had added earlier, which described a confirm-at-checkout
flow that does not exist (Payments page notice, sign-up hint, How it works FAQ).
I left the older claim in point 2 for your decision.

**To sell offline to the public, these need building:**
- a pending order type with a hold and expiry
- buyer-facing payment instructions at checkout
- an organizer "mark paid" action that is idempotent and audited, and issues
  tickets only then
- quantity-based door sales for general admission
- void and refund for door sales

---

## 1. Audit logs for manual payment confirmation

| Field | Door sale (organizer records it) | Commission invoice payment (admin records it) |
|---|---|---|
| Organizer ID | `orders.organizer_id` | via `invoices.organizer_id` |
| Order / invoice ID | `orders.id` | `invoice_payments.invoice_id` |
| Amount | `orders.buyer_total_cents`, `commission_cents` | `invoice_payments.amount_cents` |
| Currency | `orders.currency` | `invoice_payments.currency` |
| Timestamp | `orders.paid_at` | `received_at`, `recorded_at` |
| Who did it | `orders.recorded_by` | `recorded_by`, plus an `admin_audit` row with the reason |

- **Met for invoices:** every admin action is written to `admin_audit`, and a
  failed write is logged loudly.
- **Partly met for door sales:** every field is stored on the order row, which
  cannot be edited through the product. There is **no `admin_audit` entry**,
  only an info log line. That entry is a small change; recommended alongside
  finding A.

## 2. Payment integrity

- **Same seat sold twice:** prevented. `record_manual_sale` locks the seats
  (`FOR UPDATE SKIP LOCKED`), requires `status = 'available'`, and marks them
  `sold` in the same transaction. A double-click gets `SEAT_UNAVAILABLE`.
- **Tickets before payment:** the order is created `paid`, and the tickets are
  inserted in the same transaction. There is no unpaid state, so tickets can't
  exist without a recorded payment. That only holds because finding A's
  pending flow doesn't exist yet.
- **Invoice payments:** the invoice row is locked. Payments on paid, void or
  waived invoices are refused, and so is anything above the balance.
- **Gaps:**
  - No idempotency key. Two identical *partial* invoice payments, both under the
    balance, would both be recorded.
  - General-admission door sales don't exist, so their integrity is untested.

## 3. Refunds and cancellations (offline)

- **No void or refund action exists for a door sale.** A mistaken sale stays
  `paid`, its tickets stay valid, and its commission stays owed.
- **Cancelling an event** (admin only) locks scanning and moves no money. The
  terms make tickets final and leave refunds between organizer and buyer.
- **Commission adjustment is manual:** an admin can reverse a payment, waive,
  void or reopen an invoice (all audited). Nothing credits commission
  automatically when an organizer refunds a buyer.
- **Needed:** void or refund a door sale, credit its commission and invalidate its
  tickets, in one audited transaction.

## 4. Commission collection from international organizers

- Invoices and their emails print one free-text setting, **"How organizers
  pay Eventsli"** (`manual_invoice.payment_instructions`). It is **not set**
  locally. I can't see production.
- **Invoices are issued in the event's currency** (EGP, JPY, KWD…). Eventsli
  needs a way to *receive* those currencies. Some have exchange controls (Egypt,
  Nigeria, Argentina…). Alternatively, invoicing in USD or CAD needs code (a
  conversion rate captured at issue), which doesn't exist.
- I **cannot verify** that international banking works: no bank details are
  configured, and receiving funds is outside the code. This is an owner action.

## 5. Currency consistency (0, 2 and 3 decimals)

Verified or fixed:

| Area | State |
|---|---|
| Ticket prices, typed and shown (tiers, tables, AI drafts, emails, SEO data) | Fixed: uses the currency's decimals |
| Commission, tax, fees (`utils/money.js`) | Integer maths on minor units; percentages round to whole yen or fils. Correct |
| Percentage promo codes (SQL) | Correct |
| **Fixed promo codes** (SQL `claim_promo_code`) | **Fixed:** was ×100 for every currency, so ¥10 off was ¥1,000 off |
| Invoices, invoice payments, door-sale commission (SQL) | Integer sums per event, single currency. Correct |
| Reports (`platform_overview`, organizer dashboards, admin sales) | Grouped by currency or per event; no cross-currency sums |
| Stripe Checkout amounts | Minor units passed straight through, which is Stripe's own unit (JPY = whole yen) |
| Admin audit: price changes | **Fixed:** entries now carry the currency; older entries show as before |
| Stripe refunds | Minor units from Stripe, unchanged |

Remaining (minor):
- The `stripe_cost` estimate is one global rate.
- The invoice overpayment message says "cents".
- The homepage's smart search turns "under 50" into 5000 minor units, which is
  wrong for yen.

## 6. Country restrictions

- **Excluded:** Belarus, Cuba, Iran, North Korea, Russia, Syria.
  - **Syria needs a decision:** Canada eased its Syria sanctions in February 2026,
    and US status was reported changing in 2026.
  - **Not blockable by country code:** Crimea, Donetsk and Luhansk are inside
    Ukraine, which is open.
  - **No organizer screening exists** for offline-only organizers. Stripe does
    KYC only for card organizers. Eventsli will receive commission from
    unverified businesses abroad.
  - All three are counsel questions.
- **Stripe:**
  - 44 countries are card-capable: stripe.com/global's list minus the
    invite-only previews (India, Indonesia).
  - **Card is on only in CA and US**, the only countries verified end to end.
  - Stripe documents self-serve cross-border **payouts** from a Canadian
    platform to US/UK/EEA/CH only. It is **silent on direct charges** to accounts
    elsewhere, hence the per-country test-mode check before ticking **Card**.
  - Brazil has foreign-exchange controls.
- Enforcement points: sign-up (route plus open-country check), event creation,
  Stripe onboarding (refused before any account is created), every card
  checkout, and the database (foreign keys).

## 7. SEO and international discovery (remaining work)

- **"Near you"** already measures to venue coordinates when an event has them,
  but falls back to a 146-city North American table. **City-from-location**
  (`nearestCity`) uses only that table.
- English only: no `hreflang`, no localized pages, `en-US` money and date formats.
- The event listing API filters by `?country=` and `?city=`, but the public
  listing page has no country picker.
- Sitemap and event JSON-LD are correct for any currency (`priceCurrency`, price
  in major units).
- Smart search's price phrase assumes dollars (see 5).
- Fixed in this change: the home, events and How it works pages no longer say
  "Canada and the United States".

## 8. Legal readiness: sections to change before international launch

**Privacy policy** (`frontend/src/app/privacy/page.jsx`, not lawyer-reviewed per
its own header):
- *Which laws apply* (PIPEDA, Quebec, US states). Needs GDPR/UK GDPR, and the
  laws of target countries (e.g. Egypt PDPL, Saudi PDPL, Brazil LGPD, India DPDP).
- *Where data is stored / international transfers* (US servers, EU email).
  Needs transfer mechanisms (SCCs, UK IDTA) and per-country disclosures.
- *Your rights / complaints* (Canadian OPC, Quebec). Needs EU/UK supervisory
  authorities, an EU/UK representative if required, and a DPO if required.
- *Retention* ("in Canada generally six years"). Needs per-jurisdiction tax
  retention.
- *Getting paid* (Stripe only). Needs offline organizers' payment details and
  their commission payments.
- *Age* (16+). Check per country (e.g. GDPR consent ages).

**Ticket terms** (database `terms_versions`, buyer v1):
- *Who you are buying from*: the organizer as seller abroad, and offline purchases.
- *What you pay / Currency*: offline payment, no card involved.
- *Refunds / If the event is cancelled*: mandatory consumer rights by country
  (e.g. EU rules on cancelled events).
- *Missing*: governing law and jurisdiction, dispute resolution, language.

**Organizer agreement** (`terms_versions`, organizer v1):
- *3. What you pay us*: commission tax abroad (VAT/GST, reverse charge).
- *4. When you get paid*: offline organizers.
- *5. Manual sales and invoices*: invoice currency, FX, bank charges, who
  pays transfer fees.
- *6. Refunds* and *7. If you cancel*: offline refunds and commission credits.
- *8. Currency and exchange*: invoices in local currency.
- *Missing*:
  - sanctions and export compliance
  - KYC/AML for offline organizers
  - local permits and taxes as the organizer's responsibility
  - governing law
  - withholding tax on commission payments

**SMS terms**: country-by-country consent rules (the SMS module already
has per-country settings). Confirm with counsel.

**Contact page**: "a small team across Canada and the United States" describes
the team. Left as is.

---

## Tests

- The **two failing AI integration tests were unrelated**, and they are now fixed.
  - Their fixture event was "Friday November 13" (2026), and the draft validator
    correctly drops a start in the past. The same data passes with a clock set
    to 10 Nov.
  - The fixture now sits 60 days from today, with the words and the ISO date
    derived from one date (`backend/test/integration/aiCreator.test.js`).
- Current results:
  - backend unit 627/627
  - backend integration **450/450** (including 4 new global-markets tests)
  - frontend 892/892
  - frontend lint and static checks pass (5 files over the 500-line soft cap, as before)
  - the migration runs, re-runs and rolls back cleanly on the local database

---

## Checklist

### Completed (in the working tree, not committed)
- [x] 236-country markets table: backend, frontend, database (`markets` + foreign keys)
- [x] Per-country card switch (default CA/US) enforced at onboarding, checkout and readiness
- [x] Currency decimals across prices, emails, SEO, AI drafts and inputs
- [x] Fixed promo codes scale by currency (SQL)
- [x] Price-change audit entries carry the currency
- [x] Admin country editor (search, regions, bulk open, card per country)
- [x] Organizer sign-up guesses the country and explains currency and payments
- [x] Public copy no longer claims Canada/US only; my inaccurate offline-checkout copy corrected
- [x] Outdated AI tests fixed; all suites green
- [x] Local database brought up to date (12 pending migrations applied locally only)

### Remaining engineering (recommended before selling offline abroad)
- [ ] **Buyer offline checkout**: pending order, instructions, expiry, organizer "mark paid" (idempotent, audited), tickets on confirmation
- [ ] **Door sales for general admission** (quantity-based)
- [ ] **Void or refund a door sale** with commission credit and ticket invalidation
- [ ] `admin_audit` entry for every door sale
- [ ] Until then, hide "Buy" on card-off events instead of the checkout dead end
- [ ] Remove or make true "instructions shown to buyers at checkout" (Payments page)
- [ ] Optional: invoice in USD/CAD with a captured exchange rate
- [ ] Minor: per-country Stripe cost, invoice message wording, smart-search price unit, near-me city list

### Owner-required
- [ ] Decide launch scope: sign-up and listings only, or offline selling (needs the engineering above)
- [ ] Counsel: sanctions list (Syria; Crimea, Donetsk and Luhansk), organizer screening and KYC, every legal section in 8
- [ ] Decide invoice currency, and set international bank details in Settings → How organizers pay Eventsli
- [ ] Per country: Stripe test-mode onboarding, then tick Card
- [ ] Approve commit, then apply `20261121090000_global_markets.sql` in production, deploy backend and frontend together, run `verify-schema`
