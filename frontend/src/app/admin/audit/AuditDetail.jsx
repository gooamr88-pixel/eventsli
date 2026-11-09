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
 */
export const VERBS = {
  // Written by a database trigger on every price change, including a live
  // event's (TECH-AUDIT-LOG S-10): ticket types, whole-table prices, seat
  // prices and a table's ticket type. The actor is the organizer who saved it.
  'price.change': ['Changed a price', ''],
  'event.approved': ['Approved an event', 'es-pill--accent'],
  'event.rejected': ['Sent an event back', 'es-pill--warning'],
  'event.suspended': ['Suspended an event', 'es-pill--danger'],
  'event.unsuspended': ['Restored an event', 'es-pill--accent'],
  'event.cancelled': ['Cancelled an event', 'es-pill--danger'],
  'event.fees_changed': ['Changed event fees', ''],
  'event.edited': ['Edited an event', ''],
  'scanner.override': ['Reopened a locked gate', 'es-pill--warning'],
  'scanner.override_ended': ['Ended a gate override', ''],
  'user.blocked': ['Blocked an account', 'es-pill--danger'],
  'user.unblocked': ['Unblocked an account', 'es-pill--accent'],
  'user.role_changed': ['Changed a role', ''],
  'organizer.banned': ['Banned an organizer', 'es-pill--danger'],
  'organizer.unbanned': ['Unbanned an organizer', 'es-pill--accent'],
  'invoice.raised': ['Raised an invoice', ''],
  'invoice.settled': ['Settled an invoice', 'es-pill--accent'],
  'settings.changed': ['Changed a platform setting', ''],
};

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
    case 'scanner.override':
      return [`${show(p.hours)} hours, until ${formatEventTime(p.until)}`];
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
      return [];
  }
}

export default function AuditDetail({ entry }) {
  const payload = entry.payload || {};
  const reason = payload.reason || payload.note;
  const lines = detailLines(entry.action, payload);

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
