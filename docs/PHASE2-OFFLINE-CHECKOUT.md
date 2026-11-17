# Phase 2: international offline checkout — implementation report (2026-11-17)

Nothing has been committed, pushed, migrated in production or deployed.

**Ships dark.** It is off until a super admin turns on **Admin → Settings →
Offline checkout**. With it off, every offline entry point answers
`FEATURE_DISABLED`, the event page and checkout behave exactly as in Phase 1,
and organizers see no offline-only copy.

## How it works

1. **Buyer** picks seats or tickets → checkout offers **Pay the organizer
   directly**, alongside card where card is on, with the organizer's methods
   (bank transfer, cash, **mobile money**, other).
2. The buyer accepts the terms and signs (same guards as card) → the hold is
   **extended to the payment deadline**, the price is frozen, and they get a
   **reference code**. Their page and email show the amount, the organizer's
   instructions and the deadline.
3. **Organizer** → event → **Offline payments** → **Mark as paid** (amount +
   their transfer reference) → the order is created, **tickets are issued and
   emailed**, and commission is added to what the organizer owes.
4. **Not paid in time** → the expiry sweep closes it and releases the seats or
   tickets.
5. **Void** (recorded in error) or **Refund** (money returned), for these orders
   **and door sales**: tickets void, stock back on sale, commission reversed.

## Requirements → what was built

| Requirement | Implementation | Proven by |
|---|---|---|
| Temporary order and seat reservation | `offline_payments` row per reservation; reservation stays `active` until the deadline; seats stay `held`; GA stock counted as held | integration tests; browser run |
| Configurable payment expiration | Platform setting (`payment_hours`, default 48; `min_hours_before_event`, default 2); per-event override `events.offline_payment_hours` (1–336, Event details) | `dueAt` unit logic; reserve test checks the hold equals the deadline |
| Organizer instructions shown to buyers | Snapshot of the method (kind, label, instructions) **as the buyer saw it**; shown after reserving, on the token-keyed page and in the email | test: instructions present; method list hides them before reserving |
| Bank transfer, cash, mobile money | `mobile_money` added to method kinds (database CHECK, API, UI); e-Transfer only offered in Canada | test uses a mobile-money method |
| Secure Mark as paid | Organizer-only (`verifyEventOwner`) **and** the function checks organizer ownership; the payment must belong to the event in the URL | test: another organizer / wrong event refused |
| No duplicate confirmations | Row lock (`FOR UPDATE`); a second confirmation returns the first order with `duplicate: true`; the UI sends a per-dialog key | test: **two simultaneous confirmations → one order** |
| No overpayment | Amount must equal the amount owed exactly; more or less is refused with an explanation (partial payment issues nothing) | test: ±1 minor unit refused |
| Tickets only after confirmed payment | No order or ticket rows exist until `offline_confirm`; check-in already refuses non-paid orders | test: 0 orders before, 2 tickets after |
| Expiry and automatic seat release | `expire_stale_reservations` (existing sweep, extended) closes awaiting payments and audits them as `system` | test: hold back to 0, late confirm refused |
| Void and refund | `order_void_offline`: refused once anyone on the order is admitted; full refund only; idempotent | tests: offline order refund; door-sale void; scanned-ticket refusal |
| Correct commission adjustments | Confirm writes commission (+ tax) to the manual-channel ledger, the account invoices are raised from; void or refund writes the reversal, once | tests: owed +10% on confirm, −10% on refund, unchanged on a repeat |
| Complete audit logs | `payment_audit` (append-only, trigger-enforced), written **inside** each function: reserved, confirmed, cancelled, expired, voided, refunded, plus **every door sale** (trigger) — with amount, currency, actor, role, reason | tests: trail order per payment; update or delete refused |
| Events without seat maps | Offline checkout works for general admission: GA holds via `hold_general`, stock from paid, non-void tickets | **all** offline integration tests use a GA event; browser run was GA |
| Partial invoice payment concurrency | Separate migration (`20261121100000`, shipped with Phase 1): idempotency key + duplicate bank-reference refusal | test: two simultaneous submits → one payment, one audit row |

## Safety interlocks with card checkout

- A hold awaiting an offline payment **cannot open a card session**
  (`pendingFor` check → 409).
- A hold that already has a card session **cannot be reserved offline**
  (`offline_reserve` refuses).
- So the two can never both be open on one reservation: no double payment.
- Releasing a hold (buyer "start again") also cancels its awaiting offline
  payment, which is audited.

## Database: `20261122090000_offline_checkout.sql`

- **New:**
  - tables `offline_payments` and `payment_audit` (RLS on, service role only)
  - setting `offline_checkout` (off)
  - columns `events.offline_payment_hours`, and `orders.manual_source`
    (door / online), `voided_at`, `voided_by`, `void_kind`, `void_reason`
  - method kind `mobile_money`
- **Functions:** `offline_reserve`, `offline_confirm`, `offline_cancel`,
  `order_void_offline`, `offline_payment_pending`, `payment_audit_write`; the
  door-sale audit trigger.
- **Redefined** (same behaviour plus offline handling):
  - `expire_stale_reservations` and `release_reservation`
  - `raise_commission_invoice`: now counts only **paid** manual orders, so
    voided orders don't count as sales.
- **Independent of Phase 1's migrations:** it references none of their
  objects, so it applies on top of either.
- Verified locally: applies, re-runs, and rolls back cleanly.

## Tests

- **Integration: 468/468**, including 12 new offline-checkout tests, 1 door-sale
  void test and 1 invoice-concurrency test. Backend unit 627/627. Frontend
  892/892; lint clean.
- **Browser, end to end on localhost** (feature switched on locally, then off again):
  - guest buyer reserved 2 GA tickets in an Egyptian event (EGP 1,500)
  - got reference `5772-537F` with the Vodafone Cash instructions and deadline
  - the organizer saw it under Offline payments and marked it paid
  - the payment log showed both steps
  - the buyer's page switched to "Payment confirmed"
  - "Open my tickets" showed 2 valid tickets
  - all demo data was deleted afterwards
- **Bug found and fixed** by that browser run: the offline price lines came
  back in the wrong shape and crashed the checkout. A test assertion now
  covers it.

## Not done / known limits (Phase 2)

| Item | Effect | Suggested fix |
|---|---|---|
| No email when a reservation **expires** (or a reminder before the deadline) | The buyer sees it on their page; there is no email | A scheduler job reading `payment_audit` `offline.expired` rows |
| **Door sales** for general admission (quantity, no seats) | Organizers with GA events can sell offline online, but can't record a walk-up GA sale | Extend `record_manual_sale` with tier + quantity |
| **Partial** payments and partial refunds | By design: exact amount only, full refunds only | Product decision |
| Payment arriving **after** the deadline | Can't be confirmed; the buyer must reserve again | Optional "reinstate if still available" |
| Refund after the commission invoice was **paid** | The ledger goes negative (a credit); the next invoice nets it; no automatic credit note or payout | Admin process or credit-note feature |
| No admin console page for offline payments | Admins can act through the organizer pages (the owner check lets admins through) | Admin list if needed |
| "Mark as paid" trusts the organizer | No proof upload; the organizer is the seller and owes commission either way | Optional receipt upload |
| Ticket terms don't yet describe offline reservations (deadline, paying the organizer, cancellation) | Legal gap | Counsel: add to buyer terms before enabling |
| `payment_audit` rows survive deletion of the event they describe | Intentional (append-only) | — |

## Deploying independently

- **Phase 1** is the snapshot taken before any Phase 2 work: a patch of
  tracked files plus copies of its new files (in my session scratchpad; it can
  be regenerated from the file lists below if that is cleared). It includes
  both Phase 1 migrations and the invoice fix.
- **Phase 2 only (new files):**
  - `supabase/migrations/20261122090000_offline_checkout.sql`
  - `backend/services/offlineCheckoutService.js`
  - `backend/controllers/offlineCheckoutController.js`
  - `backend/test/integration/offlineCheckout.test.js`
  - `frontend/src/app/checkout/[reservationId]/PayOptions.jsx`
  - `frontend/src/app/checkout/offline/[id]/page.jsx`, `OfflinePaymentClient.jsx`
  - `frontend/src/app/organizer/events/[id]/offline/page.jsx`, `OfflinePayments.jsx`, `OrderUndo.jsx`
- **Changed only by Phase 2:**
  - `checkoutController.js`, `eventController.js`, `eventRoutes.js`
  - `accessTokens.js`, `emailService.js`, `eventRules.js`, `pricingService.js`
  - `CheckoutClient.jsx`, `EventDetailsEditor.jsx`, `DoorSales.jsx`, `organizerNav.js`
- **Changed in both phases** (the Phase 1 version is in the snapshot):
  - `manualPaymentController.js`, `organizerController.js`, `organizerRoutes.js`,
    `publicRoutes.js`, `purchasability.js`, `settingsSchema.js`
  - `invoiceControl.test.js`, `Settings.jsx`, `DetailsSections.jsx`, `PaymentMethods.jsx`
- **Order:** Phase 1 migrations → Phase 1 code → (later) the Phase 2
  migration → Phase 2 code → test on staging → switch on in Admin → Settings.
- Phase 2 **code** needs the Phase 2 **migration** (new columns). The Phase 2
  migration does not need Phase 2 code, so it can be applied early and stays dormant.
- Suggested commits once approved: (1) Phase 1 from the snapshot, (2) Phase 2
  on top. Each is deployable on its own.

## Owner actions before switching Phase 2 on

1. Counsel: buyer-terms wording for offline reservations; the Phase 1 legal
   items still apply.
2. Decide the default payment window (48 h) and the cut-off before events (2 h).
3. Make sure the organizer and buyer emails are delivered (`BREVO_API_KEY` in production).
4. Run one staging round-trip: reserve → mark paid → tickets; reserve → expire;
   paid → refund. Then switch it on.
