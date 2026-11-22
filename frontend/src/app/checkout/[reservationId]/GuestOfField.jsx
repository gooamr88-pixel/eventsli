'use client';

import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "WHOSE GUEST ARE YOU?" at checkout (2026-11-23, the owner: "the guest says
 * 'I come from the groom', and the groom receives an email").
 *
 * The organizer's hosts as large choices — the groom, the bride; two families;
 * the departments of a company — worded as the organizer wrote the question.
 * A host's own link picks them already (lib/guestOf.js); the buyer can change
 * it. When the organizer made it optional, "Prefer not to say" clears it.
 * The host chosen gets an email once the booking is confirmed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function GuestOfField({ guestOf, value, onChange, error = null }) {
  if (!guestOf?.hosts?.length) return null;
  const required = guestOf.mode === 'required';
  return (
    <section className="es-co__card" id="co-guestof" aria-labelledby="co-guestof-title">
      <h2 id="co-guestof-title" className="es-co__h2 es-co__h2--icon">
        <NavIcon name="users" size={20} />
        {guestOf.question}
        {required ? <span className="es-req" aria-hidden="true">*</span> : <span className="es-co__optional">Optional</span>}
      </h2>
      <p className="es-co__sub">They will be told you are coming as their guest.</p>
      <div className="es-guestof" role="radiogroup" aria-labelledby="co-guestof-title" aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'co-guestof-error' : undefined}>
        {guestOf.hosts.map((h) => (
          <label key={h.id} className="es-guestof__choice" data-on={value === h.id ? 'true' : undefined}>
            <input type="radio" name="guest-of" value={h.id} checked={value === h.id} onChange={() => onChange(h.id)} />
            <span className="es-guestof__dot" aria-hidden="true" />
            <span className="es-guestof__name">{h.name}</span>
          </label>
        ))}
        {!required && (
          <label className="es-guestof__choice es-guestof__choice--none" data-on={value === null ? 'true' : undefined}>
            <input type="radio" name="guest-of" value="" checked={value === null} onChange={() => onChange(null)} />
            <span className="es-guestof__dot" aria-hidden="true" />
            <span className="es-guestof__name">Prefer not to say</span>
          </label>
        )}
      </div>
      {error && <p id="co-guestof-error" className="es-co__error" role="alert">{error}</p>}
    </section>
  );
}
