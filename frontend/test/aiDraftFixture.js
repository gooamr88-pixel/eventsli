/** A Smart Event Creator API answer, as the backend validator shapes it. Shared by the AI tests. */
export const RESULT = {
  generationId: 'gen-1',
  draft: {
    listingType: 'ticketed', country: 'CA', timezone: 'America/Toronto', currency: 'CAD',
    title: 'Diwali Gala Dinner 2026', category: 'gala', description: 'Celebrate the Festival of Lights.',
    startsAt: { at: '2026-11-07T23:30:00.000Z', local: '2026-11-07T18:30', evidence: 'Saturday November 7 from 6:30pm', note: null },
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
    schedule: [{ title: 'Doors open', startsAt: '2026-11-07T23:30:00.000Z', local: '2026-11-07T18:30', evidence: 'Doors 6:30', location: null }],
  },
  quota: { enabled: true, limit: 2, used: 1, remaining: 1, nextAvailableAt: null },
};
