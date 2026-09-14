/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The homepage's words, kept apart from its layout.
 *
 * ONE RULE: every sentence maps to behaviour that exists, checked against the
 * code the day it was written. Two claims on the previous homepage failed that
 * check and are gone:
 *
 *   • "One price, at the start … Fees are in it, not added on the last screen."
 *     False. The seat picker says "before tax and fees" and the checkout lists
 *     tax and fees as their own lines (BRD §04/§06). The honest claim — and the
 *     better one — is that every line is shown before you pay.
 *   • The refund answer is BRD §09: non-refundable by default, and any refund
 *     is between the buyer and the organizer. Nothing here promises more.
 *
 * Facts cited: the 35-minute hold (RESERVATION_TTL_MINUTES), one transfer
 * where the event allows it (BRD §10, `allow_ticket_transfer`), the offline
 * gate queue, Stripe destination charges (BRD §08), review before publishing
 * (BRD §16), share links and QR codes, PIN devices and door-team accounts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Under the hero's buttons — three short facts, not a feature list. */
export const PROOF = [
  'You choose the exact seat',
  'Every fee shown before you pay',
  'Ticket on your phone, no app',
];

export const STEPS = [
  {
    title: 'Find it',
    body: 'Browse what is on across Canada and the United States, search by name, or open a link a friend sent you.',
  },
  {
    title: 'Pick the seat',
    body: 'Not a zone — the seat. Taken ones are greyed out on the map, and the seats you choose are held for 35 minutes while you check out.',
  },
  {
    title: 'Pay, and walk in',
    body: 'Card payment on Stripe’s own page. The ticket arrives by email with its QR code, sits in your account, and the door scans it with or without a signal.',
  },
];

export const POINTS = [
  {
    title: 'The seat is the seat',
    body: 'You choose the exact chair on the venue map. Nobody else can buy it while it is held for you, and it goes back on sale if you leave.',
  },
  {
    title: 'Every line before you pay',
    body: 'The ticket price, any tax and any fee are listed separately on the checkout, with the total, before you are sent to payment. Nothing is added after.',
  },
  {
    title: 'The ticket is on your phone',
    body: 'No app to install. It is in your email and in your account, and you can have it sent again without signing in.',
  },
  {
    title: 'Can’t go? Pass it on once',
    body: 'Where the organizer allows transfers, send your ticket to a friend. The old code stops working the moment theirs is issued.',
  },
];

/** The organizer band. Each maps to a screen in the dashboard. */
export const ORGANIZER_POINTS = [
  {
    title: 'Draw the room',
    body: 'Rows, round and oval tables, private tables behind a password — a seat map buyers actually click.',
  },
  {
    title: 'Paid straight to your Stripe',
    body: 'Card money goes to your own account at the sale. Our commission is its own line; we never hold your takings.',
  },
  {
    title: 'Share it anywhere',
    body: 'A link and a QR code for the event, and for each ticket type, ready to copy or download.',
  },
  {
    title: 'Run the door your way',
    body: 'PIN-locked tablets or named door staff with their own sign-in. Scanning keeps working offline.',
  },
];

export const FAQ = [
  {
    q: 'Do I need an account to buy a ticket?',
    a: 'No. Give your name and email at the checkout and the ticket is emailed to you. An account keeps every ticket in one place, and you can have a ticket sent again from Find my tickets without one.',
  },
  {
    q: 'What will I actually pay?',
    a: 'The checkout lists the ticket price, any tax and any fee the organizer passes on as separate lines, with the total, before you pay. Some organizers absorb the fees, in which case you pay the ticket price and tax only.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Tickets are non-refundable by default. Any refund is arranged between you and the organizer, because the money went to them — contact them first. Eventsli does not issue refunds itself.',
  },
  {
    q: 'Can I give my ticket to someone else?',
    a: 'Once, if the organizer has allowed transfers for that event. One transfer covers “I cannot go, take my seat” without turning tickets into a resale chain.',
  },
  {
    q: 'I run events. How do I start selling?',
    a: 'Create an account, confirm your email, and create a draft event. Add ticket types and a seat map, connect a Stripe payout account, accept the organizer terms and submit — we review every event before it goes on sale.',
  },
];
