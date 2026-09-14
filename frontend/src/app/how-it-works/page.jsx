import Link from 'next/link';
import PageHeader from '../components/marketing/PageHeader';
import { Band, Steps, Faq, FaqJsonLd } from '../components/marketing/Blocks';

/**
 * How it works — both halves of it.
 *
 * Buyers and organizers on ONE page rather than two, because the question
 * "how does this work" is asked by both and neither knows which page they are
 * meant to be on. The two audiences are separated by a heading and an anchor,
 * which is enough.
 *
 * Every step below describes something the software actually does. The 35
 * minutes is the hold the API grants, the review step is BRD §16, one transfer
 * is BRD §10, and the door works offline because the gate holds a queue. If a
 * rule changes, this page is wrong and has to change with it.
 */
export const metadata = {
  title: 'How it works',
  description:
    'Buying a ticket, and selling one. Seat maps, a 35-minute hold, payment straight '
    + 'to the organizer, and a door scanner that works with no signal.',
  alternates: { canonical: '/how-it-works' },
};

const BUYING = [
  {
    title: 'Find something',
    body: 'Browse by category, city or date. Every listing shows the real starting price — '
      + 'the number you see is the number the checkout starts from.',
  },
  {
    title: 'Pick your seat',
    body: 'Where the organizer has drawn a map, you choose the actual seat or table rather '
      + 'than a zone. Taken seats are taken; nothing is held back for later.',
  },
  {
    title: 'You get 35 minutes',
    body: 'Choosing seats holds them for you, with a countdown on screen. Nobody else can '
      + 'buy them in that window, and if you leave, they go back on sale rather than '
      + 'sitting dead until the event.',
  },
  {
    title: 'Pay once',
    body: 'Card payment through Stripe, on Stripe’s own page. The breakdown is shown before '
      + 'you pay — the ticket price, and any fee the organizer has chosen to pass on.',
  },
  {
    title: 'The ticket arrives by email',
    body: 'With a QR code. It is also in your account under My tickets, and you can have it '
      + 'sent again from Find my tickets without signing in.',
  },
  {
    title: 'Show it at the door',
    body: 'On your phone or printed. If you cannot go, you can pass a ticket to somebody '
      + 'else once — where the organizer allows transfers.',
  },
];

const SELLING = [
  {
    title: 'Create the event',
    body: 'Dates, venue, category and cover art. Draft to begin with — nothing is public and '
      + 'nothing is for sale until you say so.',
  },
  {
    title: 'Connect a payout account',
    body: 'Stripe, in your own name. Money from a card sale lands in your account, not ours '
      + '— we never hold your takings. This is also the step that has to be finished '
      + 'before anything can be sold.',
  },
  {
    title: 'Price it, and draw the room',
    body: 'Ticket tiers, table categories, and a seat map you lay out yourself: rows, round '
      + 'and oval tables, private tables behind a password.',
  },
  {
    title: 'Submit for review',
    body: 'You accept the organizer agreement and send it in; we publish it. Review is not a '
      + 'formality — it is what keeps the listings on this platform worth trusting.',
  },
  {
    title: 'Share it, sell it, watch it',
    body: 'A link and a QR code for the event and for each ticket type. Orders, attendees, '
      + 'promo codes and door sales in one place, with the money broken down line by line '
      + 'rather than as one net figure.',
  },
  {
    title: 'Run the door',
    body: 'Register a tablet with a PIN, or add your door team by email so each person signs in '
      + 'with their own account. Scanning works with no signal at the venue and uploads by '
      + 'itself when the connection returns.',
  },
];

const FAQ = [
  {
    q: 'What does it cost to buy a ticket?',
    a: 'The ticket price, plus whatever fees the organizer has chosen to pass on to buyers. '
      + 'Both are shown separately at the checkout before you pay. Some organizers absorb '
      + 'the fees instead, in which case you pay the ticket price and nothing else.',
  },
  {
    q: 'When do I get my money as an organizer?',
    a: 'Card payments go to your own Stripe account at the time of the sale, and Stripe pays '
      + 'out to your bank on its normal schedule. We do not hold your money in between, so '
      + 'there is no payout request to make and nothing of yours sitting in our account.',
  },
  {
    q: 'Can I get a refund?',
    a: 'Tickets are non-refundable by default. Any refund is arranged between you and the '
      + 'organizer, because the money went to them — so contact them first; Eventsli does not '
      + 'issue refunds itself. If an event is cancelled, its tickets stop admitting anyone and '
      + 'stay in your account as a record.',
  },
  {
    q: 'Can I transfer my ticket to someone else?',
    a: 'Once, if the organizer has allowed transfers on that event. One transfer only, on '
      + 'purpose: it covers "I cannot go, take my seat" without turning tickets into '
      + 'something that can be passed around a resale chain.',
  },
  {
    q: 'What happens if the venue has no internet?',
    a: 'The door keeps working. Scans are held on the tablet with the time they happened and '
      + 'uploaded when a connection returns — and because each scan carries an id the device '
      + 'made itself, uploading the same queue twice cannot admit anybody twice.',
  },
  {
    q: 'Which countries do you work in?',
    a: 'Canada and the United States. Events are priced in Canadian or US dollars, decided by '
      + 'the event’s market and fixed once the first ticket is sold — so a price cannot '
      + 'change currency underneath somebody who has already paid.',
  },
];

export default function HowItWorksPage() {
  return (
    <main>
      <FaqJsonLd items={FAQ} />

      <PageHeader
        eyebrow="How it works"
        title="Two sides of the same evening."
        lede="One page for both, because the answer is short either way: buying takes four
              minutes, and selling takes an afternoon to set up and then runs itself."
      >
        <div className="fx-row">
          <a href="#buying" className="text-sm text-accent hover:text-accent-hover">Buying a ticket ↓</a>
          <a href="#selling" className="text-sm text-accent hover:text-accent-hover">Selling one ↓</a>
        </div>
      </PageHeader>

      <Band
        id="buying"
        title="Buying a ticket"
        lede="No account needed to look, and none needed to be sent your ticket again later."
        flush
      >
        <Steps steps={BUYING} />
        <Link
          href="/events"
          className="es-btn es-btn--primary es-btn--lg self-start"
        >
          Browse events
        </Link>
      </Band>

      <Band
        id="selling"
        title="Selling one"
        lede="You keep the relationship with your buyers and you keep the money. We provide the
              shop, the seat map and the door."
      >
        <Steps steps={SELLING} />
        <div className="fx-row">
          <Link
            href="/register"
            className="es-btn es-btn--primary es-btn--lg"
          >
            Create an account
          </Link>
          <Link href="/why-us" className="text-sm text-accent hover:text-accent-hover">
            Why organizers choose us →
          </Link>
        </div>
      </Band>

      <Band title="Questions people actually ask">
        <Faq items={FAQ} />
      </Band>
    </main>
  );
}
