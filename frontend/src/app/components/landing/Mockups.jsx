import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Two drawings: the organizer's dashboard, and a ticket on a phone.
 *
 * WHY DRAWN AND NOT PHOTOGRAPHED, and not the real components either.
 *
 * The organizer band used to show `HeroSeatMap` — the actual module that draws
 * the actual seat map. It was honest and it was the wrong picture: a bare
 * diagram on a dark band reads as a wireframe, not as a product, and it showed
 * one screen of a dashboard the band is claiming has many.
 *
 * The obvious alternative is a screenshot. A screenshot of this dashboard today
 * shows one event and zeros, it goes stale the first time a margin changes, and
 * it cannot re-tone for the band it sits on. So these are drawn in the design
 * system: they use the real roles, the real type scale and the real components,
 * they are pin-sharp at any density, and they cost about 6KB.
 *
 * NOTHING HERE IS DATA. Every figure is fixed and every one is modest — a
 * dashboard mocked up with "EGP 124,320" is the same lie as a hardcoded
 * statistic, and this product counts its statistics. These are shapes that say
 * "there is a chart here", at a size where nobody reads the number.
 *
 * Both are `aria-hidden`. The claims beside them are the accessible content;
 * a screen reader announcing a fictional revenue figure would be worse than
 * announcing nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── The organizer's dashboard, in a device ──────────────────────────────────

/** The sidebar's items. Real destinations, so the drawing does not promise a
 *  screen the product does not have. */
const NAV = [
  { icon: 'chart', label: 'Dashboard', active: true },
  { icon: 'calendar', label: 'Events' },
  { icon: 'layers', label: 'Seating' },
  { icon: 'receipt', label: 'Orders' },
  { icon: 'scan', label: 'Door' },
  { icon: 'bank', label: 'Payouts' },
];

/** A gentle upward line. Twelve points, fixed, normalised to the viewBox. */
const TREND = [18, 26, 22, 34, 30, 44, 52, 46, 60, 68, 64, 78];

export function DashboardMockup() {
  const max = Math.max(...TREND);
  const points = TREND
    .map((v, i) => `${(i / (TREND.length - 1)) * 100},${34 - (v / max) * 30}`)
    .join(' ');

  return (
    <div aria-hidden className="es-device">
      <div className="es-device__screen">
        {/* The rail. Hidden below sm — a 320px screen showing a sidebar and a
            dashboard shows neither. */}
        <div className="es-device__rail">
          <span className="es-device__brandmark" />
          <ul className="fx-stack fx-stack--sm gap-1">
            {NAV.map((item) => (
              <li
                key={item.label}
                className={`es-device__nav ${item.active ? 'es-device__nav--on' : ''}`}
              >
                <NavIcon name={item.icon} size={14} />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="es-device__body">
          <p className="text-sm font-medium text-ink">Good evening</p>

          <div className="es-device__tiles">
            {[
              { icon: 'calendar', label: 'Live events', value: '3' },
              { icon: 'users', label: 'Checked in', value: '128' },
              { icon: 'ticket', label: 'Sold today', value: '46' },
            ].map((tile) => (
              <div key={tile.label} className="es-device__tile">
                <span className="es-device__tile-icon"><NavIcon name={tile.icon} size={13} /></span>
                <span className="es-device__tile-value">{tile.value}</span>
                <span className="es-device__tile-label">{tile.label}</span>
              </div>
            ))}
          </div>

          <div className="es-device__panel">
            <div className="fx-row fx-row--between items-center">
              <span className="text-xs font-medium text-ink">Sales this week</span>
              <span className="es-pill es-pill--accent">On sale</span>
            </div>
            {/*
              `preserveAspectRatio="none"` with a `vector-effect` on the stroke:
              the chart stretches to whatever width the card is, and the line
              keeps its thickness instead of being scaled into a smear.
            */}
            <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="es-device__chart">
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          <div className="es-device__row">
            <span className="es-device__row-mark"><NavIcon name="map" size={14} /></span>
            <span className="fx-min0">
              <span className="es-device__row-title">Seat map</span>
              <span className="es-device__row-note">184 of 220 seats sold</span>
            </span>
            <span className="es-device__bar">
              <span className="es-device__bar-fill" style={{ width: '84%' }} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── A ticket, on a phone ────────────────────────────────────────────────────

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A REAL QR CODE. It scans, and it opens https://eventsli.com.
 *
 * It was a hand-made 9x9 pattern that only LOOKED like a code, on the argument
 * that a working code on a marketing page would mean minting a real admission
 * token. That argument was right about tokens and wrong about this: the ticket
 * beside it is a drawing, so the code should point at the one URL that is true
 * for everybody and costs nothing to publish — the site itself. Somebody who
 * scans a ticket mockup out of curiosity lands on the homepage, which is the
 * best available outcome of that curiosity.
 *
 * GENERATED, NOT DRAWN. Produced by the `qrcode` package at error-correction
 * level M (25x25 modules) and baked in as one SVG path, merged horizontally —
 * 625 modules become about 200 commands and 2.2KB. No runtime dependency, no
 * image request, no canvas, and pin-sharp at any size because it is a vector.
 *
 * `shape-rendering="crispEdges"` is what makes it SCANNABLE rather than merely
 * present: antialiasing a module boundary greys the edge, and a reader
 * thresholding a grey edge fails on a phone held at an angle.
 *
 * The quiet zone is four modules on every side, which the spec requires — a
 * code rendered flush to its container does not scan. It is in the viewBox
 * rather than in padding, so it cannot be styled away.
 */
const QR = {
  modules: 25,
  /** What it encodes, stated so nobody has to scan the page to find out. */
  href: 'https://eventsli.com',
  path: 'M0 0h7v1h-7zM10 0h1v1h-1zM16 0h1v1h-1zM18 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM11 1h1v1h-1zM13 1h1v1h-1zM15 1h1v1h-1zM18 1h1v1h-1zM24 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h2v1h-2zM14 2h1v1h-1zM16 2h1v1h-1zM18 2h1v1h-1zM20 2h3v1h-3zM24 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h1v1h-1zM10 3h2v1h-2zM13 3h2v1h-2zM18 3h1v1h-1zM20 3h3v1h-3zM24 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h2v1h-2zM11 4h1v1h-1zM13 4h1v1h-1zM18 4h1v1h-1zM20 4h3v1h-3zM24 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h1v1h-1zM10 5h1v1h-1zM12 5h5v1h-5zM18 5h1v1h-1zM24 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h7v1h-7zM8 7h2v1h-2zM11 7h1v1h-1zM14 7h2v1h-2zM0 8h1v1h-1zM2 8h5v1h-5zM9 8h1v1h-1zM11 8h1v1h-1zM13 8h2v1h-2zM18 8h5v1h-5zM2 9h4v1h-4zM8 9h1v1h-1zM10 9h2v1h-2zM13 9h1v1h-1zM16 9h2v1h-2zM19 9h1v1h-1zM23 9h1v1h-1zM0 10h2v1h-2zM4 10h1v1h-1zM6 10h2v1h-2zM9 10h1v1h-1zM14 10h2v1h-2zM17 10h3v1h-3zM21 10h1v1h-1zM23 10h2v1h-2zM0 11h1v1h-1zM2 11h1v1h-1zM7 11h1v1h-1zM9 11h2v1h-2zM12 11h1v1h-1zM14 11h3v1h-3zM19 11h1v1h-1zM24 11h1v1h-1zM4 12h1v1h-1zM6 12h1v1h-1zM8 12h1v1h-1zM11 12h1v1h-1zM17 12h2v1h-2zM20 12h1v1h-1zM22 12h3v1h-3zM0 13h2v1h-2zM5 13h1v1h-1zM7 13h2v1h-2zM10 13h1v1h-1zM12 13h2v1h-2zM16 13h1v1h-1zM19 13h1v1h-1zM21 13h1v1h-1zM23 13h1v1h-1zM0 14h1v1h-1zM3 14h1v1h-1zM5 14h3v1h-3zM9 14h1v1h-1zM13 14h9v1h-9zM23 14h2v1h-2zM0 15h1v1h-1zM2 15h4v1h-4zM7 15h4v1h-4zM12 15h2v1h-2zM17 15h4v1h-4zM24 15h1v1h-1zM0 16h1v1h-1zM2 16h3v1h-3zM6 16h2v1h-2zM12 16h1v1h-1zM14 16h7v1h-7zM22 16h1v1h-1zM8 17h1v1h-1zM16 17h1v1h-1zM20 17h2v1h-2zM0 18h7v1h-7zM11 18h2v1h-2zM16 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM22 18h3v1h-3zM0 19h1v1h-1zM6 19h1v1h-1zM8 19h4v1h-4zM14 19h1v1h-1zM16 19h1v1h-1zM20 19h2v1h-2zM24 19h1v1h-1zM0 20h1v1h-1zM2 20h3v1h-3zM6 20h1v1h-1zM8 20h1v1h-1zM10 20h2v1h-2zM15 20h6v1h-6zM22 20h3v1h-3zM0 21h1v1h-1zM2 21h3v1h-3zM6 21h1v1h-1zM8 21h2v1h-2zM12 21h4v1h-4zM17 21h2v1h-2zM20 21h5v1h-5zM0 22h1v1h-1zM2 22h3v1h-3zM6 22h1v1h-1zM8 22h3v1h-3zM13 22h2v1h-2zM21 22h2v1h-2zM24 22h1v1h-1zM0 23h1v1h-1zM6 23h1v1h-1zM12 23h2v1h-2zM16 23h2v1h-2zM19 23h3v1h-3zM24 23h1v1h-1zM0 24h7v1h-7zM8 24h1v1h-1zM10 24h1v1h-1zM12 24h1v1h-1zM14 24h1v1h-1zM19 24h6v1h-6z',
};

/** Four modules of quiet zone on every side, per the spec. */
const QR_QUIET = 4;

export function PhoneTicketMockup() {
  const span = QR.modules + QR_QUIET * 2;

  return (
    <div className="es-phone">
      <div className="es-phone__screen">
        {/* The status bar. A phone without one reads as a rounded rectangle;
            it is the smallest detail that turns the frame into a device. */}
        <div aria-hidden className="es-phone__status">
          <span className="es-phone__clock">9:41</span>
          <span className="es-phone__status-icons">
            <svg viewBox="0 0 18 10" width="15" height="9">
              <rect x="0" y="6.5" width="3" height="3.5" rx="0.6" fill="currentColor" />
              <rect x="4.6" y="4.4" width="3" height="5.6" rx="0.6" fill="currentColor" />
              <rect x="9.2" y="2.2" width="3" height="7.8" rx="0.6" fill="currentColor" />
              <rect x="13.8" y="0" width="3" height="10" rx="0.6" fill="currentColor" />
            </svg>
            <svg viewBox="0 0 24 12" width="19" height="10">
              <rect x="0.6" y="0.6" width="18.8" height="10.8" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="2.4" y="2.4" width="13" height="7.2" rx="1.6" fill="currentColor" />
              <rect x="21.2" y="4" width="2.2" height="4" rx="1.1" fill="currentColor" />
            </svg>
          </span>
        </div>

        <div className="es-phone__head">
          <span aria-hidden className="es-phone__brandmark" />
          <span className="es-phone__headline">Your ticket</span>
        </div>

        <div className="es-phone__ticket">
          <p className="es-phone__eyebrow">Admit one</p>
          <p className="es-phone__title">An evening on the waterfront</p>
          <p className="es-phone__meta">Sat 12 Jun · 7:00 PM</p>
          <p className="es-phone__meta">Harbourfront Centre, Toronto</p>

          {/* A real stub's perforation — one dashed rule with a notch bitten
              out of each end. It is what makes the card read as a ticket
              rather than as a rounded rectangle. */}
          <span aria-hidden className="es-phone__tear">
            <span className="es-phone__notch-l" />
            <span className="es-phone__notch-r" />
          </span>

          <div className="es-phone__seat">
            {[['Section', 'A'], ['Row', '12'], ['Seat', '7']].map(([label, value]) => (
              <span key={label}>
                <span className="es-phone__seat-label">{label}</span>
                <span className="es-phone__seat-value">{value}</span>
              </span>
            ))}
          </div>

          {/* A LINK, because it does what it looks like it does: scanning it
              and pressing it arrive at the same place. */}
          <a href={QR.href} className="es-phone__qr">
            <svg
              viewBox={`0 0 ${span} ${span}`}
              shapeRendering="crispEdges"
              role="img"
              aria-label="Scan to open eventsli.com"
            >
              <rect width={span} height={span} fill="#ffffff" />
              <g transform={`translate(${QR_QUIET} ${QR_QUIET})`}>
                <path d={QR.path} fill="#071713" />
              </g>
            </svg>
          </a>

          <p className="es-phone__code">Scan to open eventsli.com</p>
        </div>

        <span className="es-phone__cta">Add to wallet</span>
        <span aria-hidden className="es-phone__home" />
      </div>
    </div>
  );
}
