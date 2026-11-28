import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import WhatsAppButton from './WhatsAppButton';
import { displayPhone } from './vipStatus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services, the front door (2026-11-28) — one design for both pages:
 * the organizer's dashboard (/organizer/vip) and the public page every
 * visitor can open (/vip).
 *
 * The hero in the brand (headline, the two ways in, the team's WhatsApp and
 * email), then `children` (an organizer's own requests, the visitor's form
 * link…), then what we do and how it works. `cta` is where "Start a request"
 * goes: the dashboard form, or the form further down the public page.
 *
 * No hooks, no clock: it renders on the server or in the browser alike.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const HOW = [
  ['pencil', 'Tell us what you need', 'Pick the services, your event and a few details. Two minutes.'],
  ['chat', 'Talk it through on WhatsApp', 'Your request opens a chat with our team, with its reference already in it.'],
  ['check', 'We take it from there', 'Proposal, confirmation and every update, on WhatsApp and by email.'],
];

export default function VipLanding({ settings: s, chatUrl, cta = { href: '/organizer/vip/new', label: 'Start a request' }, children }) {
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
              <Link href={cta.href} className="es-btn es-btn--primary es-btn--lg">
                {cta.label} <NavIcon name="arrow" size={18} />
              </Link>
            ) : (
              <p className="es-viphero__paused">New requests are paused just now. Message us and we will help.</p>
            )}
            <WhatsAppButton href={chatUrl} size="lg">Message us on WhatsApp</WhatsAppButton>
          </div>
        </div>
        <dl className="es-viphero__contact">
          <div>
            <dt>WhatsApp</dt>
            <dd><a href={chatUrl} target="_blank" rel="noopener noreferrer" className="es-nums">{displayPhone(s.whatsappNumber)}</a></dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd><a href={`mailto:${s.email}?subject=${encodeURIComponent('VIP Services')}`}>{s.email}</a></dd>
          </div>
          {s.responseTime && <p className="es-viphero__promise"><NavIcon name="clock" size={16} /> {s.responseTime}</p>}
        </dl>
      </section>

      {children}

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
