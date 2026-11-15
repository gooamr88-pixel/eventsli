import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import DoorShowcase, { ScanMini } from './DoorShowcase';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The storefront's bands that make claims about the PRODUCT: the tools an
 * organizer gets, and how they go on sale.
 *
 * REBUILT 2026-09-17 from the approved mockup. Their words are in source, not
 * in the CMS, for the reason the FAQ's were: "Door staff — scan, even offline"
 * is a promise that /gate works without a connection, and a sentence like that
 * has to change in the same commit as the software it describes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Everything you need to host an event ───────────────────────────────────
/**
 * The concept's strip under the event list (2026-11-15): a heading with the
 * coral bar and four tools, each a white card with a coral icon.
 *
 * THE CONCEPT'S FOURTH TILE WAS "VENDORS" — vendor applications and a
 * marketplace — and this product has neither. A tile promising a feature that
 * does not exist is the placeholder that ships, so the fourth tile is the seat
 * map, which is real and is the thing this product does that others do not.
 * Every tile here links to where the claim is explained.
 */
const HOST_TOOLS = [
  { name: 'Ticketing', desc: 'Sell tickets online and manage attendees.', icon: 'ticket', href: '/how-it-works' },
  { name: 'QR Check-in', desc: 'Fast and secure entry with QR scanning — even offline.', icon: 'qr', href: '/how-it-works' },
  { name: 'Sponsors', desc: 'Showcase sponsors on your event page.', icon: 'handshake', href: '/why-us' },
  { name: 'Seat maps', desc: 'Let buyers pick their exact seat or table.', icon: 'map', href: '/why-us' },
];

export function HostTools() {
  return (
    <section id="host" className="es-band es-host fx-section fx-section--sm">
      <div className="fx-container fx-container--xl es-host__inner">
        <div className="es-host__head">
          <h2 className="es-lp-title es-lp-title--bar es-host__title">Everything you need to host an event</h2>
          <p className="es-host__lede">Powerful tools for organizers, sponsors, and door staff — all in one platform.</p>
        </div>
        <ul className="es-host__list">
          {HOST_TOOLS.map((tool) => (
            <li key={tool.name}>
              <Link href={tool.href} className="es-host__tool">
                <span aria-hidden className="es-host__icon"><NavIcon name={tool.icon} size={26} /></span>
                <span>
                  <span className="es-host__name">{tool.name}</span>
                  <span className="es-host__desc">{tool.desc}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── On sale in three steps ─────────────────────────────────────────────────
/**
 * A real sequence — page, then map, then the door — so the numbers carry
 * information. Each step has a small drawing of the screen it describes,
 * built from the design tokens rather than a screenshot that would go stale.
 */
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A SEAT MAP THAT LOOKS LIKE OURS (2026-10-16, owner's review).
 *
 * This was twenty squares in a grid, coloured at random — the owner called it
 * false, and it was: nothing in the product looks like that. It is now a small
 * drawing of what the seat map really is — a stage, curved rows facing it,
 * round tables with their chairs — in the seat map's OWN colour roles
 * (`--es-seat-*`), so the picture and the product cannot drift apart in colour.
 *
 * Built once at module load from fixed numbers: a drawing, not data, so it
 * never reorders and needs no state.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MINI_SOLD = new Set(['0-3', '0-4', '0-5', '1-4', '1-5', '1-6', '1-9', '2-2', '2-10', '3-6', '3-7']);
const MINI_PICKED = new Set(['2-6', '2-7']);
const MINI_ROWS = [0, 1, 2, 3].flatMap((row) => {
  const count = 12 + row;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = 48 + t * 204;
    // A gentle arc, deeper at the ends, so the rows face the stage.
    const y = 46 + row * 15 + ((x - 150) ** 2) / 1300;
    const key = `${row}-${i}`;
    return { key, x, y, state: MINI_PICKED.has(key) ? 'picked' : MINI_SOLD.has(key) ? 'sold' : 'open' };
  });
});
const MINI_TABLES = [
  { cx: 78, cy: 146, label: 'T1', sold: [0, 1, 2] },
  { cx: 150, cy: 150, label: 'T2', sold: [] },
  { cx: 222, cy: 146, label: 'T3', sold: [0, 1, 2, 3, 4, 5] },
].map((t) => ({
  ...t,
  chairs: Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return { x: t.cx + Math.cos(a) * 17, y: t.cy + Math.sin(a) * 17, sold: t.sold.includes(i) };
  }),
}));

function SeatMapMini() {
  return (
    <div aria-hidden className="es-lp-seatmap">
      <svg viewBox="0 0 300 176" className="es-lp-seatmap__svg">
        <rect x="95" y="8" width="110" height="20" rx="6" className="es-lp-seatmap__stage" />
        <text x="150" y="22" textAnchor="middle" className="es-lp-seatmap__stage-label">STAGE</text>
        {MINI_ROWS.map((s) => (
          <rect key={s.key} x={s.x - 4.5} y={s.y - 4.5} width="9" height="9" rx="2.5" className={`es-lp-seatmap__seat is-${s.state}`} />
        ))}
        {MINI_TABLES.map((t) => (
          <g key={t.label}>
            <circle cx={t.cx} cy={t.cy} r="10.5" className="es-lp-seatmap__table" />
            <text x={t.cx} y={t.cy + 3} textAnchor="middle" className="es-lp-seatmap__table-label">{t.label}</text>
            {t.chairs.map((c, i) => (
              // Index keys: a fixed drawing that never reorders.
              <circle key={i} cx={c.x} cy={c.y} r="4" className={`es-lp-seatmap__seat ${c.sold ? 'is-sold' : 'is-open'}`} />
            ))}
          </g>
        ))}
      </svg>
      <ul className="es-lp-seatmap__legend">
        <li><i className="is-open" />Available</li>
        <li><i className="is-picked" />Your seats</li>
        <li><i className="is-sold" />Sold</li>
      </ul>
    </div>
  );
}

export function Steps() {
  return (
    <section id="how" className="es-band--sunken es-lp-find fx-section">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-head">
          <div>
            <p className="es-lp-kicker">For organizers</p>
            <h2 className="es-lp-title">On sale in <span className="es-lp-accent">three steps</span></h2>
            <p className="es-lp-lede">Card payments go straight to your own Stripe account.</p>
          </div>
        </div>

        <ol className="es-lp-steps es-lp-rail">
          <li className="es-lp-step">
            <span className="es-lp-step__n">1</span>
            <h3>Create your event page</h3>
            <p>Photos, date, venue and ticket prices. Publish when you are ready — Eventsli reviews every new event.</p>
            <div aria-hidden className="es-lp-pagemini"><div /><div><span /><span /><span /></div></div>
          </li>
          <li className="es-lp-step">
            <span className="es-lp-step__n">2</span>
            <h3>Draw your seat map</h3>
            <p>Rows, sections and round tables — guests pick the exact chair they want.</p>
            <SeatMapMini />
          </li>
          <li className="es-lp-step">
            <span className="es-lp-step__n">3</span>
            <h3>Sell and scan at the door</h3>
            <p>Watch sales live, then check guests in with any phone — it keeps working offline.</p>
            <ScanMini />
          </li>
        </ol>

        <DoorShowcase />

        <div className="es-lp-steps__cta">
          <Link href="/register/organizer" className="es-lp-btn es-lp-btn--solid">Start selling</Link>
          <Link href="/how-it-works" className="es-lp-btn es-lp-btn--outline">See how it works</Link>
        </div>
      </div>
    </section>
  );
}
