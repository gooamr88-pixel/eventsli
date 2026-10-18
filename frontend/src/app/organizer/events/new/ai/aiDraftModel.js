import { toIso, toLocalInput } from '../../../../lib/eventTime';
import { pinProblem } from '../../../../components/forms/VenuePin';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SMART EVENT CREATOR'S DRAFT — what the review screen edits, what blocks
 * saving, and the exact requests that save it.
 *
 * Pure, like `wizardModel.js` beside the manual wizard: everything here is
 * data and functions so it can be tested without rendering a screen.
 *
 * THE DRAFT IS A FORM, NOT AN EVENT. Nothing exists on the server until the
 * organizer presses "Save draft", and then it is saved through the same
 * endpoints the manual screens use (`savePlan` below) — the AI endpoint only
 * ever proposed it.
 *
 * WHAT BLOCKS SAVING is the same as the manual wizard, plus one owner rule:
 *   · a title, a start and an end — the row cannot exist without them;
 *   · a half-typed map pin — the database refuses one;
 *   · D-018: an included ticket type with no price. The organizer enters
 *     one, ticks "free", or removes it. The AI never fills that gap.
 * The venue, address and city do NOT block a draft, exactly as in the manual
 * wizard (`SUBMIT_ONLY_FIELDS`): they are required to submit for review, and
 * forcing them earlier only produces "TBC" on a public page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const STORAGE_KEY = 'eventsli.newEvent.ai';
export const MIN_DESCRIPTION = 40;
export const MAX_DESCRIPTION = 2000;
export const MAX_HIGHLIGHTS = 12;

export const TIER_KINDS = [
  ['standard', 'Standard'], ['general', 'General admission'], ['vip', 'VIP'],
  ['early_bird', 'Early bird'], ['complimentary', 'Complimentary'],
];

let counter = 0;
const key = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

/** "95" / "95.5" / "95.50" → 9550, or null. Strings only — no float arithmetic on money. */
export function priceToCents(value) {
  const text = String(value ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** 9550 → "95.50"; null → "". */
export function centsToPrice(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return '';
  const n = Math.round(Number(cents));
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/** The API's answer → the form the review screen edits. */
export function formFromDraft(result, organizer) {
  const d = result.draft;
  const tz = d.timezone;
  return {
    generationId: result.generationId,
    listingType: d.listingType,
    country: d.country,
    timezone: tz,
    currency: d.currency,
    title: d.title || '',
    category: d.category || 'other',
    description: d.description || '',
    startsAt: d.startsAt?.at ? toLocalInput(d.startsAt.at, tz) : '',
    endsAt: d.endsAt?.at ? toLocalInput(d.endsAt.at, tz) : '',
    // Shown under the field, so the organizer can check how their words were read.
    startEvidence: d.startsAt?.evidence || null,
    endEvidence: d.endsAt?.evidence || null,
    venueName: d.venueName?.value || '',
    venueAddress: d.venueAddress?.value || '',
    city: d.city?.value || '',
    // Never from the AI: a pin comes from venue search or from the organizer.
    venuePlaceId: '', venueLat: '', venueLng: '',
    admissionType: d.admissionType || 'general',
    purchaseMode: d.purchaseMode || 'seat_only',
    highlights: Array.isArray(d.highlights) ? d.highlights.slice(0, MAX_HIGHLIGHTS) : [],
    tiers: (d.tiers || []).map((t) => ({
      key: key('tier'),
      name: t.name || '',
      kind: t.kind || 'standard',
      description: t.description || '',
      quantity: t.quantity === null || t.quantity === undefined ? '' : String(t.quantity),
      price: centsToPrice(t.priceCents),
      free: t.priceCents === 0,
      priceEvidence: t.priceEvidence || null,
    })),
    schedule: (d.schedule || []).map((s) => ({
      key: key('row'),
      title: s.title || '',
      startsAt: s.startsAt ? toLocalInput(s.startsAt, tz) : '',
      location: s.location || '',
    })),
    // Set by the organizer on the Save step, never by the AI.
    feeBearer: 'buyer',
    paymentOption: organizer?.payments?.choices?.[0] || '',
    maxTicketsPerOrder: '10',
    allowTicketTransfer: true,
  };
}

export const newTier = () => ({
  key: key('tier'), name: '', kind: 'standard', description: '', quantity: '', price: '', free: false, priceEvidence: null,
});
export const newScheduleRow = () => ({ key: key('row'), title: '', startsAt: '', location: '' });

/**
 * Everything that stops "Save draft", in reading order, each tied to the
 * section that fixes it. `[]` means ready.
 */
export function problemsFor(form, now = new Date()) {
  const out = [];
  const add = (section, field, message) => out.push({ section, field, message });
  const startIso = toIso(form.startsAt, form.timezone);
  const endIso = toIso(form.endsAt, form.timezone);

  if (form.title.trim().length < 3) add('basics', 'title', 'Give the event a title of at least 3 characters.');
  if (!form.startsAt) add('when', 'startsAt', 'When does it start?');
  else if (new Date(startIso) <= now) add('when', 'startsAt', 'The start has to be in the future.');
  if (!form.endsAt) add('when', 'endsAt', 'When does it end?');
  else if (form.startsAt && new Date(endIso) <= new Date(startIso)) add('when', 'endsAt', 'It has to end after it starts.');
  const pin = pinProblem({ lat: form.venueLat, lng: form.venueLng });
  if (pin) add('when', 'venuePin', pin);

  if (form.listingType !== 'display_only') {
    const names = new Set();
    form.tiers.forEach((t, i) => {
      const label = t.name.trim() || `Ticket type ${i + 1}`;
      if (!t.name.trim()) add('tickets', `tier-${t.key}-name`, `${label} needs a name.`);
      else if (names.has(t.name.trim().toLowerCase())) add('tickets', `tier-${t.key}-name`, `There are two ticket types called “${t.name.trim()}”.`);
      names.add(t.name.trim().toLowerCase());
      if (!t.free && priceToCents(t.price) === null) {
        add('tickets', `tier-${t.key}-price`, t.price.trim()
          ? `${label}: enter the price as a number, like 25 or 25.50.`
          : `${label} needs a price.`);
      }
      if (form.admissionType === 'general' && t.quantity !== '' && !(Number.isInteger(Number(t.quantity)) && Number(t.quantity) >= 1)) {
        add('tickets', `tier-${t.key}-quantity`, `${label}: the number of tickets is a whole number.`);
      }
    });
  }

  form.schedule.forEach((s, i) => {
    if (!s.title.trim()) add('schedule', `row-${s.key}-title`, `Schedule item ${i + 1} needs a name.`);
  });
  return out;
}

/** The submit-only gaps: shown in the section, never blocking a draft. */
export function laterNeeds(form) {
  return [
    !form.venueName.trim() && 'the venue name',
    !form.venueAddress.trim() && 'the street address',
    !form.city.trim() && 'the city',
  ].filter(Boolean);
}

/**
 * The requests that save the draft, in order, through the existing endpoints
 * (D-007). The event first; then what hangs off it. Nothing in here is a fee,
 * a commission or a status — `POST /events` makes a private draft and the
 * organizer submits it later, from the event, like any other.
 */
export function savePlan(form, choices = []) {
  const ticketed = form.listingType !== 'display_only';
  const event = {
    title: form.title.trim(),
    category: form.category,
    country: form.country,
    timezone: form.timezone,
    startsAt: toIso(form.startsAt, form.timezone),
    endsAt: toIso(form.endsAt, form.timezone),
    listingType: form.listingType,
    aiGenerationId: form.generationId,
    ...(ticketed ? {
      admissionType: form.admissionType,
      purchaseMode: form.admissionType === 'reserved' ? form.purchaseMode : 'seat_only',
      feeBearer: form.feeBearer,
      maxTicketsPerOrder: Number(form.maxTicketsPerOrder),
      allowTicketTransfer: form.allowTicketTransfer,
      ...(form.paymentOption && choices.includes(form.paymentOption) ? { paymentOption: form.paymentOption } : {}),
    } : {}),
    ...(form.venueName.trim() ? { venueName: form.venueName.trim() } : {}),
    ...(form.venueAddress.trim() ? { venueAddress: form.venueAddress.trim() } : {}),
    ...(form.city.trim() ? { city: form.city.trim() } : {}),
    ...(form.venuePlaceId ? { venuePlaceId: form.venuePlaceId } : {}),
    ...(form.venueLat !== '' && form.venueLng !== '' ? { venueLat: Number(form.venueLat), venueLng: Number(form.venueLng) } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };

  const tiers = ticketed ? form.tiers.map((t, i) => ({
    key: t.key,
    label: t.name.trim(),
    body: {
      name: t.name.trim(),
      kind: t.kind,
      priceCents: t.free ? 0 : priceToCents(t.price),
      sortOrder: i,
      ...(t.description.trim() ? { description: t.description.trim() } : {}),
      ...(form.admissionType === 'general' && t.quantity !== '' ? { quantity: Number(t.quantity) } : {}),
    },
  })) : [];

  const schedule = form.schedule.map((s) => ({
    key: s.key,
    label: s.title.trim(),
    body: {
      title: s.title.trim(),
      ...(s.startsAt ? { startsAt: toIso(s.startsAt, form.timezone) } : {}),
      ...(s.location.trim() ? { location: s.location.trim() } : {}),
    },
  }));

  const highlights = form.highlights.map((h) => h.trim()).filter(Boolean).slice(0, MAX_HIGHLIGHTS);
  return { event, highlights, tiers, schedule };
}

/** How each section stands, for the rail and the review blocks. */
export function sectionState(form, problems) {
  const has = (section) => problems.filter((p) => p.section === section);
  const sections = [
    ['basics', 'Title and category'],
    ['when', 'When and where'],
    ['about', 'About and highlights'],
    ...(form.listingType !== 'display_only' ? [['tickets', 'Ticket types']] : []),
    ['schedule', 'Schedule'],
  ];
  return sections.map(([id, label]) => ({ id, label, problems: has(id) }));
}
