-- ═══════════════════════════════════════════════════════════════════════════
-- Terms v1 — organizer and buyer.
--
-- ⚠ DRAFT. Written from the 27 business rules so the product can be built and
-- tested end to end. It has NOT been reviewed by a lawyer, and two clauses in
-- particular need that review before a single real ticket is sold:
--
--   1. "All sales are final" (BRD §09) against consumer-protection law in
--      Canada and the several US states the platform will sell into. A blanket
--      no-refund term is unenforceable in some of them, and an event CANCELLED
--      by its organizer is the case most likely to be treated that way.
--   2. Whether Eventsli's role as described here — collecting the buyer's money
--      and passing it on — matches how a regulator would classify it.
--
-- Publishing a v2 is one INSERT and one flag; this is written to be replaced.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO terms_versions (version, audience, body_md, is_current) VALUES
(1, 'organizer', $terms$
# Organizer Agreement

_Version 1 · Eventsli_

## 1. What Eventsli is, and is not

Eventsli is a platform. We list your event, sell tickets on your behalf, take
payment, and give you the tools to check people in at the door.

**We do not run your event.** You do. You are responsible for the event taking
place as advertised, for the venue, for the people who attend, and for anything
you promise them.

## 2. Approval

Every event is reviewed by us before it becomes visible to the public. We may
approve it or decline it. If we decline it, we will tell you why, and you can
change it and submit it again.

Approval is not endorsement, and it is not a check that your event is lawful,
licensed, or insured. That remains yours.

## 3. What you pay us

Three separate amounts, shown to you in full before you publish:

- **Eventsli commission** — a percentage of the ticket price. Set by us per
  event and shown on your event's settings page. You cannot change it; we can,
  and if we do it applies to tickets sold after the change, not before.
- **Payment processing fee** — what it costs to take a card payment. **You
  choose** whether this is added to the buyer's total or comes out of your
  proceeds. You make that choice per event.
- **Tax** — where tax applies to the ticket, it is added to the buyer's total
  and shown to them as its own line. You are responsible for remitting it.

Every one of these appears on your confirmation screen before you publish. You
cannot publish without seeing them.

## 4. When you get paid

For card payments, funds reach your connected payment account according to your
payment provider's own schedule. **We do not hold your money after your event.**

For payments you take directly — cash, transfer, or anything else outside the
platform — you still owe us commission on those sales. We will issue you an
invoice. See section 5.

## 5. Manual sales and invoices

If you record sales taken outside the platform, we calculate the commission owed
and invoice you for it.

- Payment is due **7 days** from the invoice date.
- If your event starts sooner than that, payment is due **at least 24 hours
  before your event begins**.
- You pay by bank transfer and upload proof. We confirm receipt.
- **If the invoice is not paid by its due date, ticket scanning for that event is
  switched off** until it is. Your account stays open and your other events are
  unaffected.

## 6. Refunds

Tickets sold through Eventsli are **final** unless you decide otherwise.

If you choose to refund a buyer, that is an arrangement between you and them.
We are not a party to it, we do not decide it, and we do not fund it.

This does not override any right a buyer has under the law where they bought.

## 7. If you cancel

You can cancel your event through the platform. When you do:

- Ticket sales stop and scanning is switched off.
- Tickets already sold are **not** deleted. Buyers can still see what they
  bought and that the event was cancelled.
- **Contacting your buyers is your responsibility**, as is any refund or
  compensation you agree with them.
- We show buyers that the event was cancelled and that financial arrangements
  are with you.

We may suspend an event for a breach of this agreement or a legal problem. That
is a different thing from cancelling: we suspend, you cancel.

## 8. Currency and exchange

Your event is priced in the currency of the country it is held in.

If that differs from the currency of your payment account, **any conversion
cost, exchange-rate movement, or fee arising from it is yours.** We do not carry
exchange-rate risk on your behalf and do not compensate for it.

## 9. Pricing

Set your prices before you sell. **Once a ticket has sold at a price, that price
is fixed** — for that ticket type, permanently. Buyers must get what they paid
for, and our records must reflect what was actually charged.

## 10. Ticket transfers

Buyers may pass a ticket to someone else **once**. You can switch this off for
your event.

## 11. What we can change

We administer the platform: event status, approval, fee and commission rates,
tax rates, purchase limits, scanning access, and the amounts owed to us. These
are set from our side and are visible to you.

## 12. Ending this agreement

Either of us may stop. Events already sold must still be honoured, and invoices
already issued must still be paid.
$terms$, true),

(1, 'buyer', $terms$
# Ticket Terms

_Version 1 · Eventsli_

## Who you are buying from

You are buying a ticket to an event run by an **organizer**, not by Eventsli.
Eventsli sells the ticket and takes the payment. The organizer runs the event.

If something goes wrong at the event, the organizer is who you deal with.

## What you pay

Before you pay, you will see, itemised:

- the ticket price,
- any tax,
- any service fee — some organizers absorb this instead of passing it on.

The total shown is the total charged. Nothing is added afterwards.

## Currency

Prices are shown in the event's currency and charged in that currency. If that
is not your card's currency, your bank may convert it and may add its own fee.
That is between you and your bank.

## Refunds

**Tickets are final.** Eventsli does not refund them.

If you need a refund, contact the organizer — their contact details are on the
event page. Any refund is their decision and their arrangement with you.

This does not affect rights you have under the law where you bought.

## If the event is cancelled

We will show you that it was cancelled, and your ticket stays in your account as
a record of what you bought.

**Any refund is arranged directly with the organizer.** Eventsli does not issue
it and does not fund it.

## Passing your ticket on

You can transfer a ticket to someone else **once**, if the organizer allows it
for that event. After that it cannot be transferred again. Both of you are told
when a transfer happens.

## Your ticket

Your ticket carries a code that is scanned at the door. It works once. Treat it
like cash: anyone holding it can use it.

## Your details

We give the organizer what they need to run the event and let you in. We do not
sell your details.
$terms$, true);
