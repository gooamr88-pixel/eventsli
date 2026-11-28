'use client';

import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { useNowMinute } from '../../../hooks/useNowMinute';
import { get, post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../ui/Toast';
import { useConfirm } from '../../ui/Confirm';
import { Loading, Empty, ErrorNotice } from '../../Feedback';
import NavIcon from '../../shell/NavIcon';
import VipThread from '../VipThread';
import VipComposer, { usePolling } from '../VipComposer';
import WhatsAppButton from '../WhatsAppButton';
import { displayPhone, when, windowLeft } from '../vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The WhatsApp inbox (2026-11-28): chats with nobody's request behind them —
 * a number we do not know, or one whose request is long closed.
 *
 * For each: the messages; a reply box while WhatsApp allows one (24 hours
 * after they last wrote); "Link to a request" by its reference (optionally
 * making this the request's WhatsApp number); and Dismiss for spam.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VipInbox() {
  const { data, error, loading, reload } = useApi('/admin/vip/whatsapp/unmatched');
  usePolling(reload, 30_000);
  const [open, setOpen] = useState(null);
  const now = useNowMinute();

  if (loading) return <Loading variant="list" rows={3} label="Loading the inbox" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data.contacts.length) {
    return (
      <Empty icon="chat" title="Nothing waiting"
        hint="WhatsApp messages that quote a request's reference, or come from a request's number, go straight to that request. Anything else lands here." />
    );
  }

  return (
    <ul className="es-vipinbox">
      {data.contacts.map((g) => (
        <li key={g.contact} className="es-card es-vipinbox__item">
          <button type="button" className="es-vipinbox__row" aria-expanded={open === g.contact} onClick={() => setOpen(open === g.contact ? null : g.contact)}>
            <span className="es-vipinbox__avatar" aria-hidden="true">{(g.name || '?').slice(0, 1).toUpperCase()}</span>
            <span className="fx-min0 es-vipinbox__who">
              <b className="fx-truncate">{g.name || 'Unknown'}</b>
              <span className="es-nums">{displayPhone(g.contact)}</span>
            </span>
            <span className="es-vipinbox__meta">
              <span>{g.count} message{g.count === 1 ? '' : 's'} · {when(g.lastAt, now)}</span>
              {g.windowOpenUntil && <span className="es-vipinbox__open">Reply open {windowLeft(g.windowOpenUntil, now) || ''}</span>}
            </span>
            <NavIcon name={open === g.contact ? 'chevronUp' : 'chevronDown'} size={18} />
          </button>
          {open === g.contact && <Contact g={g} sending={data.sending} reload={reload} />}
        </li>
      ))}
    </ul>
  );
}

function Contact({ g, sending, reload }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [ref, setRef] = useState('');
  const [found, setFound] = useState(null);
  const [adopt, setAdopt] = useState(true);
  const [busy, setBusy] = useState(false);

  const fail = (err) => toast.error(messageFor(err), { title: describeError(err).title });

  async function reply(text) {
    try {
      await post('/admin/vip/whatsapp/reply', { contact: g.contact, text });
      reload();
      return true;
    } catch (err) { fail(err); return false; }
  }

  async function find(e) {
    e.preventDefault();
    const q = ref.trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await get(`/admin/vip/requests?view=all&q=${encodeURIComponent(q)}`);
      setFound(res.requests.slice(0, 5));
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function link(requestId) {
    setBusy(true);
    try {
      const res = await post('/admin/vip/whatsapp/link', { contact: g.contact, requestId, adopt });
      toast.success(`${res.moved} message${res.moved === 1 ? '' : 's'} moved to the request.`);
      reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function dismiss() {
    const ok = await confirm({
      title: `Dismiss ${displayPhone(g.contact)}?`,
      body: 'Their messages here are deleted. Nothing is sent to them, and the chat stays in WhatsApp.',
      confirmLabel: 'Dismiss', tone: 'danger',
    });
    if (!ok) return;
    try {
      await post('/admin/vip/whatsapp/dismiss', { contact: g.contact });
      toast.success('Dismissed.');
      reload();
    } catch (err) { fail(err); }
  }

  return (
    <div className="es-vipinbox__body">
      <VipThread messages={g.messages} viewer="team" mediaBase="/admin/vip/media" />
      {sending && g.windowOpenUntil ? (
        <VipComposer onSend={reply} placeholder={`Reply to ${g.name || 'them'} on WhatsApp…`} hint="Goes to them on WhatsApp now. Links to no request." />
      ) : (
        <p className="es-vipinbox__note">
          {sending
            ? 'More than 24 hours since they wrote, so WhatsApp allows no free reply. Link the chat to a request to send the update template, or answer from the WhatsApp app.'
            : 'WhatsApp is not connected for sending yet. Answer from the WhatsApp app on the business phone.'}
        </p>
      )}
      <div className="es-vipinbox__actions">
        <form className="es-vipinbox__link" onSubmit={find}>
          <label htmlFor={`link-${g.contact}`} className="es-label">Link to a request</label>
          <div className="es-vipinbox__find">
            <input id={`link-${g.contact}`} className="es-input" placeholder="VIP-7KQ2MX, a name or an email" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
            <button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Find</button>
          </div>
          {found && (found.length === 0 ? <p className="text-sm text-subtle">No request matches.</p> : (
            <ul className="es-vipinbox__found">
              {found.map((r) => (
                <li key={r.id}>
                  <span className="fx-min0"><b className="es-nums">{r.reference}</b> {r.contactName} · {r.serviceTitles.join(', ')}</span>
                  <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busy} onClick={() => link(r.id)}>Link</button>
                </li>
              ))}
            </ul>
          ))}
          <label className="es-demo-admin__check">
            <input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} /> Make {displayPhone(g.contact)} the request&rsquo;s WhatsApp number
          </label>
        </form>
        <div className="es-vipinbox__side">
          <WhatsAppButton href={g.chat} size="sm">Open in WhatsApp</WhatsAppButton>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={dismiss}><NavIcon name="trash" size={16} /> Dismiss</button>
        </div>
      </div>
    </div>
  );
}
