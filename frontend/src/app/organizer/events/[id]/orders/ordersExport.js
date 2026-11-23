import { get } from '../../../../utils/apiClient';
import { formatEventTime } from '../../../../lib/eventTime';
import { minorUnits } from '../../../../lib/markets';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT BOTH ORDER EXPORTS SHARE (2026-11-23) — the Excel file (ordersXlsx.js)
 * and the printed report (OrdersReport.jsx).
 *
 * Built in the browser from the same endpoint the Orders page reads, every page
 * of it, under the filters and search on screen. An export that ignored the
 * filter would hand an organizer who chose "At the door" a file of card sales.
 * 200 rows a request is the API's ceiling (middleware/pagination.js).
 *
 * The headline totals come from the API's `meta.totals`, summed in the database
 * over the whole filtered set — the same numbers as the cards on the page, so
 * the file never disagrees with the screen it was downloaded from. The finer
 * breakdown (discounts, tax, commission) is summed here from the rows, which is
 * safe because here we hold every row, not one page of them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PAGE = 200;

/** Every order under the filters on screen, plus the API's totals for them. */
export async function fetchAllOrders(eventId, { status = 'paid', channel = '', search = '' } = {}) {
  const rows = [];
  let meta = null;
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ status, limit: String(PAGE), page: String(page) });
    if (channel) query.set('channel', channel);
    if (search) query.set('q', search);
    const body = await get(`/events/${eventId}/orders?${query}`, { cache: 'no-store', raw: true, noRedirect: true });
    rows.push(...(body?.data || []));
    if (!meta) meta = body?.meta || null;
    if (page >= (body?.pagination?.totalPages || 1)) return { rows, meta };
  }
}

export const STATUS_LABELS = Object.freeze({
  paid: 'Paid', pending: 'Unfinished', failed: 'Failed', cancelled: 'Cancelled', all: 'Any status',
});
export const CHANNEL_LABELS = Object.freeze({ '': 'Every channel', stripe: 'Card', manual: 'At the door' });

const METHOD_LABELS = { cash: 'Cash', card_terminal: 'Card terminal', etransfer: 'E-transfer', other: 'Other' };

/** "Card", or "Door · Cash" — the channel as the table shows it. */
export function channelText(order) {
  if (order.channel !== 'manual') return 'Card';
  const m = order.manual?.method;
  // Free text in the database (manual_method has no CHECK), so anything else
  // is shown as typed, tidied.
  const typed = m ? String(m).replace(/_/g, ' ') : 'manual';
  return `Door · ${METHOD_LABELS[m] || typed.charAt(0).toUpperCase() + typed.slice(1)}`;
}

/** A short, readable order number: the first eight characters of its id. */
export const orderRef = (order) => String(order.id || '').slice(0, 8).toUpperCase();

/** Cents to the currency's own units — 1999 CAD is 19.99, 1999 JPY is 1999. */
export const toUnits = (cents, currency) => Number(cents || 0) / 10 ** minorUnits(currency);

/** The filters in words, for the report's header and the workbook's summary. */
export function describeFilters({ status = 'paid', channel = '', search = '' } = {}) {
  return [
    STATUS_LABELS[status] || status,
    CHANNEL_LABELS[channel] ?? channel,
    search ? `Matching “${search}”` : null,
  ].filter(Boolean);
}

/**
 * Per-currency summary of the rows: what buyers paid, what the organizer
 * keeps, and the parts in between. Sorted biggest first, so a mostly-CAD event
 * with one stray USD order leads with CAD.
 */
export function summarize(rows, meta) {
  const by = new Map();
  for (const o of rows) {
    const c = o.currency || 'USD';
    if (!by.has(c)) {
      by.set(c, {
        currency: c, orders: 0, tickets: 0, subtotalCents: 0, discountCents: 0, taxCents: 0,
        grossCents: 0, commissionCents: 0, netCents: 0, card: 0, door: 0, cardCents: 0, doorCents: 0,
      });
    }
    const s = by.get(c);
    s.orders += 1;
    s.tickets += Number(o.tickets) || 0;
    s.subtotalCents += Number(o.subtotalCents) || 0;
    s.discountCents += Number(o.discountCents) || 0;
    s.taxCents += Number(o.taxCents) || 0;
    s.grossCents += Number(o.buyerPaidCents) || 0;
    s.commissionCents += Number(o.commissionCents) || 0;
    s.netCents += Number(o.organizerNetCents) || 0;
    if (o.channel === 'manual') { s.door += 1; s.doorCents += Number(o.buyerPaidCents) || 0; } else { s.card += 1; s.cardCents += Number(o.buyerPaidCents) || 0; }
  }
  // The database's totals win where they exist: they are what the page shows.
  for (const [c, t] of Object.entries(meta?.totals || {})) {
    const s = by.get(c);
    if (!s) continue;
    if (Number.isFinite(Number(t.grossCents))) s.grossCents = Number(t.grossCents);
    if (Number.isFinite(Number(t.netCents))) s.netCents = Number(t.netCents);
  }
  return [...by.values()].sort((a, b) => b.orders - a.orders);
}

/** When an order happened, on the event's clock with the zone named. */
export const orderWhen = (order, timezone) => formatEventTime(order.paidAt || order.createdAt, timezone);

/** The event's date and place in one line, for headers. */
export function eventLine(event) {
  if (!event) return '';
  const when = event.startsAt ? formatEventTime(event.startsAt, event.timezone) : null;
  const venue = typeof event.venue === 'string' ? event.venue : event.venue?.name || event.venueName || null;
  return [when, [venue, event.city].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ');
}

/** `orders-ladies-night-2026-11-23` — safe on every file system. */
export function fileBase(event, now = new Date()) {
  const slug = String(event?.slug || 'event').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
  const day = now.toISOString().slice(0, 10);
  return `orders-${slug}-${day}`;
}

/** Hands the browser a file to save. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
