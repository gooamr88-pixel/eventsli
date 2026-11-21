'use client';

import { useState } from 'react';
import { get, post } from '../../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../../utils/errors';
import { formatMoney } from '../../../../../utils/money';
import { useToast } from '../../../../../components/ui/Toast';
import { Panel } from '../../../../../components/ui/Page';
import NavIcon from '../../../../../components/shell/NavIcon';
import SocialIcon, { SOCIAL_FIELDS } from '../../../../../components/vendors/booking/SocialIcon';

/**
 * What the booking flow adds to an application (2026-11-21): the add-ons the
 * vendor chose, the documents they uploaded — each opened through a
 * five-minute private link and approved or rejected here — and their
 * business address and social links.
 */
export function AddonsAndDocuments({ eventId, app, onChange }) {
  return (
    <>
      {app.addons.length > 0 && (
        <Panel icon="plus" title="Add-ons asked for" description="Copied at the price shown when they booked. You deliver these.">
          <ul className="es-vb-orgaddons">
            {app.addons.map((x) => (
              <li key={x.id}>
                <span>{x.name}<span className="text-xs text-subtle"> · {x.kind === 'marketing' ? 'Marketing' : 'Booth'}</span></span>
                <b className="es-nums">{x.priceCents === 0 ? 'Free' : formatMoney(x.priceCents, app.currency)}</b>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {app.documents.length > 0 && (
        <Panel icon="fileText" title="Documents" description="Private to you and the vendor. Rejecting one asks the vendor to upload it again.">
          <ul className="es-vb-orgdocs">
            {app.documents.map((d) => <DocumentRow key={d.id} eventId={eventId} appId={app.id} doc={d} onChange={onChange} />)}
          </ul>
        </Panel>
      )}
    </>
  );
}

const STATUS = { pending: ['To review', 'es-pill--warning'], approved: ['Approved', 'es-pill--accent'], rejected: ['Rejected', 'es-pill--danger'] };

function DocumentRow({ eventId, appId, doc, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const path = `/events/${eventId}/vendors/applications/${appId}/documents/${doc.id}`;
  const [label, pill] = STATUS[doc.status] || STATUS.pending;

  async function open() {
    setBusy('open');
    try {
      const { url } = await get(path, { cache: 'no-store', noRedirect: true });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }
  async function review(status) {
    setBusy(status);
    try {
      await post(`${path}/review`, { status, note: status === 'rejected' ? note.trim() || null : null }, { noRedirect: true });
      toast.success(status === 'approved' ? `“${doc.label}” approved.` : `“${doc.label}” rejected. The vendor is asked for a new one.`);
      setRejecting(false);
      onChange();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="es-vb-orgdoc">
      <div className="es-vb-orgdoc__head">
        <NavIcon name="fileText" size={20} />
        <span className="fx-min0">
          <b className="fx-break">{doc.label}</b>
          <span className="block text-xs text-subtle fx-break">{doc.fileName}{doc.size ? ` · ${Math.max(1, Math.round(doc.size / 1024))} KB` : ''}</span>
        </span>
        <span className={`es-pill ${pill}`}>{label}</span>
      </div>
      {doc.status === 'rejected' && doc.note && <p className="text-sm text-muted">Your note: {doc.note}</p>}
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={open} disabled={!!busy || !doc.uploaded}>
          <NavIcon name="eye" size={16} />{busy === 'open' ? 'Opening…' : 'Open'}
        </button>
        {doc.status !== 'approved' && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => review('approved')} disabled={!!busy}><NavIcon name="tick" size={16} />Approve</button>}
        {doc.status !== 'rejected' && !rejecting && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => setRejecting(true)} disabled={!!busy}>Reject</button>}
      </div>
      {rejecting && (
        <div className="fx-row gap-2">
          <input className="es-input es-input--sm fx-min0" style={{ flex: 1 }} maxLength={300} placeholder="What is wrong? (the vendor sees this)" aria-label={`Why ${doc.label} is rejected`}
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="es-btn es-btn--danger es-btn--sm" onClick={() => review('rejected')} disabled={!!busy}>Reject</button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setRejecting(false)}>Cancel</button>
        </div>
      )}
    </li>
  );
}

/** Address and social links, under Contact. */
export function BusinessFacts({ app }) {
  const where = [app.address, app.city, app.postalCode].filter(Boolean).join(', ');
  const socials = SOCIAL_FIELDS.filter((s) => app.socials?.[s.key]);
  if (!where && !socials.length && !app.category) return null;
  return (
    <Panel icon="store" title="Business">
      <dl className="es-sp-contact">
        {app.category && <div><dt>Category</dt><dd>{app.category}</dd></div>}
        {where && <div><dt>Address</dt><dd className="fx-break">{where}</dd></div>}
      </dl>
      {socials.length > 0 && (
        <ul className="es-vb-orgsocials">
          {socials.map((s) => {
            const v = app.socials[s.key];
            const href = /^https?:\/\//i.test(v) ? v : null;
            return (
              <li key={s.key}>
                <span className="es-vb-social__icon es-vb-social__icon--inline" aria-hidden="true"><SocialIcon name={s.key} size={16} /></span>
                <span className="sr-only">{s.label}: </span>
                {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="fx-break">{v.replace(/^https?:\/\//, '')}</a> : <span className="fx-break">{s.key === 'x' || s.key === 'instagram' ? `@${v}` : v}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
