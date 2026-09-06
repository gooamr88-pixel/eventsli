'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, signOut } from '../hooks/useAuth';

/**
 * The masthead.
 *
 * A CLIENT component, but it does not make any page dynamic: the pages around
 * it still render and cache on the server, and this hydrates and asks
 * `/auth/me` once. Reading the session in the layout instead would opt every
 * page out of static rendering — including the event pages, which are the ones
 * that must be cached and crawlable.
 *
 * While the answer is in flight the auth slot renders NOTHING rather than
 * guessing. Guessing "signed out" and correcting a moment later is a flicker
 * that every signed-in person sees on every page.
 */
/**
 * The gate is a device, not a person, and it runs full-screen on a tablet at a
 * door. A site nav on it is chrome someone can tap by accident mid-queue.
 *
 * The check is in a WRAPPER, above the component that calls `useAuth`, and that
 * is the point. Returning null after the hook still runs it — so the gate was
 * asking `/auth/me` on every load, getting a 401 it never used, and logging an
 * error to the console of a tablet that may have no signal at all. Hooks cannot
 * be skipped; components can.
 */
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith('/gate')) return null;
  return <SiteNav pathname={pathname} />;
}

function SiteNav({ pathname }) {
  const { signedIn, loading, user } = useAuth();

  return (
    <header className="sticky top-0 z-[--es-z-navbar] border-b border-border-base bg-bg/85 backdrop-blur">
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl">
          <div className="fx-row fx-row--between h-14">
            <Link href="/" className="font-serif text-xl tracking-[-0.02em] text-ink">
              Eventsli
            </Link>

            <nav className="fx-row" aria-label="Main">
              <Link href="/events" className="text-sm text-muted transition-colors hover:text-ink">
                Events
              </Link>

              {loading ? null : signedIn ? (
                <>
                  <Link
                    href="/account/tickets"
                    className="text-sm text-muted transition-colors hover:text-ink"
                  >
                    My tickets
                  </Link>
                  {/* Only shown to someone who actually has an organizer
                      profile. Offering it to everyone would send buyers to a
                      dashboard they have no account for. */}
                  {user?.isOrganizer && (
                    <Link
                      href="/organizer"
                      className="text-sm text-muted transition-colors hover:text-ink"
                    >
                      Organizer
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => signOut()}
                    className="rounded-[--es-radius-md] border border-border-strong px-3 py-1.5 text-sm text-ink transition-colors hover:bg-bg-sunken"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/tickets/find"
                    className="text-sm text-muted transition-colors hover:text-ink"
                  >
                    Find my tickets
                  </Link>
                  <Link
                    href={`/login?next=${encodeURIComponent(pathname || '/')}`}
                    className="rounded-[--es-radius-md] border border-border-strong px-3 py-1.5 text-sm text-ink transition-colors hover:bg-bg-sunken"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
