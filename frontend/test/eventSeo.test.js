import { describe, test, expect } from 'vitest';
import {
  seoTitle, seoDescription, seoKeywords, eventJsonLd, breadcrumbJsonLd, isoWithOffset, quickAnswers,
  seoChecklist, toPublicShape, eventType, clip, TITLE_MAX, DESCRIPTION_MAX,
} from '../src/app/lib/eventSeo';
import { jsonLdScript } from '../src/app/utils/jsonLd';

/**
 * What one event page tells a search engine. Every assertion is about a
 * search somebody actually makes — "<event> tickets", "<event> <city>",
 * "when is <event>" — or about a claim the page must never make.
 */

const EVENT = {
  id: 'e1', slug: 'neon-nights', title: 'Neon Nights', city: 'Toronto', venue: 'The Mod Club', venueAddress: '722 College St',
  country: 'CA', timezone: 'America/Toronto', startsAt: '2026-11-15T02:00:00.000Z', endsAt: '2026-11-15T07:00:00.000Z',
  currency: 'CAD', category: 'nightlife', coverUrl: 'https://cdn.test/cover.jpg',
  description: 'Neon Nights\n\nA night of electronic music with a live DJ set and a full light show. Dress to impress.',
  gallery: [{ kind: 'image', url: 'https://cdn.test/g1.jpg' }, { kind: 'video', url: 'https://youtu.be/x' }],
  tiers: [
    { id: 't1', name: 'Advance', priceCents: 2500, salesStartAt: '2026-10-01T04:00:00Z', salesEndAt: '2026-11-14T04:00:00Z' },
    { id: 't2', name: 'Door', priceCents: 3000, notYetOnSale: true, salesStartAt: '2026-11-14T23:00:00Z' },
  ],
  availability: { soldOut: false }, organizer: { name: 'Neon Co' }, venueLocation: { lat: 43.65, lng: -79.41 },
  highlights: ['Live DJ', 'Light show'], displayOnly: false,
};
const NOW = new Date('2026-11-01T12:00:00Z');

describe('the <title>', () => {
  test('says the name, "Tickets", the city and the date, inside what Google shows', () => {
    const t = seoTitle(EVENT);
    expect(t).toBe('Neon Nights Tickets – Toronto, Nov 14, 2026 | Eventsli');
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  test('the date is the date where the event is, not in UTC', () => {
    expect(seoTitle(EVENT)).toContain('Nov 14');   // 02:00 UTC on the 15th is 9 pm on the 14th in Toronto
  });

  test('never repeats a word the name already has', () => {
    expect(seoTitle({ ...EVENT, title: 'Toronto Jazz Festival 2026' })).toBe('Toronto Jazz Festival 2026 Tickets – Nov 14 | Eventsli');
    expect(seoTitle({ ...EVENT, title: 'Free Tickets Friday' })).not.toMatch(/Tickets Tickets|Friday Tickets/);
  });

  test('a listing that sells nothing does not say "Tickets"', () => {
    expect(seoTitle({ ...EVENT, displayOnly: true })).toBe('Neon Nights – Toronto, Nov 14, 2026 | Eventsli');
  });

  test('a long name drops the extras, then the brand, and is never cut', () => {
    const long = 'The Annual Downtown Winter Lantern Festival and Night Market';
    expect(seoTitle({ ...EVENT, title: long })).toBe(`${long} Tickets`);
    const t = seoTitle({ ...EVENT, title: 'Winter Lantern Festival and Night Market' });
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.startsWith('Winter Lantern Festival and Night Market Tickets')).toBe(true);
  });
});

describe('the meta description', () => {
  test('leads with when, where and from how much, then the organizer’s first sentence', () => {
    const d = seoDescription(EVENT);
    expect(d).toBe('Sat, Nov 14, 2026 at 9:00 PM at The Mod Club, Toronto. A night of electronic music with a live DJ set and a full light show. Tickets from $25 CAD.');
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  test('a long description is cut on a word, never mid-word, and the facts survive', () => {
    const d = seoDescription({ ...EVENT, description: `${'An extraordinary celebration '.repeat(12)}ends here.` });
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d).toMatch(/^Sat, Nov 14, 2026/);
    expect(d).toMatch(/Tickets from \$25 CAD\.$/);
    expect(d).toMatch(/ (An|extraordinary|celebration)… Tickets/);   // a whole word, then the mark
  });

  test('sold out, free and no-price events each say the true thing', () => {
    expect(seoDescription({ ...EVENT, availability: { soldOut: true } })).toMatch(/Sold out\./);
    expect(seoDescription({ ...EVENT, tiers: [{ name: 'Entry', priceCents: 0 }] })).toMatch(/Free tickets\./);
    const listing = seoDescription({ ...EVENT, displayOnly: true, tiers: [] });
    expect(listing).not.toMatch(/ticket|\$/i);
  });

  test('a hidden ticket type never sets the advertised price', () => {
    const d = seoDescription({ ...EVENT, tiers: [{ name: 'Comp', priceCents: 0, hidden: true }, { name: 'GA', priceCents: 4000 }] });
    expect(d).toMatch(/Tickets from \$40 CAD/);
  });

  test('with nothing else to say, it names the event and where to get tickets', () => {
    const d = seoDescription({ ...EVENT, description: '', venue: null, city: null, venueAddress: null });
    expect(d).toMatch(/^Neon Nights: Sat, Nov 14, 2026 at 9:00 PM\. Tickets from \$25 CAD\. Get tickets on Eventsli\.$/);
  });
});

describe('structured data', () => {
  const ld = eventJsonLd(EVENT, { origin: 'https://eventsli.com', now: NOW });

  test('is a specific event type with local-offset times', () => {
    expect(ld['@type']).toBe('MusicEvent');
    expect(ld.startDate).toBe('2026-11-14T21:00:00-05:00');
    expect(ld.endDate).toBe('2026-11-15T02:00:00-05:00');
    expect(ld.url).toBe('https://eventsli.com/e/neon-nights');
    expect(eventType('wellness')).toBe('Event');
  });

  test('summer time is its own offset', () => {
    expect(isoWithOffset('2026-07-01T23:30:00Z', 'America/Vancouver')).toBe('2026-07-01T16:30:00-07:00');
    expect(isoWithOffset('2026-07-01T23:30:00Z', 'UTC')).toBe('2026-07-01T23:30:00+00:00');
  });

  test('the place has a postal address with city and country, and coordinates', () => {
    expect(ld.location).toEqual({
      '@type': 'Place', name: 'The Mod Club',
      address: { '@type': 'PostalAddress', streetAddress: '722 College St', addressLocality: 'Toronto', addressCountry: 'CA' },
      geo: { '@type': 'GeoCoordinates', latitude: 43.65, longitude: -79.41 },
    });
  });

  test('one offer per ticket type, each with its real availability and sale window', () => {
    expect(ld.offers).toEqual([
      expect.objectContaining({ name: 'Advance', price: '25.00', priceCurrency: 'CAD', availability: 'https://schema.org/InStock', validFrom: '2026-10-01T00:00:00-04:00' }),
      expect.objectContaining({ name: 'Door', price: '30.00', availability: 'https://schema.org/PreOrder' }),
    ]);
    expect(ld.offers[0].validThrough).toBe('2026-11-13T23:00:00-05:00');
  });

  test('images are the cover and the gallery photos, never a video link', () => {
    expect(ld.image).toEqual(['https://cdn.test/cover.jpg', 'https://cdn.test/g1.jpg']);
  });

  test('a listing that sells nothing has no offers — a price of 0 would claim it is free', () => {
    const listing = eventJsonLd({ ...EVENT, displayOnly: true }, { now: NOW });
    expect(listing.offers).toBeUndefined();
    expect(listing.isAccessibleForFree).toBeUndefined();
    expect(eventJsonLd({ ...EVENT, tiers: [{ name: 'Entry', priceCents: 0 }] }).isAccessibleForFree).toBe(true);
  });

  test('a missing venue is left out, not written as "TBA"', () => {
    const bare = eventJsonLd({ ...EVENT, venue: null, city: null, venueAddress: null, venueLocation: null });
    expect(bare.location).toBeUndefined();
  });

  test('the breadcrumb is Home › Events › city › event', () => {
    expect(breadcrumbJsonLd(EVENT, 'https://eventsli.com').itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, 'Home', 'https://eventsli.com/'],
      [2, 'Events', 'https://eventsli.com/events'],
      [3, 'Toronto', 'https://eventsli.com/events?city=Toronto'],
      [4, 'Neon Nights', 'https://eventsli.com/e/neon-nights'],
    ]);
  });

  test('an organizer’s title cannot close the script block', () => {
    const out = jsonLdScript(eventJsonLd({ ...EVENT, title: 'Party</script><script>alert(1)</script>' }));
    expect(out).not.toContain('</script>');
  });
});

describe('what the page and the organizer see', () => {
  test('the quick answers answer when, where, how much and how', () => {
    const qa = quickAnswers(EVENT);
    expect(qa.map((x) => x.q)).toEqual([
      'When is Neon Nights?', 'Where is Neon Nights?', 'How much are tickets for Neon Nights?',
      'How do I get tickets for Neon Nights?', 'Who is organizing Neon Nights?',
    ]);
    expect(qa[0].a).toBe('Neon Nights is on Saturday, November 14, 2026, from 9:00 PM to 2:00 AM EST.');
    expect(qa[1].a).toBe('Neon Nights takes place at The Mod Club, 722 College St, Toronto.');
    expect(qa[2].a).toBe('Tickets from $25 CAD. Ticket types: Advance ($25), Door ($30).');
    expect(quickAnswers({ ...EVENT, displayOnly: true }).some((x) => /tickets/.test(x.q))).toBe(false);
  });

  test('keywords are the searches people make, without duplicates', () => {
    const k = seoKeywords(EVENT, 'Nightlife');
    expect(k).toEqual(expect.arrayContaining(['neon nights tickets', 'neon nights toronto', 'neon nights 2026', 'events in toronto']));
    expect(new Set(k).size).toBe(k.length);
  });

  test('the organizer checklist reads their own event shape', () => {
    const mine = toPublicShape({
      slug: 'neon-nights', title: 'Neon Nights', description: 'Short.', venue: { name: 'The Mod Club', address: null },
      venueAddress: null, city: 'Toronto', listingType: 'ticketed', cover: null, highlights: [], venueLocation: null,
      startsAt: EVENT.startsAt, timezone: EVENT.timezone, currency: 'CAD',
    }, []);
    const open = seoChecklist(mine).filter((c) => !c.done).map((c) => c.key);
    expect(open).toEqual(['cover', 'description', 'venue', 'pin', 'tickets', 'highlights']);
    expect(seoChecklist(EVENT).find((c) => c.key === 'description').done).toBe(false);
  });

  test('clip cuts on a word and marks the cut', () => {
    expect(clip('one two three four', 12)).toBe('one two…');
    expect(clip('short', 12)).toBe('short');
  });
});
