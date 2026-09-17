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
 * RESTYLED 2026-09-17 to the storefront. From `lg` up the form sits beside the
 * brand's own hero photograph with what an account is for written over it;
 * below `lg` the photograph is gone and the form is the whole card, because on
 * a phone the reader is here to type, not to be sold to. The panel has no
 * headings — each form owns the page's only <h1>.
 *
 * The photograph is the one the admin uploaded for the homepage hero, read from
 * the same cached landing payload. If it cannot be loaded the panel falls back
 * to the brand blue, so a slow CMS never costs anyone the sign-in form.
 */
const REASONS = [
  ['ticket', 'Every ticket you buy, in one place — including ones bought as a guest with the same email.'],
  ['check', 'Pass a ticket to a friend once, where the organizer allows it.'],
  ['calendar', 'Sell your own events: seat maps, payouts to your Stripe, a door team.'],
];

async function heroImage() {
  try {
    const landing = await serverFetch('/public/landing', { tags: ['landing'], revalidate: 300 });
    return landing?.content?.hero?.imageUrl || null;
  } catch {
    return null;
  }
}

export default async function AuthLayout({ children }) {
  const image = await heroImage();

  return (
    <main className="es-auth fx-section fx-section--sm">
      <div className="es-auth__shell">
        <aside className="es-auth__aside">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- decorative, from our own storage, already encoded at display size
            <img src={image} alt="" loading="lazy" decoding="async" className="es-auth__photo" />
          )}
          <div className="es-auth__aside-body">
            <p className="es-auth__aside-kicker">Eventsli</p>
            <p className="es-auth__aside-title">Find something to go to.</p>
            <ul className="es-auth__reasons">
              {REASONS.map(([icon, text]) => (
                <li key={text}>
                  <span aria-hidden className="es-auth__reason-icon"><NavIcon name={icon} size={16} /></span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="es-auth__main">
          <div className="es-auth__form">
            <span aria-hidden className="es-auth__mark"><LogoMark /></span>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
