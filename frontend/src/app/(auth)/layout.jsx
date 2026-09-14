import Link from 'next/link';
import NavIcon from '../components/shell/NavIcon';

/**
 * The credential screens: sign in, create an account, confirm the email, and
 * the two password steps.
 *
 * A route group — `(auth)` in parentheses — so it shares a layout without
 * adding a segment to any URL. The pages are `/login`, not `/auth/login`, which
 * is what `proxy.ts` guards and what every "sign in" link in the app points at.
 *
 * From `lg` up the form sits beside a field-tone panel saying what an account
 * is for; below it the panel is gone and the form is the whole screen, because
 * on a phone the reader is here to type, not to be sold to. The panel has no
 * headings — each form owns the page's only <h1>, and a heading above it would
 * scramble the outline.
 */
const REASONS = [
  ['ticket', 'Every ticket you buy, in one place — including ones bought as a guest with the same email.'],
  ['check', 'Pass a ticket to a friend once, where the organizer allows it.'],
  ['calendar', 'Sell your own events: seat maps, payouts to your Stripe, a door team.'],
];

export default function AuthLayout({ children }) {
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--lg">
        <div className="es-plate grid overflow-hidden bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <aside className="es-band--field relative hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between">
            <div aria-hidden className="es-bloom -top-32 -left-24 size-[26rem]" />
            <div className="fx-stack relative">
              <p className="es-eyebrow text-accent">Eventsli</p>
              <p className="max-w-[18ch] font-serif text-3xl leading-tight text-ink">Find something to go to.</p>
              <ul className="fx-stack fx-stack--sm pt-2">
                {REASONS.map(([icon, text]) => (
                  <li key={text} className="fx-row items-start text-muted">
                    <span className="text-accent"><NavIcon name={icon} size={18} /></span>
                    <span className="fx-min0 flex-1">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="relative text-sm text-subtle">
              Bought as a guest? <Link href="/tickets/find" className="text-accent underline">Find your tickets</Link> without an account.
            </p>
          </aside>

          <div className="p-6 sm:p-10">
            <div className="mx-auto w-full max-w-[26rem]">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
