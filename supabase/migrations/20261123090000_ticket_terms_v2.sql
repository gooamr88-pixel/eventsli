-- ═══════════════════════════════════════════════════════════════════════════
-- Ticket Terms, version 2 (owner request 2026-11-17).
--
-- ⚠ DRAFTED FOR COUNSEL REVIEW. Publishing this makes it the terms every buyer
--   accepts at checkout from then on. Have it reviewed before applying it in
--   production.
--
-- What changed from version 1:
--   · "Who you are buying from" was wrong for card sales since 2026-11-06:
--     the card payment goes to the ORGANIZER's own Stripe account (they are the
--     seller), not to Eventsli. Now says so.
--   · NEW "Paying the organizer directly (offline reservations)": the deadline,
--     that the money goes to the organizer, that tickets are issued only once
--     the organizer confirms the full amount, how to cancel, and what happens
--     to a late or partial payment.
--   · "Your details": the organizer receives name, email and phone to match an
--     offline payment.
--
-- Version 1 stays in the table — every acceptance recorded against it keeps
-- pointing at the exact text that buyer saw. Only `is_current` moves.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE terms_versions SET is_current = false WHERE audience = 'buyer' AND is_current;

INSERT INTO terms_versions (version, audience, body_md, is_current)
VALUES (2, 'buyer', $terms$
# Ticket Terms

_Version 2 · Eventsli_

## Who you are buying from

You are buying a ticket to an event run by an **organizer**, not by Eventsli.
The organizer is the seller and runs the event. Eventsli provides the ticketing
platform.

When you pay by card, the payment is processed by Stripe and goes to the
organizer's own account. When you pay the organizer directly (see below), the
payment goes to the organizer and never passes through Eventsli.

If something goes wrong at the event, the organizer is who you deal with.

## What you pay

Before you pay, you will see, itemised:

- the ticket price,
- any tax,
- any service fee — some organizers absorb this instead of passing it on.

The total shown is the total charged. Nothing is added afterwards.

## Currency

Prices are shown in the event's currency and charged in that currency. If that
is not your card's or your bank account's currency, your bank or payment
provider may convert it and may add its own fee. That is between you and them.

## Paying the organizer directly (offline reservations)

Some events let you reserve tickets online and **pay the organizer directly** —
for example by bank transfer, cash or mobile money — using the organizer's own
instructions.

- **Your tickets are held until the deadline shown** when you reserve. If the organizer has not confirmed your payment by then, the reservation ends automatically and the tickets go back on sale.
- **The payment goes to the organizer, not to Eventsli.** Eventsli does not receive, hold or refund it, and cannot confirm a payment on the organizer's behalf.
- **Pay the exact amount shown** and include the reference you are given, so the organizer can match your payment. Keep your own proof of payment.
- **Your tickets are issued only when the organizer confirms they received the full amount.** A partial payment does not issue tickets.
- **You can cancel an unpaid reservation** at any time before it is confirmed, using the link in your confirmation email. The organizer can also cancel an unpaid reservation.
- **If you have already paid** and the reservation is cancelled or ends, or you paid after the deadline, any refund is between you and the organizer.

The amount is fixed when you reserve. No card service fee is added to a
payment made directly to the organizer.

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

We give the organizer what they need to run the event and let you in. If you pay
the organizer directly, they also receive your name, email address and phone
number (if you gave one) so they can match your payment. We do not sell your
details.
$terms$, true)
ON CONFLICT (audience, version) DO NOTHING;

-- If version 2 already existed (a re-run), make sure it is the current one.
UPDATE terms_versions SET is_current = (version = 2) WHERE audience = 'buyer';
