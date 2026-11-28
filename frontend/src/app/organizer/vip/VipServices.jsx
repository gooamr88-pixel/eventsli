'use client';

import Link from 'next/link';
import { useApi } from '../../hooks/useApi';
import { useNowMinute } from '../../hooks/useNowMinute';
import { Loading, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import WhatsAppButton from '../../components/vip/WhatsAppButton';
import { STATUS, displayPhone, when } from '../../components/vip/vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services, the organizer's front door (owner, 2026-11-28).
 *
 * The Eventsli team runs part of the event for them. This page sells it in
 * one look (what we do, how it works), puts the team's WhatsApp and email in
 * reach, and lists their requests with a dot where the team has written.
 * "Start a request" is the main road; "Message us on WhatsApp" is for the
 * organizer who would rather just talk.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const HOW = [
  ['pencil', 'Tell us what you need', 'Pick the services, the event and a few details. Two minutes.'],
  ['chat', 'Talk it through on WhatsApp', 'Your request opens a chat with our team, with its reference already in it.'],
  ['check', 'We take it from there', 'Proposal, confirmation and every update here and on WhatsApp.'],
];

export default function VipServices() {
  const opts = useApi('/organizer/vip/options');
  const list = useApi('/organizer/vip');
  const now = useNowMinute();

  if (opts.loading) return <Loading variant="list" rows={4} label="Loading VIP Services" />;
  if (opts.error) return <ErrorNotice error={opts.error} onRetry={opts.reload} />;
  const s = opts.data.settings;
  const requests = list.data?.requests || [];

  return (
    <div className="fx-stack fx-stack--lg">
      <section className="es-viphero" aria-labelledby="vip-title">
        <div className="es-viphero__main">
          <p className="es-viphero__eyebrow"><NavIcon name="crown" size={16} /> VIP Services</p>
          <h1 id="vip-title" className="es-viphero__title">The Eventsli team, <span>on your event.</span></h1>
          <p className="es-viphero__lede">
            Hand us the parts you would rather not do yourself. We plan it with you on WhatsApp and deliver it on Eventsli.
          </p>
          <div className="es-viphero__ctas">
            {s.enabled ? (
              <Link href="/organizer/vip/new" className="es-btn es-btn--primary es-btn--lg">
                Start a request <NavIcon name="arrow" size={18} />
              </Link>
            ) : (
              <p className="es-viphero__paused">New requests are paused just now. Message us and we will help.</p>
            )}
            <WhatsAppButton href={opts.data.chatUrl} size="lg">Message us on WhatsApp</WhatsAppButton>
          </div>
        </div>
        <dl className="es-viphero__contact">
          <div>
            <dt>WhatsApp</dt>
            <dd><a href={opts.data.chatUrl} target="_blank" rel="noopener noreferrer" className="es-nums">{displayPhone(s.whatsappNumber)}</a></dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd><a href={`mailto:${s.email}?subject=${encodeURIComponent('VIP Services')}`}>{s.email}</a></dd>
          </div>
          {s.responseTime && <p className="es-viphero__promise"><NavIcon name="clock" size={16} /> {s.responseTime}</p>}
        </dl>
      </section>

      {requests.length > 0 && (
        <section className="fx-stack" aria-labelledby="vip-yours">
          <h2 id="vip-yours" className="es-vip__h2">Your requests</h2>
          <ul className="es-viplist">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/organizer/vip/${r.id}`} className="es-viplist__row">
                  <span className="es-viplist__ref es-nums">
                    {r.unread && <span className="es-viplist__dot" aria-label="New message" />}
                    {r.reference}
                  </span>
                  <span className="es-viplist__what fx-min0">
                    <b className="fx-truncate">{r.serviceTitles.join(', ')}</b>
                    <span className="fx-truncate">{r.event?.title || r.eventName || 'No event chosen'} · Updated {when(r.updatedAt, now)}</span>
                  </span>
                  <span className={`es-pill ${STATUS[r.status]?.pill || ''}`}>{STATUS[r.status]?.label || r.status}</span>
                  <NavIcon name="chevronRight" size={18} className="es-viplist__go" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="fx-stack" aria-labelledby="vip-what">
        <h2 id="vip-what" className="es-vip__h2">What we can do for you</h2>
        <ul className="es-vipservices">
          {s.services.map((x) => (
            <li key={x.key} className="es-vipservice">
              <span className="es-vipservice__icon" aria-hidden="true"><NavIcon name={x.icon} size={22} /></span>
              <b>{x.title}</b>
              <span>{x.blurb}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fx-stack" aria-labelledby="vip-how">
        <h2 id="vip-how" className="es-vip__h2">How it works</h2>
        <ol className="es-viphow">
          {HOW.map(([icon, title, text], i) => (
            <li key={title}>
              <span className="es-viphow__n es-nums" aria-hidden="true">{i + 1}</span>
              <span className="fx-min0">
                <b><NavIcon name={icon} size={16} /> {title}</b>
                <span>{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
