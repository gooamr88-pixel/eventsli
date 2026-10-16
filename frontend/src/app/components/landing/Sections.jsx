import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The storefront's bands that make claims about the PRODUCT: the search band,
 * who it is for, and how an organizer goes on sale.
 *
 * REBUILT 2026-09-17 from the approved mockup. Their words are in source, not
 * in the CMS, for the reason the FAQ's were: "Door staff — scan, even offline"
 * is a promise that /gate works without a connection, and a sentence like that
 * has to change in the same commit as the software it describes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Search ─────────────────────────────────────────────────────────────────
/** A GET form to /events, like the hero's: works before hydration, and the
 *  result is a URL somebody can share. The chips are the admin's first four
 *  categories — real filters, not suggested searches nobody wrote. */
export function SearchBand({ categories }) {
  return (
    <section className="es-band--sunken es-lp-find fx-section fx-section--sm">
      <div className="es-lp-find__inner">
        <p className="es-lp-kicker es-lp-kicker--center">Search</p>
        <h2 className="es-lp-title">
          Looking for something <span className="es-lp-accent">special?</span>
        </h2>
        <p className="es-lp-lede">Type an event, an artist or a venue.</p>

        <form action="/events" method="get" role="search" className="es-lp-findbar">
          <span aria-hidden className="es-lp-findbar__icon"><NavIcon name="search" size={20} /></span>
          <label htmlFor="es-lp-find" className="sr-only">Event, artist or venue</label>
          <input
            id="es-lp-find"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Event, artist or venue"
            className="es-lp-findbar__input"
          />
          <button type="submit" className="es-lp-findbar__submit">Search</button>
        </form>

        {categories.length > 0 && (
          <div className="es-lp-chips">
            <span>Popular:</span>
            {categories.slice(0, 4).map((c) => (
              <Link key={c.slug} href={`/events?category=${encodeURIComponent(c.slug)}`}>{c.label}</Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Choose your role ───────────────────────────────────────────────────────
/**
 * The people this product actually serves, each linking to where their part of
 * it starts. A tile that leads to a page about something the product does not
 * do is the kind of placeholder that ships, so every one of these is real.
 */
const ROLES = [
  { label: 'Organizer', desc: 'Sell tickets & tables', href: '/register/organizer', icon: 'briefcase' },
  { label: 'Ticket buyer', desc: 'Pick your seat', href: '/events', icon: 'ticket' },
  { label: 'Door staff', desc: 'Scan, even offline', href: '/gate', icon: 'scan' },
  { label: 'Group booker', desc: 'A whole table at once', href: '/events', icon: 'users' },
  { label: 'Sponsor', desc: 'Meet your audience', href: '/contact', icon: 'star' },
  { label: 'Venue partner', desc: 'List your space', href: '/contact', icon: 'map' },
];

export function Roles() {
  return (
    <section id="roles" className="es-band fx-section fx-section--sm">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-head">
          <div>
            <p className="es-lp-kicker">Built for everyone</p>
            <h2 className="es-lp-title">Choose <span className="es-lp-accent">your role</span></h2>
            <p className="es-lp-lede">From the person selling the tickets to the one scanning them at the door.</p>
          </div>
        </div>

        <ul className="es-lp-roles">
          {ROLES.map((role) => (
            <li key={role.label}>
              <Link href={role.href} className="es-lp-role">
                <span aria-hidden className="es-lp-role__icon"><NavIcon name={role.icon} size={24} /></span>
                <span className="es-lp-role__name">
                  <span>
                    {role.label}
                    <span className="es-lp-role__desc">{role.desc}</span>
                  </span>
                  <span aria-hidden className="es-lp-role__arrow"><NavIcon name="arrowUpRight" size={14} /></span>
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
            <p>Photos, date, venue and ticket prices. Every page is reviewed before it goes live.</p>
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
            <div aria-hidden className="es-lp-scanmini"><NavIcon name="scan" size={24} />Row C, Seat 12 — admitted</div>
          </li>
        </ol>

        <div className="es-lp-steps__cta">
          <Link href="/register/organizer" className="es-lp-btn es-lp-btn--solid">Start selling</Link>
          <Link href="/how-it-works" className="es-lp-btn es-lp-btn--outline">See how it works</Link>
        </div>
      </div>
    </section>
  );
}
