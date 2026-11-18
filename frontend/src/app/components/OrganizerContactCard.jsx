'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import NavIcon from './shell/NavIcon';
import { post } from '../utils/apiClient';
import { describeError } from '../utils/errors';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Contact the organizer" on a bought ticket (owner, 2026-11-18: "ability to
 * message and see his profile details").
 *
 * WHAT IT SHOWS. The organizer's name and logo, a link to their public page,
 * and only the contact details they chose to publish. Their account email is
 * never here.
 *
 * THE MESSAGE goes through Eventsli: it is emailed to the organizer with the
 * buyer as reply-to, so the answer lands in the buyer's inbox. It needs the
 * order's link token — the proof of holding a ticket — so the form appears
 * only where that token is on the page (the emailed ticket link and the
 * confirmation right after buying).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrganizerContactCard({ organizer, fallbackName = null, orderToken = null, className = '' }) {
  const name = organizer?.name || fallbackName;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ busy: false, sent: false, error: null });
  const ids = useId();

  if (!name) return null;

  const contact = organizer?.contact || {};
  const social = Array.isArray(organizer?.social) ? organizer.social : [];
  const hasDetails = contact.email || contact.phone || contact.website || social.length > 0;

  async function send(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState({ busy: true, sent: false, error: null });
    try {
      await post(`/public/t/${encodeURIComponent(orderToken)}/contact`, {
        name: String(form.get('name') || '').trim() || undefined,
        message: String(form.get('message') || ''),
      });
      setState({ busy: false, sent: true, error: null });
    } catch (err) {
      const d = describeError(err);
      setState({ busy: false, sent: false, error: err?.message || d?.recovery || 'Your message could not be sent. Try again.' });
    }
  }

  return (
    <section className={`es-orgcard ${className}`} aria-labelledby={`${ids}-title`}>
      <div className="es-orgcard__head">
        <span className="es-orgcard__logo" aria-hidden="true">
          {organizer?.logoUrl
            // eslint-disable-next-line @next/next/no-img-element -- the organizer's own logo, from our storage
            ? <img src={organizer.logoUrl} alt="" />
            : <span>{name.slice(0, 1).toUpperCase()}</span>}
        </span>
        <div className="fx-min0">
          <p className="es-orgcard__kicker">Organized by</p>
          <h2 id={`${ids}-title`} className="es-orgcard__name fx-break">{name}</h2>
        </div>
        {organizer?.slug && (
          <Link href={`/o/${organizer.slug}`} className="es-orgcard__profile">
            View profile <NavIcon name="arrow" size={14} />
          </Link>
        )}
      </div>

      {hasDetails && (
        <ul className="es-orgcard__details">
          {contact.email && (
            <li><NavIcon name="mail" size={16} /><a href={`mailto:${contact.email}`} className="fx-break">{contact.email}</a></li>
          )}
          {contact.phone && (
            <li><NavIcon name="chat" size={16} /><a href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}>{contact.phone}</a></li>
          )}
          {contact.website && (
            <li><NavIcon name="globe" size={16} /><a href={contact.website} target="_blank" rel="noopener noreferrer" className="fx-break">{contact.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></li>
          )}
          {social.length > 0 && (
            <li className="es-orgcard__social">
              <NavIcon name="share" size={16} />
              {social.map((s) => (
                <a key={s.key} href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
              ))}
            </li>
          )}
        </ul>
      )}

      {orderToken && (
        state.sent ? (
          <p className="es-notice es-notice--info" role="status">
            Sent. {name} will reply to you by email.
          </p>
        ) : open ? (
          <form className="es-orgcard__form fx-stack fx-stack--sm" onSubmit={send}>
            <label className="fx-stack fx-stack--sm gap-1.5">
              <span className="es-label">Your name <span className="text-subtle">(optional)</span></span>
              <input name="name" className="es-input" maxLength={120} autoComplete="name" />
            </label>
            <label className="fx-stack fx-stack--sm gap-1.5">
              <span className="es-label">Message</span>
              <textarea name="message" className="es-input" required minLength={2} maxLength={2000} rows={4}
                placeholder="Ask about access, parking, your seats…" />
            </label>
            {state.error && <p className="es-notice es-notice--danger" role="alert">{state.error}</p>}
            <div className="fx-row gap-2">
              <button type="submit" className="es-btn es-btn--primary" disabled={state.busy}>
                {state.busy ? 'Sending…' : 'Send message'}
              </button>
              <button type="button" className="es-btn es-btn--ghost" onClick={() => setOpen(false)} disabled={state.busy}>
                Cancel
              </button>
            </div>
            <p className="text-xs text-subtle">
              Sent through Eventsli. The organizer replies to the email on your order.
            </p>
          </form>
        ) : (
          <button type="button" className="es-btn es-btn--secondary es-btn--block" onClick={() => setOpen(true)}>
            <NavIcon name="chat" size={16} /> Message the organizer
          </button>
        )
      )}
    </section>
  );
}
