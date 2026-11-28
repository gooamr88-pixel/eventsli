'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { useNowMinute } from '../../../hooks/useNowMinute';
import { post, patch } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import { PhoneInput } from '../../../components/forms/PhoneField';
import NavIcon from '../../../components/shell/NavIcon';
import VipThread from '../../../components/vip/VipThread';
import VipComposer, { usePolling } from '../../../components/vip/VipComposer';
import VipSteps from '../../../components/vip/VipSteps';
import WhatsAppButton from '../../../components/vip/WhatsAppButton';
import { STATUS, OPEN, displayPhone, windowLeft } from '../../../components/vip/vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One VIP request, the organizer's view (2026-11-28).
 *
 * Left: where it stands (the steps) and the whole conversation — WhatsApp,
 * dashboard and email in one thread, refreshed every 20 seconds. Right: the
 * WhatsApp card (continue the chat; where updates go; the opt-in), what they
 * asked for, and cancelling.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * Where this page talks to: an organizer's own request, or (with `token`) a
 * VISITOR's, through the signed link from their email (/vip/request/<id>,
 * 2026-11-28). The same page either way; only the paths differ.
 */
export function requestApi(id, token = null) {
  if (token) {
    const t = encodeURIComponent(token);
    return {
      get: `/public/vip/requests/${id}?t=${t}`, base: `/public/vip/requests/${id}`, extra: { t: token },
      mediaBase: `/public/vip/requests/${id}/media`, mediaQuery: `?t=${t}`, back: '/vip', visitor: true,
    };
  }
  return { get: `/organizer/vip/${id}`, base: `/organizer/vip/${id}`, extra: {}, mediaBase: '/organizer/vip/media', mediaQuery: '', back: '/organizer/vip', visitor: false };
}

export default function VipRequest({ id, token = null }) {
  const api = requestApi(id, token);
  const { data, error, loading, reload } = useApi(api.get);
  usePolling(reload);
  if (loading) return <Loading variant="card" label="Loading the request" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  return <Body data={data} reload={reload} api={api} />;
}

function Body({ data, reload, api }) {
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNowMinute();
  const r = data.request;
  const wa = data.whatsapp;
  const open = OPEN.includes(r.status);
  const live = windowLeft(wa.activeUntil, now);

  async function send(text) {
    try {
      await post(`${api.base}/messages`, { ...api.extra, text });
      reload();
      return true;
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      return false;
    }
  }

  async function cancel() {
    const ok = await confirm({
      title: `Cancel ${r.reference}?`,
      body: 'Our team stops work on it. You can always start a new request.',
      confirmLabel: 'Cancel the request',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await post(`${api.base}/cancel`, { ...api.extra });
      toast.success('Cancelled.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      <div className="es-vipreq__head">
        <Link href={api.back} className="es-vip__back"><NavIcon name="chevronLeft" size={16} /> VIP Services</Link>
        <div className="es-vipreq__title">
          <h1><span className="es-nums">{r.reference}</span></h1>
          <span className={`es-pill ${STATUS[r.status]?.pill || ''}`}>{STATUS[r.status]?.label}</span>
        </div>
        <p className="es-vipreq__sub">{r.serviceTitles.join(' · ')}{r.event?.title || r.eventName ? ` — ${r.event?.title || r.eventName}` : ''}</p>
      </div>

      <VipSteps status={r.status} />

      <div className="es-vipreq__cols">
        <section className="es-card es-vipreq__chat" aria-labelledby="vip-chat-title">
          <div className="es-vipreq__chathead">
            <h2 id="vip-chat-title">Conversation</h2>
            {live && <span className="es-vipreq__live"><span aria-hidden="true" /> Chatting on WhatsApp</span>}
          </div>
          <VipThread messages={data.messages} viewer="organizer" mediaBase={api.mediaBase} mediaQuery={api.mediaQuery}
            emptyText="Nothing yet. Write below, or continue on WhatsApp." />
          {r.status !== 'cancelled' && (
            <VipComposer
              onSend={send}
              placeholder="Write to the Eventsli team…"
              hint={api.visitor ? 'Our team gets this straight away. Bookmark this page to come back to your request.' : 'Our team sees this here and gets an email. For the fastest reply, use WhatsApp.'}
            />
          )}
        </section>

        <aside className="fx-stack es-vipreq__side">
          <WhatsAppCard r={r} wa={wa} live={live} reload={reload} api={api} />

          <section className="es-card es-vipreq__card" aria-labelledby="vip-what-title">
            <h2 id="vip-what-title">What you asked for</h2>
            <dl className="es-vipfacts">
              <div><dt>Services</dt><dd>{r.serviceTitles.join(', ')}</dd></div>
              {(r.event || r.eventName) && <div><dt>Event</dt><dd>{r.event?.title || r.eventName}</dd></div>}
              {r.eventDate && <div><dt>Date</dt><dd className="es-nums">{new Date(`${r.eventDate}T12:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}</dd></div>}
              {r.guestCount && <div><dt>Guests</dt><dd className="es-nums">{r.guestCount.toLocaleString('en-US')}</dd></div>}
              {r.budgetLabel && <div><dt>Budget</dt><dd>{r.budgetLabel}</dd></div>}
              <div><dt>Details</dt><dd className="fx-break whitespace-pre-line">{r.details}</dd></div>
            </dl>
            {open && (
              <button type="button" className="es-btn es-btn--ghost es-btn--sm es-vipreq__cancel" onClick={cancel}>
                Cancel this request
              </button>
            )}
            {r.status === 'cancelled' && r.cancelReason && <p className="text-sm text-subtle">Cancelled: “{r.cancelReason}”</p>}
          </section>

          <p className="es-vipreq__mail">
            <NavIcon name="mail" size={16} /> Prefer email? Write to <a href={`mailto:${data.teamEmail}?subject=${encodeURIComponent(r.reference)}`}>{data.teamEmail}</a> and quote {r.reference}.
          </p>
        </aside>
      </div>
    </div>
  );
}

function WhatsAppCard({ r, wa, live, reload, api }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(r.whatsappNumber || '');
  const [busy, setBusy] = useState(false);

  async function save(body, done) {
    setBusy(true);
    try {
      await patch(`${api.base}/contact`, { ...api.extra, ...body });
      toast.success(done);
      setEditing(false);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="es-card es-vipwa" aria-labelledby="vip-wa-title">
      <h2 id="vip-wa-title" className="es-vipwa__title">WhatsApp</h2>
      <p className="es-vipwa__lede">
        {live
          ? `You are chatting with us now: our replies arrive in WhatsApp for the next ${live}.`
          : `Chat with the team at ${displayPhone(wa.teamNumber)}. Your reference is typed in for you.`}
      </p>
      <WhatsAppButton href={wa.chatUrl} block>Continue on WhatsApp</WhatsAppButton>

      <div className="es-vipwa__prefs">
        <p className="es-vipwa__row">
          <span>Your number</span>
          <b className="es-nums">{r.whatsappNumber ? displayPhone(r.whatsappNumber) : 'Not given'}</b>
          <button type="button" className="es-linkbtn" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? 'Close' : 'Change'}</button>
        </p>
        {editing && (
          <div className="fx-stack fx-stack--sm">
            <PhoneInput id="vip-wa-number" value={phone} onChange={setPhone} />
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}
              onClick={() => save({ whatsappNumber: phone || null }, phone ? 'Number saved.' : 'Number removed.')}>Save number</button>
          </div>
        )}
        {r.whatsappNumber && (
          <label className="es-vipconsent es-vipconsent--small">
            <input type="checkbox" checked={r.whatsappOptIn} disabled={busy}
              onChange={(e) => save({ whatsappOptIn: e.target.checked, preferredChannel: e.target.checked ? 'whatsapp' : 'email' },
                e.target.checked ? 'Updates will come on WhatsApp.' : 'Updates will come by email.')} />
            <span>Send me updates about this request on WhatsApp. No marketing; reply STOP there to end them.</span>
          </label>
        )}
        <p className="es-vipwa__where">
          <NavIcon name="bell" size={14} /> Updates go by {r.whatsappNumber && r.whatsappOptIn && r.preferredChannel === 'whatsapp' ? 'WhatsApp' : 'email'}{live ? ', and on WhatsApp while you are chatting' : ''}.
        </p>
      </div>
    </section>
  );
}
