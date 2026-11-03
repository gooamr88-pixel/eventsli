import TicketStub from '../TicketStub';
import NavIcon from '../shell/NavIcon';
import { LogoMark } from '../brand/Logo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Sell and scan at the door", shown rather than told.
 *
 * TWO REAL THINGS, NOT A STOCK MOCKUP:
 *   · the buyer's ticket is the actual `TicketStub` the product renders on
 *     /t/[token] and in My tickets, with the same stub, perforation and facts;
 *   · its QR code is a real, scannable code (`brandQr.js`, `demoQr.js`) — point
 *     a phone at the homepage and it opens /how-it-works;
 *   · the phone is the door app (/gate) as it actually reads: the "Gate"
 *     badge, "Welcome in", "Admitted. This ticket is now used.", "Already used
 *     at 19:02", the offline queue — the same words as `gate/scanOutcome.js`,
 *     so the illustration never promises a screen the product does not have.
 *
 * Decorative to assistive technology (`aria-hidden`): every claim it makes is
 * also in the text beside it, which is what a screen reader gets.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DEMO_QR_SRC = '/eventsli-demo-qr.svg';

const DEMO_EVENT = {
  title: 'Spring Gala 2026',
  startsAt: '2026-05-16T23:00:00.000Z',
  timezone: 'America/Toronto',
  venue: 'Harbourfront Hall, Toronto',
};
const DEMO_TICKET = {
  status: 'valid',
  tierName: 'Premium',
  seat: { section: 'Orchestra', row: 'C', number: 12 },
  attendeeName: 'Maya Chen',
};

const FEATURES = [
  ['users', 'Any phone is a scanner', 'Add your door team by email, or register a tablet with a PIN. Nothing to install.'],
  ['shield', 'Keeps working offline', 'No signal at the venue? Scans are kept on the device and uploaded when it returns — no ticket gets in twice.'],
  ['check', 'One clear answer per scan', '“Welcome in”, “Already used at 19:02” or “Wrong event” — and a mistaken admit can be undone.'],
  ['chart', 'Arrivals, live', 'Watch check-ins and sales together on your dashboard while the doors are open.'],
];

/** The small version for step 3's card. */
export function ScanMini() {
  return (
    <div aria-hidden className="es-door-mini">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={DEMO_QR_SRC} alt="" width={56} height={56} className="es-door-mini__qr" />
      <div className="fx-min0">
        <p className="es-door-mini__title"><span className="es-door-mini__dot" /> Welcome in</p>
        <p className="es-door-mini__meta es-nums">Row C, Seat 12 · admitted 19:04</p>
      </div>
    </div>
  );
}

function GateScreen() {
  return (
    <div className="es-door__phone">
      <div className="es-door__screen">
        <div className="es-door__statusbar es-nums"><span>19:04</span><span className="es-door__notch" /><span>5G ▮▮▮</span></div>

        <div className="es-door__head">
          <span className="es-door__brand"><LogoMark /> Eventsli</span>
          <span className="es-door__badge">Gate</span>
          <span className="es-door__live"><i /> Live</span>
        </div>
        <p className="es-door__event">Spring Gala 2026 · Main entrance</p>

        <div className="es-door__count">
          <p className="es-nums"><b>248</b> / 300 checked in</p>
          <span className="es-door__bar"><span style={{ width: '83%' }} /></span>
        </div>

        <div className="es-door__lens">
          <span className="es-door__corner es-door__corner--tl" />
          <span className="es-door__corner es-door__corner--tr" />
          <span className="es-door__corner es-door__corner--bl" />
          <span className="es-door__corner es-door__corner--br" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={DEMO_QR_SRC} alt="" className="es-door__lens-qr" />
          <span className="es-door__beam" />
        </div>

        <div className="es-door__result">
          <div className="es-door__result-top">
            <span className="es-door__ok"><NavIcon name="check" size={18} /></span>
            <div className="fx-min0">
              <p className="es-door__result-title">Welcome in</p>
              <p className="es-door__result-note">Admitted. This ticket is now used.</p>
            </div>
            <span className="es-door__time es-nums">19:04</span>
          </div>
          <p className="es-door__result-seat">Orchestra · Row C · Seat 12</p>
          <p className="es-door__result-who">Premium · Maya Chen</p>
          <span className="es-door__undo">Let them back out — undo</span>
        </div>

        <ul className="es-door__log">
          <li><i className="is-warn" /><span>Already used</span><span className="es-nums">at 19:02</span></li>
          <li><i className="is-ok" /><span>Welcome in · Row C, Seat 11</span><span className="es-nums">19:01</span></li>
        </ul>

        <p className="es-door__foot"><NavIcon name="shield" size={13} /> Works offline · nothing waiting to upload</p>
      </div>
    </div>
  );
}

export default function DoorShowcase() {
  return (
    <div className="es-door">
      <div className="es-door__copy">
        <p className="es-lp-kicker">At the door</p>
        <h3 className="es-door__title">Check-in that keeps the line moving</h3>
        <p className="es-door__lede">
          Every ticket carries its own QR code. Your door team opens Eventsli Gate on any phone, points it at the code,
          and gets the answer in a second — seat, ticket type and name included.
        </p>
        <ul className="es-door__features">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}>
              <span className="es-door__fi" aria-hidden="true"><NavIcon name={icon} size={18} /></span>
              <span className="fx-min0">
                <span className="es-door__ft">{title}</span>
                <span className="es-door__fd">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="es-door__device" aria-hidden="true">
        <p className="es-door__label">What your door team sees</p>
        <GateScreen />
      </div>

      {/* Full width so the real ticket shows in its real, horizontal form —
          it switches layout at a 40rem container, and squeezed beside the
          phone it fell back to its narrow stacked one. */}
      <div className="es-door__ticket" aria-hidden="true">
        <p className="es-door__label">What your guest brings — on their phone or printed</p>
        <TicketStub ticket={DEMO_TICKET} event={DEMO_EVENT} qrSrc={DEMO_QR_SRC} />
      </div>
    </div>
  );
}
