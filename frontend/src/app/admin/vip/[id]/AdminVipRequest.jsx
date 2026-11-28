'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { useNowMinute } from '../../../hooks/useNowMinute';
import { patch, post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../../components/ui/Toast';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import NavIcon from '../../../components/shell/NavIcon';
import VipThread from '../../../components/vip/VipThread';
import VipComposer, { usePolling } from '../../../components/vip/VipComposer';
import VipSteps from '../../../components/vip/VipSteps';
import WhatsAppButton from '../../../components/vip/WhatsAppButton';
import { STATUS, displayPhone, windowLeft, when } from '../../../components/vip/vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One VIP request, in the console (2026-11-28).
 *
 * The reply box says where a reply will go before it is written: a normal
 * WhatsApp message (they wrote in the last 24 hours), the approved update
 * template (window closed, they agreed to WhatsApp), or email — and why.
 * Status changes are recorded, emailed and, when that is how they are
 * reached, sent on WhatsApp. Team notes never leave the console.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminVipRequest({ id }) {
  const { data, error, loading, reload } = useApi(`/admin/vip/requests/${id}`);
  const hosts = useApi('/admin/vip/hosts');
  usePolling(reload);
  if (loading) return <Loading variant="card" label="Loading the request" />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  return <Body data={data} hosts={hosts.data?.hosts || []} reload={reload} />;
}

const VIA = {
  whatsapp_text: ['whatsapp', 'Goes on WhatsApp as a normal message'],
  whatsapp_template: ['whatsapp', 'Goes on WhatsApp as the approved update template (your words inside it)'],
  email: ['mail', 'Goes by email'],
};

function Body({ data, hosts, reload }) {
  const toast = useToast();
  const now = useNowMinute();
  const r = data.request;
  const d = data.delivery;
  const left = windowLeft(d.windowOpenUntil, now);

  async function reply(text) {
    try {
      const res = await post(`/admin/vip/requests/${r.id}/reply`, { text });
      const via = res.delivery.via;
      if (via === 'email' && d.via !== 'email') toast.error(res.delivery.reason, { title: 'Sent by email instead' });
      else toast.success(via === 'email' ? 'Emailed.' : 'Sent on WhatsApp.');
      reload();
      return true;
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      return false;
    }
  }

  const hint = `${VIA[d.via][1]}${d.via === 'whatsapp_text' && left ? ` — the window closes in ${left}` : ''}. ${d.via === 'email' ? d.reason : ''}`.trim();

  return (
    <div className="fx-stack">
      <div className="es-vipreq__head">
        <Link href="/admin/vip" className="es-vip__back"><NavIcon name="chevronLeft" size={16} /> VIP Services</Link>
        <div className="es-vipreq__title">
          <h1><span className="es-nums">{r.reference}</span> · {r.contactName}</h1>
          <span className={`es-pill ${STATUS[r.status]?.pill || ''}`}>{STATUS[r.status]?.label}</span>
        </div>
        <p className="es-vipreq__sub">{r.source === 'visitor' ? `Visitor${r.company ? ` · ${r.company}` : ''}` : (r.organizer?.name || 'Organizer')} · {r.serviceTitles.join(' · ')} · asked {when(r.createdAt, now)}</p>
      </div>

      <VipSteps status={r.status} />

      <div className="es-vipreq__cols">
        <section className="es-card es-vipreq__chat" aria-labelledby="vip-chat-title">
          <div className="es-vipreq__chathead">
            <h2 id="vip-chat-title">Conversation</h2>
            {left && <span className="es-vipreq__live"><span aria-hidden="true" /> On WhatsApp · {left} left</span>}
          </div>
          <VipThread messages={data.messages} viewer="team" mediaBase="/admin/vip/media" />
          <VipComposer onSend={reply} placeholder={`Reply to ${r.contactName.split(' ')[0]}…`} hint={hint} sendLabel={d.via === 'email' ? 'Send email' : 'Send on WhatsApp'} />
        </section>

        <aside className="fx-stack es-vipreq__side">
          <StatusCard key={r.status} r={r} reload={reload} />
          <TeamCard r={r} hosts={hosts} reload={reload} />

          <section className="es-card es-vipreq__card" aria-labelledby="vip-contact-title">
            <h2 id="vip-contact-title">Contact</h2>
            <dl className="es-vipfacts">
              <div><dt>Email</dt><dd><a href={`mailto:${r.contactEmail}?subject=${encodeURIComponent(r.reference)}`}>{r.contactEmail}</a></dd></div>
              <div>
                <dt>WhatsApp</dt>
                <dd>{r.whatsappNumber ? <span className="es-nums">{displayPhone(r.whatsappNumber)}</span> : 'Not given'}</dd>
              </div>
              <div><dt>WhatsApp updates</dt><dd>{r.whatsappOptIn ? 'Agreed' : 'Not agreed'} · prefers {r.preferredChannel === 'email' ? 'email' : 'WhatsApp'}</dd></div>
              {r.organizer && <div><dt>Organizer</dt><dd>{r.organizer.name} ({r.organizer.country})</dd></div>}
              {r.source === 'visitor' && <div><dt>From</dt><dd>The public VIP Services page, no account{r.company ? ` · ${r.company}` : ''}</dd></div>}
            </dl>
            {data.links.chat && <WhatsAppButton href={data.links.chat} size="sm" block>Open their chat in WhatsApp</WhatsAppButton>}
            {data.links.visitorPage && (
              <button type="button" className="es-btn es-btn--ghost es-btn--sm"
                onClick={() => navigator.clipboard?.writeText(data.links.visitorPage).then(() => toast.success('Their private request link is copied.'))}>
                <NavIcon name="link" size={16} /> Copy their request link
              </button>
            )}
          </section>

          <section className="es-card es-vipreq__card" aria-labelledby="vip-what-title">
            <h2 id="vip-what-title">What they asked for</h2>
            <dl className="es-vipfacts">
              <div><dt>Services</dt><dd>{r.serviceTitles.join(', ')}</dd></div>
              {r.event && <div><dt>Event</dt><dd><Link href={`/admin/events/${r.event.id}`}>{r.event.title}</Link> <span className="text-subtle">({r.event.status})</span></dd></div>}
              {!r.event && r.eventName && <div><dt>Event</dt><dd>{r.eventName} <span className="text-subtle">(not on Eventsli)</span></dd></div>}
              {r.eventDate && <div><dt>Date</dt><dd className="es-nums">{r.eventDate}</dd></div>}
              {r.guestCount && <div><dt>Guests</dt><dd className="es-nums">{r.guestCount.toLocaleString('en-US')}</dd></div>}
              {r.budgetLabel && <div><dt>Budget</dt><dd>{r.budgetLabel}</dd></div>}
              <div><dt>Details</dt><dd className="fx-break whitespace-pre-line">{r.details}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function StatusCard({ r, reload }) {
  const toast = useToast();
  const [status, setStatus] = useState(r.status);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await patch(`/admin/vip/requests/${r.id}`, { status, note: note.trim() || null, notify });
      const via = res.delivery?.via;
      toast.success(!notify ? 'Status changed.' : via && via !== 'email' ? 'Status changed. They were emailed and told on WhatsApp.' : 'Status changed. They were emailed.');
      setNote('');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="es-card es-vipreq__card" aria-labelledby="vip-status-title">
      <h2 id="vip-status-title">Status</h2>
      <label className="es-label" htmlFor="vip-status">Move it to</label>
      <select id="vip-status" className="es-input" value={status} onChange={(e) => setStatus(e.target.value)}>
        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      {status !== r.status && (
        <>
          <label className="es-label" htmlFor="vip-status-note">A line for them <span className="es-optional">Optional</span></label>
          <textarea id="vip-status-note" className="es-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={status === 'quoted' ? 'Proposal: $6,500 for the seat map and the door team.' : ''} />
          <label className="es-demo-admin__check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell them (email, and WhatsApp when that is how they are reached)</label>
        </>
      )}
      <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={save} disabled={busy || status === r.status}>{busy ? 'Saving…' : 'Change status'}</button>
    </section>
  );
}

function TeamCard({ r, hosts, reload }) {
  const toast = useToast();
  const [who, setWho] = useState(r.assignedTo || '');
  const [notes, setNotes] = useState(r.teamNotes || '');
  const [busy, setBusy] = useState(false);
  const dirty = who !== (r.assignedTo || '') || notes !== (r.teamNotes || '');

  async function save() {
    setBusy(true);
    try {
      await patch(`/admin/vip/requests/${r.id}`, { assignedTo: who || null, teamNotes: notes });
      toast.success('Saved.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="es-card es-vipreq__card" aria-labelledby="vip-team-title">
      <h2 id="vip-team-title">Team</h2>
      <label className="es-label" htmlFor="vip-who">Who looks after it</label>
      <select id="vip-who" className="es-input" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Nobody yet</option>
        {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <label className="es-label" htmlFor="vip-notes">Team notes <span className="es-optional">Never shown to them</span></label>
      <textarea id="vip-notes" className="es-input" rows={4} maxLength={8000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
    </section>
  );
}
