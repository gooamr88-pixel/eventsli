'use client';

import NavIcon from '../../components/shell/NavIcon';
import { PhoneInput } from '../../components/forms/PhoneField';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Who each ticket is for (owner's reference, 2026-11-19): on an order of two
 * or more tickets, a card per ticket — first name, last name, phone, email.
 *
 * The event decides how strict (`mode`): 'required' asks the first name on
 * every ticket, 'optional' asks nothing. The API sends no slots for a
 * one-ticket order (that ticket is the buyer's) or when the event asks none,
 * and this renders nothing.
 *
 * Inside the page's one <form>, so a missing required name stops the Pay
 * button the same way a missing email does. "Same as my details" fills the
 * first card from the buyer's own, the usual case for ticket one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HolderForms({ holders, values, onChange, buyer, phone, error, lead = false }) {
  const slots = holders?.slots || [];
  if (slots.length === 0) return null;
  // 'full' (2026-11-24): the organizer requires first AND last name on every ticket.
  const full = holders.mode === 'full';
  const required = full || holders.mode === 'required';
  /* `lead` — a FREE order (owner, 2026-11-22: "no need to contact info, just
     ticket holder info"). There is no "Your details" card: ticket 1 is the
     lead guest, and the page sends their details as the buyer's. Only the
     first name is required (owner, same day: "Name only") — the tickets show
     on screen once booked, and go to the email too when one is given. */
  const set = (key, field) => (e) => onChange({ ...values, [key]: { ...values[key], [field]: e.target.value } });

  function fillFromBuyer(key) {
    const parts = String(buyer.name || '').trim().split(/\s+/).filter(Boolean);
    onChange({
      ...values,
      [key]: {
        ...values[key],
        firstName: parts[0] || values[key]?.firstName || '',
        lastName: parts.slice(1).join(' ') || values[key]?.lastName || '',
        email: buyer.email || values[key]?.email || '',
        phone: phone || values[key]?.phone || '',
      },
    });
  }

  return (
    <section className="es-co__card es-holders" aria-labelledby="co-holders">
      <h2 id="co-holders" className="es-co__h2 es-co__h2--icon">
        <NavIcon name="users" size={20} />
        Who are the tickets for?
      </h2>
      <p className="es-co__sub">
        {lead
          ? (full ? 'No account needed — just your first and last name. Your tickets appear as soon as you book.' : 'No account needed — just a first name. Your tickets appear as soon as you book.')
          : full ? 'The first and last name of each guest, printed on their ticket and checked at the door.'
            : required ? 'A first name for each ticket, printed on it and shown at the door.' : 'Optional — a name is printed on each ticket.'}
      </p>
      <ol className="es-holders__list">
        {slots.map((slot, i) => {
          const v = values[slot.key] || {};
          const wrong = error?.key === slot.key;
          const id = `holder-${i}`;
          const isLead = lead && i === 0;
          if (isLead) {
            return (
              <li key={slot.key} id={id} className={`es-holders__card es-holders__card--lead${wrong ? ' is-wrong' : ''}`}>
                <div className="es-holders__head">
                  <span className="es-holders__icon" aria-hidden><NavIcon name="ticket" size={18} /></span>
                  <p className="es-holders__title">
                    {slot.title}
                    {(slot.place || slot.tierName) && <span> · {slot.place || slot.tierName}</span>}
                  </p>
                  <span className="es-holders__badge">Lead guest</span>
                </div>
                {wrong && <p role="alert" className="es-holders__error">{error.message}</p>}
                <div className="es-holders__grid">
                  <Input id={`${id}-first`} label="First name" icon="user" required maxLength={60} autoComplete="given-name"
                    value={v.firstName} onChange={set(slot.key, 'firstName')} />
                  <Input id={`${id}-last`} label="Last name" icon="user" required={full} maxLength={60} autoComplete="family-name"
                    value={v.lastName} onChange={set(slot.key, 'lastName')} />
                  <Input id={`${id}-email`} label="Email" icon="mail" type="email" inputMode="email" maxLength={254}
                    autoComplete="email" value={v.email} onChange={set(slot.key, 'email')} />
                  <div className="es-holders__field">
                    <label htmlFor={`${id}-phone`}>Phone</label>
                    <PhoneInput id={`${id}-phone`} placeholder="Optional" value={v.phone || ''} autoComplete="tel"
                      onChange={(p) => onChange({ ...values, [slot.key]: { ...values[slot.key], phone: p } })} />
                  </div>
                </div>
                <p className="es-holders__hint"><NavIcon name="mail" size={15} />Add an email to get a copy of your tickets — otherwise save them after booking.</p>
              </li>
            );
          }
          return (
            <li key={slot.key} id={id} className={`es-holders__card${wrong ? ' is-wrong' : ''}`}>
              <div className="es-holders__head">
                <span className="es-holders__icon" aria-hidden><NavIcon name="ticket" size={18} /></span>
                <p className="es-holders__title">
                  {slot.title}
                  {(slot.place || slot.tierName) && <span> · {slot.place || slot.tierName}</span>}
                </p>
                {i === 0 && !lead && (buyer.name || buyer.email) && (
                  <button type="button" className="es-holders__mine" onClick={() => fillFromBuyer(slot.key)}>Use my details</button>
                )}
              </div>
              {wrong && <p role="alert" className="es-holders__error">{error.message}</p>}
              <div className="es-holders__grid">
                <Input id={`${id}-first`} label="First name" icon="user" required={required} maxLength={60}
                  value={v.firstName} onChange={set(slot.key, 'firstName')} />
                <Input id={`${id}-last`} label="Last name" icon="user" required={full} maxLength={60}
                  value={v.lastName} onChange={set(slot.key, 'lastName')} />
                {/* The flag picker (2026-11-19) in place of the phone icon. */}
                <div className="es-holders__field">
                  <label htmlFor={`${id}-phone`}>Phone</label>
                  <PhoneInput id={`${id}-phone`} placeholder="Optional" value={v.phone || ''} autoComplete="off"
                    onChange={(phone) => onChange({ ...values, [slot.key]: { ...values[slot.key], phone } })} />
                </div>
                <Input id={`${id}-email`} label="Email" icon="mail" type="email" inputMode="email" maxLength={254}
                  value={v.email} onChange={set(slot.key, 'email')} />
              </div>
            </li>
          );
        })}
      </ol>
      {slots.length > 1 && <p className="es-holders__note">Add an email and that person gets their own ticket.</p>}
    </section>
  );
}

/**
 * One compact field, as the reference has them: a short label (a star when
 * required) over the box, "Optional" or "Required" inside it. No badges —
 * on a phone, four labelled fields per ticket with a pill each was a wall.
 */
function Input({ id, label, icon, required = false, value, autoComplete = 'off', ...props }) {
  return (
    <div className="es-holders__field">
      <label htmlFor={id}>{label}{required && <i aria-hidden="true"> *</i>}</label>
      {/* The icon inside the box (owner, 2026-11-19: "put svgs"), as the
          reference has its flag in the phone field. Decorative: the label names it. */}
      <span className="es-holders__box">
        {icon && <NavIcon name={icon} size={18} className="es-holders__glyph" />}
        <input id={id} className="es-input" autoComplete={autoComplete} required={required}
          placeholder={required ? 'Required' : 'Optional'} value={value || ''} {...props} />
      </span>
    </div>
  );
}

/** The holders as the API takes them: one entry per slot, in slot order. */
export function holderPayload(holders, values) {
  return (holders?.slots || []).map((slot) => ({
    key: slot.key,
    firstName: values[slot.key]?.firstName?.trim() || undefined,
    lastName: values[slot.key]?.lastName?.trim() || undefined,
    phone: values[slot.key]?.phone?.trim() || undefined,
    email: values[slot.key]?.email?.trim() || undefined,
  }));
}
