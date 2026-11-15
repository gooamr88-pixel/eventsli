import NavIcon from '../components/shell/NavIcon';
import { LogoMark } from '../components/brand/Logo';
import { serverFetch } from '../utils/apiClient';

/**
 * The credential screens: sign in, create an account, confirm the email, and
 * the two password steps.
 *
 * A route group — `(auth)` in parentheses — so it shares a layout without
 * adding a segment to any URL. The pages are `/login`, not `/auth/login`, which
 * is what `proxy.ts` guards and what every "sign in" link in the app points at.
 *
 * REBUILT 2026-11-15 (owner: "auth pages are very terrible in everything").
 * The form on clean white on one side; on the other, from `lg` up, a STICKY
 * brand panel in the sheet's yellow — the homepage's own promise, three
 * reasons to have an account, and a fan of real event posters (the VIP events
 * an admin chose). Sticky, so a long form (an organizer's sign-up) scrolls
 * past it instead of stretching it into an empty slab. Below `lg` the panel is
 * gone: on a phone the reader is here to type, not to be sold to.
 *
 * The header above already carries the logo, so the form does not repeat it;
 * each form owns the page's only <h1>. The posters are decorative and their
 * fetch is cached; with none (or a slow API) the panel is words alone and the
 * form is never held up.
 */
const REASONS = [
  ['ticket', 'Every ticket you buy, in one place', 'Including ones bought as a guest with the same email.'],
  ['share', 'Send a ticket to a friend', 'Wherever the organizer allows it.'],
  ['calendar', 'Sell your own events', 'Seat maps, payouts to your own Stripe, a door team.'],
];

async function posters() {
  try {
    const data = await serverFetch('/public/vip-events', { tags: ['landing', 'events:published'], revalidate: 300 });
    return (Array.isArray(data?.events) ? data.events : [])
      .filter((e) => e.coverUrl)
      .slice(0, 3)
      .map((e) => ({ id: e.id, url: e.coverUrl }));
  } catch {
    return [];
  }
}

export default async function AuthLayout({ children }) {
  const fan = await posters();

  return (
    <main className="es-auth es-authx">
      <div className="es-authx__form-side">
        <div className="es-authx__form">{children}</div>
      </div>

      <aside className="es-authx__panel" aria-hidden="true">
        <div className="es-authx__panel-inner">
          <p className="es-authx__title">
            Discover Events.
            <span className="es-authx__mark"><span>Make Memories.</span></span>
          </p>

          <ul className="es-authx__reasons">
            {REASONS.map(([icon, title, text]) => (
              <li key={title}>
                <span className="es-authx__reason-icon"><NavIcon name={icon} size={18} /></span>
                <span>
                  <b>{title}</b>
                  {text}
                </span>
              </li>
            ))}
          </ul>

          {/* With no VIP posters yet, the logo's E card, large and tilted, so
              the panel is never a yellow slab with nothing at the bottom. */}
          {fan.length === 0 && (
            <div className="es-authx__fan es-authx__fan--mark">
              <span className="es-authx__bigmark"><LogoMark /></span>
            </div>
          )}

          {fan.length > 0 && (
            <div className={`es-authx__fan es-authx__fan--${fan.length}`}>
              {fan.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- decorative posters straight from storage
                <img key={p.id} src={p.url} alt="" loading="lazy" decoding="async" className={`es-authx__poster es-authx__poster--${i + 1}`} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}
