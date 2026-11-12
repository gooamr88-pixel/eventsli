import { formatEventTime } from './eventTime';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN EVENT'S GATE IS DOING, IN WORDS — for every screen that shows it.
 *
 * The gate is decided in one place (`scanner_is_locked` in the database) and
 * comes back as `{ locked, reason, mode, mode_until, mode_reason, … }`. Every
 * page used to word it for itself, and every one said the same thing whatever
 * the reason: "settle your commission invoice". That is wrong when an admin
 * closed the gate, when the event was cancelled, or when an admin is keeping
 * it open despite an overdue invoice. One function, every reason.
 *
 *   tone   'success' | 'warning' | 'danger' | 'neutral'
 *   title  one line: "Scanning is on" / "Scanning is switched off"
 *   detail the reason, in the reader's terms
 *   audience 'organizer' | 'admin' | 'door' — what each needs told
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function describeGate(gate, { timezone, audience = 'organizer' } = {}) {
  if (!gate) return { tone: 'neutral', title: 'Checking…', detail: null, locked: false };
  const until = gate.mode_until ? formatEventTime(gate.mode_until, timezone) : null;
  const admin = audience === 'admin';

  if (gate.locked) {
    switch (gate.reason) {
      case 'event_cancelled':
        return { tone: 'danger', locked: true, title: 'Scanning is off', detail: 'This event was cancelled. Nobody is admitted on its tickets.' };
      case 'admin_closed':
        return {
          tone: 'danger', locked: true, title: 'Scanning is switched off by Eventsli',
          detail: [
            until ? `Until ${until}.` : 'Until Eventsli switches it back on.',
            gate.mode_reason ? (admin ? `Reason: ${gate.mode_reason}` : `Reason given: ${gate.mode_reason}`) : null,
          ].filter(Boolean).join(' '),
        };
      case 'commission_overdue':
        return {
          tone: 'danger', locked: true, title: 'Scanning is switched off',
          detail: audience === 'door'
            ? 'The organizer has an overdue commission invoice. Ask them to settle it.'
            : admin
              ? `${gate.overdue_invoices || 1} overdue commission ${gate.overdue_invoices === 1 ? 'invoice' : 'invoices'}. It reopens by itself once settled, waived or given a new due date.`
              : 'A commission invoice is overdue. Scanning comes back on by itself as soon as it is settled.',
        };
      default:
        return { tone: 'danger', locked: true, title: 'Scanning is switched off', detail: null };
    }
  }

  if (gate.reason === 'admin_open' || gate.override) {
    return {
      tone: admin && gate.overdue_invoices ? 'warning' : 'success', locked: false,
      title: admin ? 'Kept open by an admin' : 'Scanning is on',
      detail: [
        until ? `Until ${until}.` : (admin ? 'Until changed.' : null),
        admin && gate.overdue_invoices ? `${gate.overdue_invoices} overdue ${gate.overdue_invoices === 1 ? 'invoice is' : 'invoices are'} not enforced while it is.` : null,
        admin && gate.mode_reason ? `Reason: ${gate.mode_reason}` : null,
      ].filter(Boolean).join(' ') || null,
    };
  }

  if (gate.reason === 'enforcement_off') {
    return {
      tone: admin && gate.overdue_invoices ? 'warning' : 'success', locked: false, title: 'Scanning is on',
      detail: admin ? `Invoice enforcement is switched off for the platform${gate.overdue_invoices ? ` — ${gate.overdue_invoices} overdue` : ''}.` : null,
    };
  }

  if (gate.locks_at) {
    return {
      tone: 'warning', locked: false, title: 'Scanning is on',
      detail: `It switches off ${formatEventTime(gate.locks_at, timezone)} unless the open invoice is settled first.`,
    };
  }

  return { tone: 'success', locked: false, title: 'Scanning is on', detail: null };
}

/** The admin's mode, as a label for a pill. */
export function gateModeLabel(gate) {
  if (!gate) return '—';
  if (gate.reason === 'event_cancelled') return 'Cancelled';
  return { auto: 'Following invoices', open: 'Kept open', closed: 'Kept closed' }[gate.mode || 'auto'] || 'Following invoices';
}
