/**
 * THE DRAFT'S DATE IS ALWAYS IN THE FUTURE (2026-11-10).
 *
 * It was a fixed 7 November 2026. The day that passed, the review screen
 * rightly flagged "starts in the past" as one more thing needing the organizer,
 * and three tests asserting "2 things need you" failed with nothing broken.
 * Now: the next 15 January at least 45 days away. January, so Toronto is on
 * standard time (UTC−5) every year and the UTC values below stay exact.
 */
function draftYear(now = new Date()) {
  let year = now.getUTCFullYear();
  while (Date.UTC(year, 0, 15) < now.getTime() + 45 * 86400e3) year += 1;
  return year;
}
const YEAR = draftYear();
/** The draft's day, `YYYY-MM-DD`, and the day after it. */
export const DRAFT_DAY = `${YEAR}-01-15`;
export const DRAFT_NEXT_DAY = `${YEAR}-01-16`;
/** 6:30pm in Toronto (23:30 UTC), and 11:30pm (04:30 UTC next day). */
export const DRAFT_START_LOCAL = `${DRAFT_DAY}T18:30`;
export const DRAFT_START_AT = `${DRAFT_DAY}T23:30:00.000Z`;
export const DRAFT_END_LOCAL = `${DRAFT_DAY}T23:30`;
export const DRAFT_END_AT = `${DRAFT_NEXT_DAY}T04:30:00.000Z`;

/** A Smart Event Creator API answer, as the backend validator shapes it. Shared by the AI tests. */
export const RESULT = {
  generationId: 'gen-1',
  draft: {
    listingType: 'ticketed', country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
    title: 'Diwali Gala Dinner 2026', category: 'gala', description: 'Celebrate the Festival of Lights.',
    startsAt: { at: DRAFT_START_AT, local: DRAFT_START_LOCAL, evidence: 'Saturday November 7 from 6:30pm', note: null },
    endsAt: { at: null, local: null, evidence: null, note: null },
    venueName: { value: 'Palais Royale', evidence: 'at the Palais Royale' },
    venueAddress: { value: '1601 Lake Shore Blvd W', evidence: '1601 Lake Shore Blvd W' },
    city: { value: 'Toronto', evidence: 'Toronto' },
    admissionType: 'reserved', purchaseMode: 'seat_and_table',
    highlights: ['Three-course dinner', 'Live Bollywood band'],
    tiers: [
      { name: 'General', kind: 'standard', description: 'Seat and dinner', quantity: null, quantityEvidence: null, priceCents: 9500, priceEvidence: 'General tickets $95' },
      { name: 'Child (under 12)', kind: 'standard', description: null, quantity: null, quantityEvidence: null, priceCents: null, priceEvidence: null },
    ],
    schedule: [{ title: 'Doors open', startsAt: DRAFT_START_AT, local: DRAFT_START_LOCAL, evidence: 'Doors 6:30', location: null }],
  },
  quota: { enabled: true, limit: 2, used: 1, remaining: 1, nextAvailableAt: null },
};
