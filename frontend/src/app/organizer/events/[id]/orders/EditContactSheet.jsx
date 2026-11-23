'use client';

import { useEffect, useId, useRef, useState } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import Field from '../../../../components/forms/Field';
import PhoneField from '../../../../components/forms/PhoneField';
import FormError from '../../../../components/forms/FormError';
import { patch } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { channelText, orderRef, orderWhen } from './ordersExport';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CORRECTING A BUYER'S CONTACT ON ONE ORDER (2026-11-23).
 *
 * The case it exists for: a typo in an email, and a buyer at the door who never
 * got their tickets. So the email is the field it is built around — the old
 * address stays visible under the new one, and changing it offers to send the
 * tickets there (ticked by default: almost always why the address was fixed).
 *
 * This order only. A buyer with an Eventsli account keeps their account
 * exactly as it is (backend services/orderContactService.js); the panel says
 * so, because an organizer will reasonably wonder.
 *
 * The site's sheet: a drawer on the right on a desktop, a bottom sheet on a
 * phone (`.es-ai-sheet`, from the AI editor). A native <dialog> for focus,
 * Escape and the inert page behind — and focus is handed back to the row's
 * Edit button by hand, since the dialog is unmounted rather than closed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EditContactSheet({ eventId, order, event, onClose, onSaved }) {
  const ref = useRef(null);
  const titleId = useId();
  const original = {
    name: order.buyer?.name || '',
    email: order.buyer?.email || '',
    phone: order.buyer?.phone || '',
  };
  const [form, setForm] = useState(original);
  const [resend, setResend] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, []);

  const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ');
  const emailChanged = norm(form.email).toLowerCase() !== norm(original.email).toLowerCase();
  const dirty = norm(form.name) !== norm(original.name) || emailChanged || norm(form.phone) !== norm(original.phone);
  const paid = order.status === 'paid';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));

  async function save(e) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await patch(`/events/${eventId}/orders/${order.id}/contact`, {
        name: norm(form.name),
        email: norm(form.email) || null,
        phone: norm(form.phone) || null,
        resend: emailChanged && paid && resend,
      });
      onSaved(result);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="es-ai-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}
      onClick={(e) => { if (e.target === ref.current && !saving) onClose(); }}
    >
      <form className="es-ai-sheet__panel" onSubmit={save} noValidate>
        <span className="es-ai-sheet__grab" aria-hidden="true" />
        <div className="es-ai-sheet__head">
          <div className="fx-min0">
            <h2 id={titleId} className="text-lg">Edit buyer details</h2>
            <p className="text-sm text-muted">Order {orderRef(order)} · {channelText(order)}</p>
          </div>
          <button type="button" className="es-ai-iconbtn" onClick={onClose} aria-label="Close" disabled={saving}>
            <NavIcon name="close" size={20} />
          </button>
        </div>

        <div className="es-ai-sheet__body">
          <dl className="es-deflist">
            <div className="es-deflist__row"><dt className="text-muted">Tickets</dt><dd className="es-nums">{order.tickets}</dd></div>
            <div className="es-deflist__row"><dt className="text-muted">Paid</dt><dd className="es-nums">{formatMoney(order.buyerPaidCents, order.currency)}</dd></div>
            <div className="es-deflist__row"><dt className="text-muted">When</dt><dd>{orderWhen(order, event?.timezone)}</dd></div>
          </dl>

          {order.buyer?.hasAccount && (
            <div className="es-notice es-notice--info es-notice--icon">
              <span className="es-notice__icon" aria-hidden="true"><NavIcon name="info" size={18} /></span>
              <p className="text-sm text-muted">
                This buyer has an Eventsli account. Your changes apply to this order only — their account stays as it is.
              </p>
            </div>
          )}

          <Field
            label="Name" name="name" required autoComplete="off" maxLength={120}
            value={form.name} onChange={set('name')} dir="auto"
          />
          <Field
            label="Email" name="email" type="email" autoComplete="off" maxLength={254}
            required={Boolean(original.email)} optional={!original.email}
            value={form.email} onChange={set('email')}
            hint={emailChanged && original.email ? `Was ${original.email}` : 'Where this order’s tickets are sent.'}
          />
          <PhoneField
            label="Phone" name="phone" optional
            defaultCountry={event?.country || null}
            value={form.phone} onChange={set('phone')}
          />

          {emailChanged && norm(form.email) && (paid ? (
            <label className="es-check">
              <input type="checkbox" className="es-check__box" checked={resend} onChange={(e) => setResend(e.target.checked)} />
              <span className="text-sm">
                <span className="block text-ink">Send the tickets to the new email</span>
                <span className="block text-subtle">The buyer’s copy, with every ticket in the order. Tickets named for other guests are not re-sent.</span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-subtle">This order is not paid, so there are no tickets to send yet.</p>
          ))}

          <FormError error={error} />
        </div>

        <div className="es-ai-sheet__foot fx-row gap-2">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary flex-1" disabled={!dirty || saving || !norm(form.name)}>
            {saving ? 'Saving…' : emailChanged && paid && resend && norm(form.email) ? 'Save and send tickets' : 'Save changes'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
