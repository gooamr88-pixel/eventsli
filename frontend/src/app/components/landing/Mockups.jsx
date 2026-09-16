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
 * A fixed 9×9 pattern that reads as a QR code without being one.
 *
 * FIXED, not random, and that is load-bearing: a random pattern differs
 * between the server render and the client hydration, which React treats as a
 * mismatch and logs as an error on the homepage.
 *
 * It is deliberately NOT a scannable code. `components/TicketStub` draws the
 * real one from a signed admission token — the thing that opens a door — and
 * putting a working code on a marketing page would mean minting one.
 */
const QR = [
  '111011101', '100010001', '101110101', '100000001', '101011101',
  '110001011', '101110101', '100010001', '111011101',
];

export function PhoneTicketMockup() {
  return (
    <div aria-hidden className="es-phone">
      <span className="es-phone__notch" />
      <div className="es-phone__screen">
        <div className="es-phone__head">
          <span className="es-phone__brandmark" />
          <span className="text-xs font-medium">Your ticket</span>
        </div>

        <div className="es-phone__ticket">
          <p className="es-phone__eyebrow">Admit one</p>
          <p className="es-phone__title">An evening on the waterfront</p>
          <p className="es-phone__meta">Sat 12 Jun · 7:00 PM</p>
          <p className="es-phone__meta">Harbourfront Centre</p>

          {/* The tear, drawn as one dashed rule with a notch punched in each
              end — a real stub's perforation, and the thing that makes the
              card read as a ticket rather than as a rounded rectangle. */}
          <span className="es-phone__tear">
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

          <div className="es-phone__qr">
            {QR.flatMap((row, y) => (
              [...row].map((cell, x) => (
                <span
                  key={`${y}-${x}`}
                  className={cell === '1' ? 'es-phone__qr-on' : undefined}
                />
              ))
            ))}
          </div>

          <p className="es-phone__code">ESL · 4K7Q · 2M</p>
        </div>

        <span className="es-phone__cta">Add to wallet</span>
      </div>
    </div>
  );
}
