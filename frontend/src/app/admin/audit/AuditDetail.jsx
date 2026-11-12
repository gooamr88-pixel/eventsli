import { formatEventTime } from '../../lib/eventTime';

/**
 * What one audit row actually says.
 *
 * The log used to render only `reason` or `note`. Role, fee, rule and settings
 * changes record `{ before, after }` and no reason, so every one of them read
 * "No reason recorded" — the change itself was in the row and invisible. Each
 * verb now shows its own payload: the old value and the new one, the hours of
 * an override, how many events a ban left on sale.
 *
 * The verbs are the ones the backend writes (grep `action: '` and `audit(req, '`).
 * The SMS, storefront and event-lifecycle verbs were missing, so their rows
 * showed a raw code and "No details recorded" over a payload that held the
 * change. A verb with no case below now shows its payload as plain lines.
 */
export const VERB_GROUPS = [
  ['Events', {
    // Written by a database trigger on every price change, including a live
    // event's (TECH-AUDIT-LOG S-10): ticket types, whole-table prices, seat
    // prices and a table's ticket type. The actor is the organizer who saved it.
    'price.change': ['Changed a price', ''],
    'event.approved': ['Approved an event', 'es-pill--accent'],
    'event.rejected': ['Sent an event back', 'es-pill--warning'],
    'event.suspended': ['Suspended an event', 'es-pill--danger'],
    'event.unsuspended': ['Restored an event', 'es-pill--accent'],
    'event.cancelled': ['Cancelled an event', 'es-pill--danger'],
    'event.cancellation_requested': ['Asked to cancel an event', 'es-pill--warning'],
    'event.cancellation_withdrawn': ['Withdrew a cancellation request', ''],
    'event.cancellation_approved': ['Approved a cancellation', 'es-pill--danger'],
    'event.cancellation_rejected': ['Refused a cancellation', ''],
    'event.fees_changed': ['Changed event fees', ''],
    'event.edited': ['Edited an event', ''],
    'event.archived': ['Archived an event', ''],
    'event.restored': ['Restored an archived event', ''],
    'event.draft_deleted': ['Deleted a draft', 'es-pill--warning'],
    'scanner.mode': ['Changed door scanning', 'es-pill--warning'],
    'scanner.override': ['Reopened a locked gate', 'es-pill--warning'],
    'scanner.override_ended': ['Ended a gate override', ''],
  }],
  ['Accounts', {
    'user.blocked': ['Blocked an account', 'es-pill--danger'],
    'user.unblocked': ['Unblocked an account', 'es-pill--accent'],
    'user.role_changed': ['Changed a role', ''],
    'organizer.banned': ['Banned an organizer', 'es-pill--danger'],
    'organizer.unbanned': ['Unbanned an organizer', 'es-pill--accent'],
  }],
  ['Money and settings', {
    'invoice.raised': ['Raised an invoice', ''],
    'invoice.settled': ['Settled an invoice', 'es-pill--accent'],
    'settings.changed': ['Changed a platform setting', ''],
  }],
  ['Storefront', {
    'storefront.content_saved': ['Edited site content', ''],
    'storefront.sponsor_created': ['Added a sponsor', ''],
    'storefront.sponsor_updated': ['Edited a sponsor', ''],
    'storefront.sponsor_deleted': ['Removed a sponsor', 'es-pill--warning'],
    'storefront.testimonial_created': ['Added a testimonial', ''],
    'storefront.testimonial_updated': ['Edited a testimonial', ''],
    'storefront.testimonial_deleted': ['Removed a testimonial', 'es-pill--warning'],
    'storefront.category_created': ['Added a category', ''],
    'storefront.category_updated': ['Edited a category', ''],
    'storefront.category_deleted': ['Removed a category', 'es-pill--warning'],
    'storefront.reordered': ['Reordered the storefront', ''],
  }],
  // The SMS controllers prefix every verb they write with `sms.`.
  ['SMS', {
    'sms.country.created': ['Added an SMS country', ''],
    'sms.country.updated': ['Edited an SMS country', ''],
    'sms.country.verified': ['Verified an SMS country', 'es-pill--accent'],
    'sms.country.enabled': ['Turned on SMS to a country', 'es-pill--accent'],
    'sms.country.disabled': ['Turned off SMS to a country', 'es-pill--warning'],
    'sms.country.blocked': ['Blocked SMS to a country', 'es-pill--danger'],
    'sms.country.unverified': ['Marked an SMS country unverified', 'es-pill--warning'],
    'sms.country.resumed': ['Resumed a paused SMS country', ''],
    'sms.route.saved': ['Saved an SMS route', ''],
    'sms.route.deleted': ['Removed an SMS route', 'es-pill--warning'],
    'sms.provider.updated': ['Edited an SMS provider', ''],
    'sms.provider.circuit_reset': ['Reset an SMS provider', ''],
    'sms.provider.pricing_sync': ['Synced SMS prices', ''],
    'sms.sender.created': ['Added an SMS sender', ''],
    'sms.sender.updated': ['Edited an SMS sender', ''],
    'sms.sender.deleted': ['Removed an SMS sender', 'es-pill--warning'],
    'sms.category.updated': ['Edited an SMS category', ''],
    'sms.settings.updated': ['Changed SMS settings', ''],
    'sms.segment.created': ['Created an SMS audience', ''],
    'sms.segment.updated': ['Edited an SMS audience', ''],
    'sms.segment.deleted': ['Deleted an SMS audience', 'es-pill--warning'],
    'sms.campaign.created': ['Created an SMS campaign', ''],
    'sms.campaign.updated': ['Edited an SMS campaign', ''],
    'sms.campaign.submitted': ['Submitted an SMS campaign', ''],
    'sms.campaign.approved': ['Approved an SMS campaign', 'es-pill--accent'],
    'sms.campaign.rejected': ['Sent back an SMS campaign', 'es-pill--warning'],
    'sms.campaign.cancelled': ['Cancelled an SMS campaign', 'es-pill--danger'],
    'sms.message.retried': ['Retried a text message', ''],
    'sms.message.cancelled': ['Cancelled a text message', ''],
    'sms.test.sent': ['Sent a test text', ''],
    'sms.suppression.added': ['Stopped texts to a number', 'es-pill--warning'],
    'sms.suppression.removed': ['Allowed texts to a number again', ''],
    'sms.consent.imported': ['Imported SMS consent', ''],
  }],
];

export const VERBS = Object.assign({}, ...VERB_GROUPS.map(([, verbs]) => verbs));

/** A verb this page has no label for still reads as words, not as a code. */
export function verbOf(action) {
  if (VERBS[action]) return VERBS[action];
  const text = String(action || 'unknown action').replace(/[._]+/g, ' ').trim();
  return [text.charAt(0).toUpperCase() + text.slice(1), ''];
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** The fields that differ between two objects, each as "field: old → new". */
function differences(before, after) {
  const a = isObject(before) ? before : {};
  const b = isObject(after) ? after : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => `${key}: ${show(a[key])} → ${show(b[key])}`);
}

function detailLines(action, p) {
  switch (action) {
    case 'user.role_changed':
      return [`${show(p.before)} → ${show(p.after)}`];
    case 'event.fees_changed':
    case 'event.edited':
      return differences(p.before, p.after);
    case 'settings.changed':
      return [
        `Setting: ${show(p.key)}${p.before === null || p.before === undefined ? ' (first saved)' : ''}`,
        ...(isObject(p.after) ? differences(p.before, p.after) : [`${show(p.before)} → ${show(p.after)}`]),
      ];
    // All three go through applyGateMode (scanController.js), whose payload is
    // { mode, until, reason, before, after } — there is no `hours`, so the old
    // override line read "— hours".
    case 'scanner.mode':
    case 'scanner.override':
    case 'scanner.override_ended': {
      const MODES = { auto: 'Follow the invoice', open: 'Keep open', closed: 'Keep closed' };
      const scanning = (gate) => (gate?.locked === true ? 'off' : gate?.locked === false ? 'on' : null);
      const was = scanning(p.before);
      const now = scanning(p.after);
      return [
        `${MODES[p.mode] || show(p.mode)}${p.until ? ` until ${formatEventTime(p.until)}` : ''}`,
        ...(was && now ? [was === now ? `Scanning stayed ${now}` : `Scanning turned ${now}`] : []),
      ];
    }
    case 'organizer.banned':
      return p.publishedEvents ? [`${p.publishedEvents} published ${p.publishedEvents === 1 ? 'event was' : 'events were'} left on sale`] : [];
    case 'event.suspended':
    case 'event.cancelled':
      return p.openCheckoutsClosed ? [`${p.openCheckoutsClosed} open checkouts closed`] : [];
    case 'invoice.raised':
      return [[p.number, p.orderCount !== null && p.orderCount !== undefined ? `${p.orderCount} door sales` : null]
        .filter(Boolean).join(' · ')].filter(Boolean);
    case 'invoice.settled':
      return p.alreadySettled ? ['It was already settled'] : [];
    case 'price.change': {
      // Amounts are cents in the event's own currency, which the payload does
      // not carry — so they are shown as plain amounts, never with a symbol
      // that might be the wrong one.
      const amount = (c) => (c === null || c === undefined ? 'none' : (Number(c) / 100).toFixed(2));
      const what = p.name ? `Ticket type "${p.name}"` : `Table "${show(p.label)}"`;
      const field = { price: p.name ? 'price' : 'whole-table price', seatPrice: 'seat price', ticketType: 'ticket type' }[p.field] || p.field;
      const change = p.field === 'ticketType'
        ? 'moved to another ticket type'
        : `${amount(p.oldCents)} → ${amount(p.newCents)}`;
      return [
        `${what}, ${field}: ${change}`,
        p.eventStatus === 'published' ? 'The event was on sale' : `The event was ${show(p.eventStatus)}`,
        ...(p.soldBefore ? [`${p.soldBefore} already sold keep their price`] : []),
      ];
    }
    default:
      return generic(p);
  }
}

/** "openCheckoutsClosed" and "sender_id_support" as words. */
const words = (key) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const clip = (text) => (text.length > 200 ? `${text.slice(0, 199)}…` : text);

// Not worth a line of their own: the reason and note are quoted above the
// lines, the diff keys are expanded below, and a row id is unreadable.
const SKIP = new Set(['reason', 'note', 'before', 'after', 'changes', 'changed', 'id', 'requestId']);

/**
 * For a verb with no case of its own: whatever its payload carries, as lines.
 * The storefront and SMS verbs record a `changes` object, a `changed` list of
 * field names, or a few plain fields, and showing those as they are beats
 * "No details recorded" over a row that recorded plenty.
 */
function generic(p) {
  const lines = [];
  if ('before' in p || 'after' in p) {
    lines.push(...(isObject(p.before) || isObject(p.after)
      ? differences(p.before, p.after)
      : [`${show(p.before)} → ${show(p.after)}`]));
  }
  if (isObject(p.changes)) {
    lines.push(...Object.entries(p.changes).map(([key, v]) => `${words(key)}: ${show(v)}`));
  }
  if (Array.isArray(p.changed) && p.changed.length) lines.push(`Changed: ${p.changed.map(words).join(', ')}`);
  for (const [key, v] of Object.entries(p)) {
    if (SKIP.has(key) || v === null || v === undefined || v === '') continue;
    lines.push(`${words(key)}: ${Array.isArray(v) ? `${v.length} ${v.length === 1 ? 'item' : 'items'}` : show(v)}`);
  }
  return lines.map(clip);
}

export default function AuditDetail({ entry }) {
  const payload = entry.payload || {};
  const reason = payload.reason || payload.note;
  // A cancellation decision carries both: the organizer's reason and the admin's note.
  const note = payload.reason && payload.note ? [`Note: ${payload.note}`] : [];
  const lines = [...note, ...detailLines(entry.action, payload)];

  if (!reason && lines.length === 0) return <span className="text-subtle">No details recorded</span>;

  return (
    <span className="fx-stack fx-stack--sm gap-0.5">
      {reason && <span className="fx-break text-ink">“{reason}”</span>}
      {lines.map((line) => (
        <span key={line} className="fx-break font-mono text-xs text-muted">{line}</span>
      ))}
    </span>
  );
}
