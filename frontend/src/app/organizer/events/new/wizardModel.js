import { defaultTimeZone } from '../../../lib/timezones';
import { browserZone } from '../../../lib/eventTime';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CREATE-EVENT WIZARD IS MADE OF — the steps, the choices, and the
 * draft it keeps while somebody fills it in.
 *
 * Pure data and pure functions, so this is a `.js` file: the convention in
 * AGENTS.md is that a file holding JSX is `.jsx` and a file of logic is `.js`,
 * because vitest decides whether to accept JSX from the extension alone.
 *
 * It left `NewEventForm.jsx` when that file passed the project's 500-line cap.
 * The seam is not arbitrary — everything here answers "what can this wizard
 * ask?", which changes when the PRODUCT gains an option, while the component
 * next door answers "where is this organizer up to?", which changes when the
 * interaction does. They had no reason to be read together.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The two products, and the steps each one needs.
 *
 * A display-only listing sells nothing, so it is never asked about tickets or
 * payment — those steps do not exist for it rather than being skipped.
 */
export const TYPES = {
  ticketed: {
    title: 'Ticketed event',
    steps: ['basics', 'when', 'tickets', 'payment', 'review'],
  },
  display_only: {
    title: 'Display-only event',
    steps: ['basics', 'when', 'review'],
  },
};

export const STEP_TEXT = {
  basics: ['The basics', 'What the event is called and what it is about.'],
  when: ['When and where', 'Times are local to the venue.'],
  tickets: ['How tickets sell', 'You add ticket types and the seat map right after this.'],
  payment: ['How buyers pay', 'Choose from the payment methods you have set up.'],
  review: ['Check and create', 'It is saved as a private draft. Nothing is public until Eventsli approves it.'],
};

/** Which fields each step reports on. */
export const STEP_FIELDS = {
  basics: ['title'],
  when: ['startsAt', 'endsAt', 'venueName', 'venueAddress', 'city'],
  tickets: ['maxTicketsPerOrder'],
  payment: ['paymentOption'],
  review: [],
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ASKED HERE, REQUIRED AT SUBMIT — the fields that do not block a draft.
 *
 * WHAT A DRAFT IS FOR. An organizer starts an event before the room is booked.
 * Refusing to save until they name a venue does not produce a venue; it
 * produces "TBC" typed into three boxes, which then reaches the public listing
 * because nobody remembers to go back and correct a field they were forced to
 * invent. Worse, it loses the whole draft for anyone who leaves to go and check.
 *
 * So the wizard still ASKS for these, still explains why each one matters, and
 * still marks them on the review step — it simply does not stand in the way.
 * The requirement itself has not moved: `POST /events/:id/submit` refuses
 * without all three, the pre-submit dialog lists them as outstanding, and the
 * event cannot go on sale until they are real. That is where a "where is it?"
 * rule belongs, because that is the moment the answer has to be true.
 *
 * `startsAt` and `endsAt` are deliberately NOT in here: the API requires both
 * to create the row at all, so a draft without them cannot exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const SUBMIT_ONLY_FIELDS = ['venueName', 'venueAddress', 'city'];

/** What still has to be true before this step can be left. */
export function blockingFields(step) {
  return (STEP_FIELDS[step] || []).filter((f) => !SUBMIT_ONLY_FIELDS.includes(f));
}

/**
 * RESERVED SEATING OR GENERAL ADMISSION — asked at creation, because it decides
 * how much of the product this organizer ever has to look at.
 *
 * Reserved means drawing the room: a venue map, table categories, a seat picker
 * at the checkout. General admission means a number on a ticket type and none
 * of the above. Asking afterwards means somebody building a conference spends
 * their first ten minutes in a seat-map editor working out whether they are
 * supposed to be there.
 */
export const ADMISSION_TYPES = [
  ['reserved', 'Reserved seating', 'You draw the room; buyers choose their seat or table.', 'map'],
  ['general', 'General admission', 'No seat map. You set how many tickets exist, buyers choose how many they want.', 'ticket'],
];

export const PURCHASE_MODES = [
  ['seat_only', 'Individual seats', 'Buyers pick seats one by one.', 'ticket'],
  ['table_only', 'Whole tables', 'Buyers book a table and get every seat at it.', 'layers'],
  ['seat_and_table', 'Seats or tables', 'Buyers can do either.', 'map'],
];

export const FEE_BEARERS = [
  ['buyer', 'Buyers pay the fees', 'Added at checkout, shown as its own line.'],
  ['organizer', 'I pay the fees', 'Taken from your payout. Buyers see one price.'],
];

export const PAYMENT_OPTIONS = {
  both: ['Stripe + manual', 'Buyers pay by card online, or by your manual methods.', 'card'],
  stripe: ['Stripe only', 'Buyers pay by card at checkout.', 'card'],
  manual: ['Manual only', 'Buyers pay you by e-Transfer, bank transfer or cash.', 'cash'],
};

export function draftKey(type) {
  return `eventsli.newEvent.${type}`;
}

/**
 * The form to start from: a saved draft if there is one, otherwise defaults.
 *
 * The draft is a CONVENIENCE, not a store — a private window or cleared storage
 * simply starts empty. It exists because the wizard sends people away midway
 * (to set up payments), and losing four steps of typing to a detour is what
 * made an earlier version of this refuse to be a wizard at all.
 *
 * Read on the client only; this runs after the organizer has loaded, so the
 * server never renders it.
 */
export function initialForm(type, organizer) {
  const country = organizer?.country || 'CA';
  const base = {
    title: '', category: 'other', description: '',
    country, timezone: defaultTimeZone(country, browserZone()),
    startsAt: '', endsAt: '', venueName: '', venueAddress: '', city: '',
    admissionType: 'reserved',
    purchaseMode: 'seat_only', feeBearer: 'buyer', maxTicketsPerOrder: '10', allowTicketTransfer: true,
    paymentOption: organizer?.payments?.choices?.[0] || '',
  };

  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(type)) || 'null');
    if (saved?.form) {
      const form = { ...base, ...saved.form };
      // A payment option saved before a method was removed is not offered again.
      if (!(organizer?.payments?.choices || []).includes(form.paymentOption)) {
        form.paymentOption = base.paymentOption;
      }
      return { form, step: Number(saved.step) || 0 };
    }
  } catch { /* storage unavailable */ }

  return { form: base, step: 0 };
}

/**
 * What is wrong with the form right now, field by field — `null` where nothing
 * is.
 *
 * Computed for the WHOLE form on every render rather than per step, because
 * `Review` shows every answer and the last step has to be able to refuse a
 * value the organizer went back and broke.
 */
export function problemsFor({ form, startIso, endIso, choices }) {
  const perOrder = Number(form.maxTicketsPerOrder);
  return {
    title: form.title.trim().length < 3 ? 'Give your event a title of at least 3 characters.' : null,
    startsAt: !form.startsAt ? 'Choose when it starts.'
      : new Date(startIso) <= new Date() ? 'The start has to be in the future.' : null,
    endsAt: !form.endsAt ? 'Choose when it ends.'
      : form.startsAt && new Date(endIso) <= new Date(startIso) ? 'The event has to end after it starts.' : null,
    /**
     * THE VENUE — required to SUBMIT, never to save a draft. See
     * `SUBMIT_ONLY_FIELDS` above for why the difference matters.
     *
     * Name and address because "where" is the second thing every buyer checks
     * and an event without it reached the listing anyway.
     *
     * CITY because it is what makes an event findable. "Events near me"
     * matches `events.city` against a table of coordinates
     * (`utils/cityCoordinates.js`) — the visitor's position is never sent to a
     * geocoder — and `nearestCity` filters on `city IS NOT NULL`. No organizer
     * form has ever asked for one, so every manually entered venue had a null
     * city and could not appear in Near me, or under `?city=`, at all. The
     * column, the API and the filter were all ready; nothing collected it.
     */
    venueName: form.venueName.trim().length < 2
      ? 'Add the venue name before you submit this event.' : null,
    venueAddress: form.venueAddress.trim().length < 4
      ? 'Add the street address before you submit this event.' : null,
    city: form.city.trim().length < 2
      ? 'Add the city — it is how buyers find this event near them.' : null,
    maxTicketsPerOrder: !(Number.isInteger(perOrder) && perOrder >= 1 && perOrder <= 100)
      ? 'Between 1 and 100.' : null,
    paymentOption: choices.length > 0 && !choices.includes(form.paymentOption)
      ? 'Choose how buyers pay.' : null,
  };
}
