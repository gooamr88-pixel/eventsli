import Link from 'next/link';
import PageHeader from '../components/marketing/PageHeader';
import { Band, Points } from '../components/marketing/Blocks';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Why an organizer would choose this over the alternative.
 *
 * ONE RULE, borrowed from fancy's product page and worth stating again here:
 * every claim on this page maps to behaviour that exists. The seat map, the
 * destination charge, the offline door, the frozen currency, the one transfer
 * — all shipped, all covered by tests, several verified against the live API.
 * Nothing here is a roadmap item written in the present tense.
 *
 * That rule is also why this page names no competitor and quotes no percentage.
 * A commission rate is set per event by an administrator (BRD §05/§06); a
 * number typed here would be wrong for somebody the day it was written.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const metadata = {
  title: 'Why Eventsli',
  description:
    'Real seat maps, money that goes straight to the organizer with nothing held in '
    + 'escrow, and a door that works when the venue’s wifi does not.',
  alternates: { canonical: '/why-us' },
};

const REASONS = [
  {
    title: 'A seat map, not a picture of one',
    body: 'You lay out the room yourself — rows, round and oval tables, squares, blocks — and '
      + 'buyers pick the actual seat. Positions are stored as proportions of a fixed room, '
      + 'so the map you drew is the map on a phone, a laptop and a printout.',
    detail: 'Round, oval, rectangular, square and row seating in one editor.',
  },
  {
    title: 'Your money never sits with us',
    body: 'A card payment is charged directly to your own Stripe account. There is no escrow '
      + 'balance, no payout request, and no week where your takings are on our books. '
      + 'Stripe pays you out on its normal schedule.',
    detail: 'Commission is invoiced separately, so you can always see what is a fee and what is a sale.',
  },
  {
    title: 'The door works without wifi',
    body: 'A venue with thick walls and four hundred phones on one access point is the normal '
      + 'case, not the edge case. Scans are held on the tablet with the door’s own clock and '
      + 'upload themselves later — and a queue uploaded twice still admits each guest once.',
    detail: 'Any tablet or phone with a camera. Nothing to install.',
  },
  {
    title: 'One ticket, one admission',
    body: 'Two gates scanning the same code at the same instant produce exactly one entry and '
      + 'one clear refusal — and the refusal says when the ticket was first used, which is '
      + 'what ends an argument at a door instead of starting one.',
    detail: 'Enforced by a row lock in the database, not by a check in the app.',
  },
  {
    title: 'Prices that cannot move under a buyer',
    body: 'An event’s currency is fixed by its market and frozen the moment the first ticket '
      + 'sells. A tier that has sold cannot be repriced. Both are refusals from the API, not '
      + 'conventions somebody could forget.',
    detail: 'Canadian and US dollars. Integer cents everywhere — no rounding surprises.',
  },
  {
    title: 'Tickets that cannot be forged',
    body: 'Every ticket carries a signed token rather than an id, so a code we did not issue '
      + 'cannot be made to verify at all — the scanner rejects it before it touches the '
      + 'network. A screenshot of a real ticket is still that person’s ticket.',
    detail: 'And the QR image is drawn on our own servers, never by a third-party service.',
  },
  {
    title: 'Private tables, actually private',
    body: 'A table can sit behind a password and an invitation link. Protected tables are not '
      + 'merely hidden in the interface — they are left out of the map the browser receives, '
      + 'so there is nothing to find in a network tab.',
    detail: 'BRD §27. Useful for sponsors, families and anyone with a seating politics problem.',
  },
  {
    title: 'Numbers you can reconcile',
    body: 'Ticket price, commission, tax and payment fee are four separate lines on every '
      + 'order — for you and for the buyer. A single net figure is easy to print and '
      + 'impossible to check against a bank statement.',
    detail: 'You choose whether the buyer or you carries the fees.',
  },
  {
    title: 'Reviewed listings',
    body: 'Events are published by us, not by whoever typed them in. That costs an organizer a '
      + 'few hours on the first event and is the reason a buyer arriving from a search '
      + 'result has something to trust.',
    detail: 'You keep editing while it is in review; nothing is public until it is approved.',
  },
];

export default function WhyUsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="For organizers"
        title="Built by people who have stood at the door."
        lede="Nine things below. Every one of them is behaviour that exists today — if it were
              a plan, it would not be on this page."
      />

      <Band flush>
        {/* h2: this band has no title of its own, so these sit directly under
            the page's <h1>. On /trust the same component is inside a titled
            band and stays at h3. */}
        <Points points={REASONS} headingLevel={2} />
      </Band>

      <Band
        title="What we do not do"
        lede="A short list, because the things a platform refuses to do tell you more than the
              things it advertises."
      >
        <ul className="fx-stack fx-stack--sm max-w-[68ch] text-muted">
          <li>
            <strong className="text-ink">We do not hold your money.</strong> There is no float,
            no escrow, and therefore no conversation about when you get paid.
          </li>
          <li>
            <strong className="text-ink">We do not sell your buyers.</strong> Your attendee list
            is yours. It is not a marketing audience we rent back to you.
          </li>
          <li>
            <strong className="text-ink">We do not let tickets be traded.</strong> One transfer,
            person to person, when the organizer allows it. That covers a friend taking your
            seat and stops short of a resale market.
          </li>
          <li>
            <strong className="text-ink">We do not run the checkout ourselves.</strong> Card
            details go to Stripe, on Stripe’s page. We never see a card number, which is the
            only honest way to say that.
          </li>
        </ul>
      </Band>

      <Band title="Start with one event">
        <p className="max-w-[58ch] text-muted">
          Set it up, submit it, and see the whole thing — the map, the checkout, the door —
          before you commit anything larger to it.
        </p>
        <div className="fx-row">
          <Link
            href="/register"
            className="es-btn es-btn--primary es-btn--lg"
          >
            Create an account
          </Link>
          <Link href="/how-it-works#selling" className="text-sm text-accent hover:text-accent-hover">
            What setting up looks like →
          </Link>
          <Link href="/trust" className="text-sm text-accent hover:text-accent-hover">
            How we handle security →
          </Link>
        </div>
      </Band>
    </main>
  );
}
