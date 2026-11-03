import { isDateOnly, formatDateOnly, dateOnlyDays } from './dateOnly';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW ONE EVENT PAGE PRESENTS ITSELF TO A SEARCH ENGINE.
 *
 * Pure: every function takes the public event (`GET /public/events/:slug`) and
 * returns strings or plain objects, so the rules can be tested without
 * rendering a page — and so the event page, the organizer's "Search
 * appearance" preview and the tests can never disagree about what Google is
 * shown.
 *
 * WHAT IT IS OPTIMISING FOR. Somebody searching for a specific event types its
 * name plus one of four words: "tickets", the city, the venue, or the year.
 * The pages that outrank us for that search (the venue's own site, a resale
 * marketplace, an aggregator) say all four in the title and the first line of
 * the snippet. So:
 *
 *   · the <title> is the event's name, then "Tickets" when it sells them, then
 *     the city and the date — each added only while the whole stays inside
 *     what Google displays, and never repeating a word the name already has;
 *   · the meta description leads with the facts (when, where, from how much)
 *     and then the organizer's own first sentence, cut on a word;
 *   · the structured data is the complete Event schema Google's event results
 *     read: a specific event type, local-offset dates, a PostalAddress with the
 *     city and country, coordinates, every image, and one Offer per ticket type
 *     with its real availability and sale window.
 *
 * NOTHING IS INVENTED. Every value here is a field the organizer set or the
 * API computed. A missing venue is left out rather than written "TBA", and a
 * listing that sells nothing has no offers rather than a price of zero —
 * Google reads `price: 0` as "free", which is a different, false claim.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Google shows roughly 600 px of a title — about 60 characters of mixed text. */
export const TITLE_MAX = 62;
/** And about 155–160 characters of a description on a desktop result. */
export const DESCRIPTION_MAX = 158;
const BRAND = 'Eventsli';

export function siteOrigin() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://eventsli.com').replace(/\/+$/, '');
}

export function eventUrl(slug, origin = siteOrigin()) {
  return `${origin}/e/${encodeURIComponent(slug)}`;
}

const squash = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const fold = (v) => squash(v).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Does `hay` already say `needle` as whole words? "Toronto Jazz Fest" has Toronto. */
const says = (hay, needle) => {
  const n = fold(needle);
  return Boolean(n) && new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(fold(hay));
};

function fmt(iso, timeZone, opts) {
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
  }
}

/** Cut on a word boundary, with an ellipsis only when something was cut. */
export function clip(text, max) {
  const s = squash(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** The organizer's opening sentence, without line breaks or a heading line. */
export function openingSentence(description) {
  const paragraphs = String(description || '').split(/\n\s*\n/).map(squash).filter(Boolean);
  // A short first paragraph with no full stop is a heading (see `splitDescription`).
  const body = paragraphs.length > 1 && paragraphs[0].length <= 70 && !/[.!?]$/.test(paragraphs[0])
    ? paragraphs.slice(1).join(' ') : paragraphs.join(' ');
  if (!body) return '';
  const stop = body.search(/[.!?](\s|$)/);
  return stop > 0 ? body.slice(0, stop + 1) : body;
}

/** The ticket types a buyer can actually see, and the lowest of their prices. */
function prices(event) {
  if (event.displayOnly) return { low: null, allFree: false, any: false };
  const list = (event.tiers || []).filter((t) => !t.hidden).map((t) => Number(t.priceCents)).filter(Number.isFinite);
  if (Number.isFinite(event.fromPriceCents)) list.push(Number(event.fromPriceCents));
  if (!list.length) return { low: null, allFree: false, any: false };
  return { low: Math.min(...list), allFree: list.every((p) => p === 0), any: true };
}

export function money(cents, currency) {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || 'CAD', currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(whole ? 0 : 2)}`;
  }
}

// ─── <title> ───────────────────────────────────────────────────────────────
/**
 * "Neon Nights Tickets – Toronto, Nov 14, 2026 | Eventsli", or the longest
 * prefix of that which fits. Used with `title.absolute`, so the layout's
 * " · Eventsli" template is not appended a second time.
 */
export function seoTitle(event) {
  const name = squash(event.title) || 'Event';
  const ticketed = !event.displayOnly;
  const base = ticketed && !/\btickets?\b/i.test(name) ? `${name} Tickets` : name;
  const city = event.city && !says(name, event.city) ? squash(event.city) : null;
  const year = event.startsAt ? fmt(event.startsAt, event.timezone, { year: 'numeric' }) : null;
  const short = event.startsAt ? fmt(event.startsAt, event.timezone, { month: 'short', day: 'numeric' }) : null;
  const full = short && year && !name.includes(year) ? `${short}, ${year}` : short;

  const tail = (...parts) => parts.filter(Boolean).join(', ');
  const candidates = [
    tail(city, full), tail(city, short), city, full, short,
  ].filter((t, i, all) => t && all.indexOf(t) === i).map((t) => `${base} – ${t}`);
  candidates.push(base);

  for (const c of candidates) if (`${c} | ${BRAND}`.length <= TITLE_MAX) return `${c} | ${BRAND}`;
  for (const c of candidates) if (c.length <= TITLE_MAX) return c;
  // A long name is the event's name; Google truncates it, we do not.
  return base;
}

// ─── meta description ──────────────────────────────────────────────────────
/** "Sat, Nov 14, 2026 at 9:00 PM" in the event's own zone. */
export function whenPhrase(event) {
  if (!event.startsAt) return '';
  if (isDateOnly(event)) return formatDateOnly(event, { style: 'short' });
  const day = fmt(event.startsAt, event.timezone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = fmt(event.startsAt, event.timezone, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

export function wherePhrase(event) {
  const venue = squash(event.venue);
  const city = squash(event.city);
  if (venue && city && !says(venue, city)) return `${venue}, ${city}`;
  return venue || city || '';
}

export function pricePhrase(event) {
  if (event.displayOnly) return '';
  if (event.availability?.soldOut) return 'Sold out.';
  const p = prices(event);
  if (!p.any) return '';
  if (p.allFree) return 'Free tickets.';
  if (p.low === 0) return 'Free and paid tickets.';
  return `Tickets from ${money(p.low, event.currency)} ${event.currency || ''}`.trim() + '.';
}

export function seoDescription(event) {
  const when = whenPhrase(event);
  const where = wherePhrase(event);
  // "at The Mod Club, Toronto", but "in Toronto" when there is only a city.
  const prep = squash(event.venue) ? 'at' : 'in';
  const facts = [when, where && `${when ? `${prep} ` : ''}${where}`].filter(Boolean).join(' ');
  const lead = facts ? `${facts}.` : '';
  const price = pricePhrase(event);
  const about = openingSentence(event.description);

  const fixed = [lead, price].filter(Boolean).join(' ');
  const room = DESCRIPTION_MAX - fixed.length - 1;
  let text;
  if (about && room >= 40) text = [lead, clip(about, room), price].filter(Boolean).join(' ');
  else if (about && !fixed) text = clip(about, DESCRIPTION_MAX);
  else text = fixed;

  // Short with room to spare: name the event and where to get tickets, which
  // is exactly the query this page is trying to answer.
  const name = squash(event.title);
  if (text.length < 90 && name && !says(text, name)) text = `${name}: ${text}`.trim();
  if (text.length < 110 && !event.displayOnly && prices(event).any) text = `${text} Get tickets on ${BRAND}.`;
  return clip(text || `${name} on ${BRAND}.`, DESCRIPTION_MAX);
}

/** Search phrases people type for this event. Bing still reads them; Google ignores them harmlessly. */
export function seoKeywords(event, categoryLabel = null) {
  const name = squash(event.title);
  const city = squash(event.city);
  const venue = squash(event.venue);
  const year = event.startsAt ? fmt(event.startsAt, event.timezone, { year: 'numeric' }) : '';
  const list = [
    name,
    !event.displayOnly && `${name} tickets`,
    city && !says(name, city) && `${name} ${city}`,
    year && !name.includes(year) && `${name} ${year}`,
    venue,
    venue && `${venue} events`,
    city && `events in ${city}`,
    city && categoryLabel && `${categoryLabel.toLowerCase()} ${city}`,
  ].filter(Boolean).map(squash);
  return [...new Set(list.map((k) => k.toLowerCase()))].slice(0, 10);
}

// ─── Structured data ───────────────────────────────────────────────────────
/**
 * The schema.org subtype for a category. Specific types are a stronger signal
 * of what the page is than `Event`, and every one here is a real subtype that
 * Google's event results accept; categories without an honest match stay
 * `Event` rather than borrowing a wrong one.
 */
const EVENT_TYPES = Object.freeze({
  music: 'MusicEvent', nightlife: 'MusicEvent', festival: 'Festival', holiday: 'Festival', culture: 'Festival',
  arts: 'TheaterEvent', comedy: 'ComedyEvent', dance: 'DanceEvent', sports: 'SportsEvent', outdoors: 'SportsEvent',
  food_drink: 'FoodEvent', film: 'ScreeningEvent', business: 'BusinessEvent', conference: 'BusinessEvent',
  tech: 'EducationEvent', education: 'EducationEvent', community: 'SocialEvent', gala: 'SocialEvent',
  charity: 'SocialEvent', family: 'ChildrensEvent',
});
export const eventType = (category) => EVENT_TYPES[category] || 'Event';

/**
 * An instant written with the EVENT's UTC offset: 2026-11-14T21:00:00-05:00.
 * A bare `Z` time is valid, but Google displays event times from the offset,
 * and a 9 pm show in Toronto shown as "2 AM" is the result people complain of.
 */
export function isoWithOffset(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(d).map((p) => [p.type, p.value]));
    const offset = /GMT([+-]\d{2}:\d{2})/.exec(parts.timeZoneName)?.[1] || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
  } catch {
    return d.toISOString();
  }
}

function availabilityOf(tier, event, now) {
  if (event.availability?.soldOut || tier.soldOut || tier.salesEnded) return 'https://schema.org/SoldOut';
  if (tier.notYetOnSale || (tier.salesStartAt && new Date(tier.salesStartAt) > now)) return 'https://schema.org/PreOrder';
  return 'https://schema.org/InStock';
}

/** Plain text for a JSON-LD string: no runs of whitespace, bounded. */
const plain = (v, max) => clip(String(v || '').replace(/\s*\n\s*/g, ' '), max);

export function eventJsonLd(event, { origin = siteOrigin(), now = new Date() } = {}) {
  const url = eventUrl(event.slug, origin);
  const images = [
    event.coverUrl,
    ...(event.gallery || []).filter((g) => g.kind === 'image').map((g) => g.url),
  ].filter(Boolean);
  const venue = squash(event.venue);
  const city = squash(event.city);
  const address = squash(event.venueAddress);
  const tiers = event.displayOnly ? [] : (event.tiers || []).filter((t) => !t.hidden);

  const location = venue || city || address ? {
    '@type': 'Place',
    name: venue || city || address,
    address: {
      '@type': 'PostalAddress',
      ...(address ? { streetAddress: address } : {}),
      ...(city ? { addressLocality: city } : {}),
      ...(event.country ? { addressCountry: event.country } : {}),
    },
    ...(event.venueLocation ? {
      geo: { '@type': 'GeoCoordinates', latitude: event.venueLocation.lat, longitude: event.venueLocation.lng },
    } : {}),
  } : null;

  return {
    '@context': 'https://schema.org',
    '@type': eventType(event.category),
    '@id': `${url}#event`,
    url,
    name: squash(event.title),
    ...(event.description ? { description: plain(event.description, 1500) } : {}),
    // A date-only listing is written as dates (schema.org allows Date), so
    // Google shows the day rather than a midnight start.
    ...(isDateOnly(event)
      ? { startDate: dateOnlyDays(event).first, endDate: dateOnlyDays(event).last }
      : {
        startDate: isoWithOffset(event.startsAt, event.timezone),
        ...(event.endsAt ? { endDate: isoWithOffset(event.endsAt, event.timezone) } : {}),
      }),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    inLanguage: 'en',
    ...(images.length ? { image: [...new Set(images)].slice(0, 6) } : {}),
    ...(location ? { location } : {}),
    ...(event.organizer?.name ? { organizer: { '@type': 'Organization', name: event.organizer.name } } : {}),
    ...(tiers.length && tiers.every((t) => Number(t.priceCents) === 0) ? { isAccessibleForFree: true } : {}),
    ...(tiers.length ? {
      offers: tiers.map((t) => ({
        '@type': 'Offer',
        name: t.name,
        url,
        price: (Number(t.priceCents) / 100).toFixed(2),
        priceCurrency: event.currency,
        availability: availabilityOf(t, event, now),
        ...(t.salesStartAt ? { validFrom: isoWithOffset(t.salesStartAt, event.timezone) } : {}),
        ...(t.salesEndAt ? { validThrough: isoWithOffset(t.salesEndAt, event.timezone) } : {}),
      })),
    } : {}),
  };
}

/** Home › Events › {city} › {event}: the path Google shows in place of the URL. */
export function breadcrumbs(event, origin = siteOrigin()) {
  const city = squash(event.city);
  return [
    { name: 'Events', href: '/events' },
    ...(city ? [{ name: city, href: `/events?city=${encodeURIComponent(city)}` }] : []),
    { name: squash(event.title), href: `/e/${encodeURIComponent(event.slug)}` },
  ].map((c) => ({ ...c, url: `${origin}${c.href}` }));
}

export function breadcrumbJsonLd(event, origin = siteOrigin()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', url: `${origin}/` }, ...breadcrumbs(event, origin)].map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: c.url,
    })),
  };
}

// ─── Visible answers ───────────────────────────────────────────────────────
/**
 * The questions people actually search about one event — when, where, how
 * much, how to get in — answered in a sentence each, from the same fields.
 *
 * Shown on the page, not hidden in markup: Google no longer gives most sites
 * an FAQ rich result, but plain-language answers on the page are what match
 * "when is …" and "how much are … tickets" searches and what answer engines
 * quote. Only questions with a real answer are asked.
 */
export function quickAnswers(event) {
  const name = squash(event.title);
  const out = [];
  if (event.startsAt && isDateOnly(event)) {
    out.push({ q: `When is ${name}?`, a: `${name} is on ${formatDateOnly(event)}.` });
  } else if (event.startsAt) {
    const day = fmt(event.startsAt, event.timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const from = fmt(event.startsAt, event.timezone, { hour: 'numeric', minute: '2-digit' });
    const until = event.endsAt ? fmt(event.endsAt, event.timezone, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null;
    out.push({ q: `When is ${name}?`, a: `${name} is on ${day}, from ${from}${until ? ` to ${until}` : ' (local time)'}.` });
  }
  const address = squash(event.venueAddress);
  const city = squash(event.city);
  const where = [squash(event.venue), address, city && !says(address, city) ? city : null].filter(Boolean);
  if (where.length) {
    out.push({ q: `Where is ${name}?`, a: `${name} takes place at ${[...new Set(where)].join(', ')}.` });
  }
  if (!event.displayOnly) {
    const price = pricePhrase(event);
    if (price) {
      const tiers = (event.tiers || []).filter((t) => !t.hidden);
      const list = tiers.length > 1 && tiers.length <= 4
        ? ` Ticket types: ${tiers.map((t) => `${t.name} (${Number(t.priceCents) === 0 ? 'free' : money(Number(t.priceCents), event.currency)})`).join(', ')}.`
        : '';
      out.push({ q: `How much are tickets for ${name}?`, a: `${price}${list}` });
    }
    out.push({
      q: `How do I get tickets for ${name}?`,
      a: event.availability?.soldOut
        ? `${name} is sold out on ${BRAND}.`
        : `Buy them on this page through ${BRAND}. Your ticket arrives by email with a QR code to show at the door.`,
    });
  }
  if (event.organizer?.name) out.push({ q: `Who is organizing ${name}?`, a: `${name} is organized by ${event.organizer.name}.` });
  return out;
}

// ─── Listing quality, for the organizer ────────────────────────────────────
/**
 * What would make this listing rank and convert better, in the order it
 * matters, each with whether it is done. Shown to the organizer beside the
 * search preview. Takes the public shape; `toPublicShape` adapts the
 * organizer's own view of the event.
 */
export function seoChecklist(event) {
  const description = squash(event.description);
  const tiers = event.displayOnly ? null : (event.tiers || []);
  return [
    { key: 'cover', done: Boolean(event.coverUrl), label: 'A cover image', why: 'It is the picture in search, on every share and in listings.' },
    { key: 'description', done: description.length >= 150, label: 'A description of at least 150 characters', why: `Search engines need words to match. ${description.length ? `Yours is ${description.length}.` : 'There is none yet.'}` },
    { key: 'venue', done: Boolean(squash(event.venue) && squash(event.venueAddress)), label: 'The venue name and street address', why: 'People search for the venue, and Google shows the address in event results.' },
    { key: 'city', done: Boolean(squash(event.city)), label: 'The city', why: 'Most event searches include the city.' },
    { key: 'pin', done: Boolean(event.venueLocation), label: 'A map pin', why: 'Puts the event on maps and in "near me" results.' },
    ...(tiers ? [{ key: 'tickets', done: tiers.length > 0, label: 'Ticket types with prices', why: 'Prices appear in Google’s event results.' }] : []),
    { key: 'highlights', done: (event.highlights || []).length >= 2, label: 'Two or more highlights', why: 'Short selling points read well in snippets.' },
    { key: 'title', done: squash(event.title).length >= 8 && squash(event.title).length <= 70, label: 'A clear, specific title', why: 'The name people will type. 8 to 70 characters works best.' },
  ];
}

/** The organizer's event (`eventController.shape`) → the fields above read. */
export function toPublicShape(event, tiers = []) {
  return {
    slug: event.slug,
    title: event.title,
    description: event.description,
    venue: event.venue?.name ?? event.venue ?? null,
    venueAddress: event.venueAddress ?? event.venue?.address ?? null,
    city: event.city,
    country: event.country,
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    currency: event.currency,
    category: event.category,
    coverUrl: event.cover?.url ?? event.coverUrl ?? null,
    highlights: event.highlights || [],
    venueLocation: event.venueLocation || null,
    displayOnly: event.listingType === 'display_only' || Boolean(event.displayOnly),
    tiers,
  };
}
