'use client';

import { useState } from 'react';
import { put } from '../../utils/apiClient';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import FormError from '../../components/forms/FormError';
import NavIcon from '../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SALE EMAILS (2026-11-23, the owner: "the organizer must get an email when
 * tickets are bought — professionally").
 *
 * Every order (the default) — who bought, which tickets and seats, what was
 * paid and kept, whose guest, the running totals, and Reply goes to the buyer;
 * a daily summary at 8 am; or nothing. To the owner's own address unless they
 * untick it, and up to five more (a partner, a box office, a shared inbox).
 * backend services/saleNoticeService.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MODES = [
  { key: 'each', title: 'Every sale', text: 'An email the moment each order is confirmed, with the buyer, tickets and money.' },
  { key: 'daily', title: 'Daily summary', text: 'One email each morning at 8 am with what sold, event by event.' },
  { key: 'off', title: 'Off', text: 'No sale emails. Your orders are always in the dashboard.' },
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SaleEmails() {
  const api = useApi('/organizer/sale-emails');
  if (api.error) return <ErrorNotice error={api.error} onRetry={api.reload} />;
  if (!api.data) return <Loading variant="card" label="Loading sale emails" />;
  return <Form saved={api.data} onSaved={api.reload} />;
}

function Form({ saved, onSaved }) {
  const toast = useToast();
  const [mode, setMode] = useState(saved.mode);
  const [toOwner, setToOwner] = useState(saved.toOwner);
  const [recipients, setRecipients] = useState(saved.recipients);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-seeded during render when the saved values change (after a save).
  const signature = JSON.stringify(saved);
  const [seen, setSeen] = useState(signature);
  if (signature !== seen) {
    setSeen(signature);
    setMode(saved.mode);
    setToOwner(saved.toOwner);
    setRecipients(saved.recipients);
  }

  const dirty = mode !== saved.mode || toOwner !== saved.toOwner || recipients.join(',') !== saved.recipients.join(',');
  const nobody = mode !== 'off' && !toOwner && recipients.length === 0;

  function addRecipient() {
    const e = draft.trim().toLowerCase();
    if (!e) return;
    if (!EMAIL.test(e)) { setDraftError('That is not an email address.'); return; }
    if (recipients.includes(e) || e === saved.ownerEmail?.toLowerCase()) { setDraftError('That address is already on the list.'); return; }
    if (recipients.length >= saved.maxRecipients) { setDraftError(`Up to ${saved.maxRecipients} extra addresses.`); return; }
    setRecipients((r) => [...r, e]);
    setDraft('');
    setDraftError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await put('/organizer/sale-emails', { mode, toOwner, recipients }, { noRedirect: true });
      toast.success(mode === 'off' ? 'Saved. Sale emails are off.' : mode === 'daily' ? 'Saved. You will get a summary each morning.' : 'Saved. You will get an email for every sale.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="sale-emails" className="es-dcard" aria-labelledby="org-sale-emails">
      <div className="es-tilehead">
        <span className="es-paytile" aria-hidden="true"><NavIcon name="mail" size={24} /></span>
        <div className="fx-min0">
          <h2 id="org-sale-emails" className="es-paycard__title">Sale emails</h2>
          <p className="text-sm text-muted">Hear about every ticket sold, without opening the dashboard.</p>
        </div>
      </div>

      <div className="fx-stack fx-stack--sm">
        <div className="es-salemail__modes" role="radiogroup" aria-label="When to email you">
          {MODES.map((m) => (
            <label key={m.key} className="es-salemail__mode" data-on={mode === m.key ? 'true' : undefined}>
              <input type="radio" name="sale-email-mode" value={m.key} checked={mode === m.key} onChange={() => setMode(m.key)} />
              <span className="fx-min0"><b>{m.title}</b><small>{m.text}</small></span>
            </label>
          ))}
        </div>

        {mode !== 'off' && (
          <fieldset className="es-salemail__who">
            <legend className="es-label">Send them to</legend>
            {saved.ownerEmail && (
              <label className="es-salemail__check">
                <input type="checkbox" checked={toOwner} onChange={(e) => setToOwner(e.target.checked)} />
                <span>{saved.ownerEmail} <small className="text-muted">(you)</small></span>
              </label>
            )}
            {recipients.length > 0 && (
              <ul className="es-salemail__list" aria-label="Extra addresses">
                {recipients.map((r) => (
                  <li key={r}>
                    <span className="fx-break">{r}</span>
                    <button type="button" className="es-linkbtn text-xs" aria-label={`Remove ${r}`}
                      onClick={() => setRecipients((list) => list.filter((x) => x !== r))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {recipients.length < saved.maxRecipients && (
              <div className="es-salemail__add">
                <label htmlFor="sale-email-add" className="sr-only">Add an email address</label>
                <input
                  id="sale-email-add" type="email" className="es-input" placeholder="Add an address — a partner, the box office"
                  value={draft} maxLength={254} aria-invalid={draftError ? 'true' : undefined}
                  aria-describedby={draftError ? 'sale-email-add-error' : undefined}
                  onChange={(e) => { setDraft(e.target.value); setDraftError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                />
                <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={addRecipient}>
                  <NavIcon name="plus" size={16} /> Add
                </button>
              </div>
            )}
            {draftError && <p id="sale-email-add-error" className="text-sm text-danger">{draftError}</p>}
            <p className="text-xs text-subtle">Each address gets its own copy; nobody sees the others. Door sales are not emailed.</p>
          </fieldset>
        )}

        {nobody && <p className="text-sm text-warning">Nobody would receive them — tick your address or add one.</p>}
        <FormError error={error} />
        <div className="fx-row">
          <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={!dirty || busy || nobody} onClick={save}>
            <NavIcon name="tick" size={16} /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  );
}
