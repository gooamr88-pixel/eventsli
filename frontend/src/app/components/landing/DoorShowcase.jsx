import Image from 'next/image';
import TicketStub from '../TicketStub';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Check-in at the door", shown rather than told.
 *
 * REAL SCREENS, NOT A DRAWN MOCKUP (owner, 2026-11-23). The phones are the
 * Eventsli Check-in app's own App Store screenshots — the event's live
 * check-in screen, a successful scan, and arrivals analytics — resized into
 * `public/app/` (600px wide, webp). They replaced a hand-drawn gate screen
 * that described the product but was not it.
 *
 * The guest's ticket below them is still the real `TicketStub` the product
 * renders on /t/[token], and its QR code is a real, scannable code
 * (`brandQr.js`, `demoQr.js`) that opens /how-it-works.
 *
 * The App Store link is the check-in app's listing (`ascAppId` in
 * mobile/eas.json). Decorative images are `aria-hidden`: every claim they
 * make is also in the text beside them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DEMO_QR_SRC = '/eventsli-demo-qr.svg';
export const APP_STORE_URL = 'https://apps.apple.com/app/eventsli-check-in/id6835016139';

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
  ['scan', 'Scan in a second', 'Point the camera at the ticket and get one clear answer — name, ticket type and seat included.'],
  ['shield', 'Keeps working offline', 'No signal at the venue? Scans are kept on the device and uploaded when it returns — no ticket gets in twice.'],
  ['users', 'Your whole door team', 'Add staff by email, or set up a shared door device with a PIN. Every scan says who let them in, and through which door.'],
  ['chart', 'Arrivals, live', 'Checked in, still to come, arrivals every 15 minutes and by ticket type — while the doors are open.'],
];

const SHOTS = [
  { src: '/app/checkin-result.webp', label: 'Check-in successful', place: 'side' },
  { src: '/app/checkin-dashboard.webp', label: 'Live check-in for an event', place: 'main' },
  { src: '/app/checkin-analytics.webp', label: 'Arrivals analytics', place: 'side' },
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

/** "Download on the App Store", with the app's own icon. */
export function AppStoreButton() {
  return (
    <a href={APP_STORE_URL} target="_blank" rel="noreferrer" className="es-appstore">
      <Image src="/app/checkin-icon.webp" alt="" width={40} height={40} className="es-appstore__icon" />
      <span className="es-appstore__text">
        <span className="es-appstore__small">Download on the</span>
        <span className="es-appstore__big">App Store</span>
      </span>
      <span className="sr-only"> — Eventsli Check-in, opens in a new tab</span>
    </a>
  );
}

export default function DoorShowcase() {
  return (
    <div className="es-door">
      <div className="es-door__copy">
        <p className="es-lp-kicker">At the door</p>
        <h3 className="es-door__title">Check-in that keeps the line moving</h3>
        <p className="es-door__lede">
          Every ticket carries its own QR code. Your door team opens the Eventsli Check-in app on iPhone or iPad,
          scans, and gets the answer in a second. No iPhone? Any phone works from the browser.
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
        <div className="es-door__get">
          <AppStoreButton />
          <p className="es-door__get-note">For organizers and their door staff · iPhone and iPad</p>
        </div>
      </div>

      <div className="es-door__device" aria-hidden="true">
        <p className="es-door__label">The Eventsli Check-in app</p>
        <div className="es-shots">
          {SHOTS.map((shot) => (
            <div key={shot.src} className="es-shot" data-place={shot.place}>
              <Image src={shot.src} alt="" width={600} height={1304} sizes="(min-width: 1024px) 220px, 40vw" className="es-shot__img" />
            </div>
          ))}
        </div>
      </div>

      {/* Full width so the real ticket shows in its real, horizontal form —
          it switches layout at a 40rem container, and squeezed beside the
          phones it fell back to its narrow stacked one. */}
      <div className="es-door__ticket" aria-hidden="true">
        <p className="es-door__label">What your guest brings — on their phone or printed</p>
        <TicketStub ticket={DEMO_TICKET} event={DEMO_EVENT} qrSrc={DEMO_QR_SRC} />
      </div>
    </div>
  );
}
