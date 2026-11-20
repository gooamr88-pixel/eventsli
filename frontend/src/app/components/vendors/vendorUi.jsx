/**
 * Pieces shared by the organizer's vendor screens and the vendor portal
 * (2026-11-20). The logo picker and the agreement text are the sponsorship
 * ones (components/sponsors/sponsorUi.jsx) — same upload steps, same rules.
 */

/** An application's status (backend vendorRules.status) → words and a pill. */
export const VENDOR_STATUS = Object.freeze({
  submitted: { label: 'New', pill: 'es-pill--warning' },
  waitlisted: { label: 'Waitlist', pill: '' },
  offered: { label: 'Offer sent', pill: 'es-pill--warning' },
  confirmed: { label: 'Accepted · unpaid', pill: 'es-pill--warning' },
  paid: { label: 'Booked', pill: 'es-pill--accent' },
  rejected: { label: 'Declined', pill: '' },
  withdrawn: { label: 'Withdrawn', pill: '' },
  cancelled: { label: 'Cancelled', pill: 'es-pill--danger' },
});

/** The vendor's own view says the same states in their words. */
export const VENDOR_SELF_STATUS = Object.freeze({
  submitted: { label: 'Application sent', pill: '' },
  waitlisted: { label: 'On the waitlist', pill: '' },
  offered: { label: 'Offer to accept', pill: 'es-pill--warning' },
  confirmed: { label: 'Accepted · fee due', pill: 'es-pill--warning' },
  paid: { label: 'Booked', pill: 'es-pill--accent' },
  rejected: { label: 'Not offered a space', pill: '' },
  withdrawn: { label: 'Withdrawn', pill: '' },
  cancelled: { label: 'Cancelled', pill: 'es-pill--danger' },
});

export function VendorStatus({ status, self = false, expired = false }) {
  if (expired) return <span className="es-pill es-pill--danger">Offer expired</span>;
  const s = (self ? VENDOR_SELF_STATUS : VENDOR_STATUS)[status] || { label: status, pill: '' };
  return <span className={`es-pill ${s.pill}`}>{s.label}</span>;
}

/** A plain starting point for vendor terms. Not legal advice; the screen says so. */
export const STARTER_VENDOR_TERMS = `VENDOR TERMS

1. The vendor pays the booth fee shown in this offer before the event.
2. The organizer provides the space and what this offer includes.
3. The vendor arrives during the load-in time the organizer gives, and leaves the space clean.
4. The vendor holds any licence, permit and insurance its products need, and is responsible for what it sells.
5. Staff passes are for the people the vendor names; they are not tickets and cannot be resold.
6. If the organizer cancels the event, the booth fee is refunded. If the vendor withdraws after accepting, the fee is not refunded unless the organizer agrees in writing.`;
