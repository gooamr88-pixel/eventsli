'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CONTACT_EMAIL, FOOTER_GROUPS } from '../lib/siteRoutes';

/**
 * The footer.
 *
 * A client component for one reason — the same reason SiteHeader is one: it has
 * to know the path, so that it can disappear on the two screens where site
 * chrome is actively harmful. Reading the path in the layout would opt every
 * page out of static rendering, including the event pages that must be cached
 * and crawlable. This hydrates and renders links; it fetches nothing.
 *
 * The links are `FOOTER_GROUPS`, which references the same paths the sitemap
 * publishes. A footer is most of a small site's internal linking, and a link
 * here that the sitemap does not know about is a page nothing points at.
 */
export default function SiteFooter() {
  const pathname = usePathname();

  // The gate is a tablet at a door; the checkout is somebody holding seats with
  // a countdown running. Neither wants a column of exit links.
  if (pathname?.startsWith('/gate') || pathname?.startsWith('/checkout')) return null;

  return (
    <footer className="mt-16 border-t border-border-base bg-bg-sunken">
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl fx-section fx-section--sm">
          <div className="fx-grid fx-grid--4">
            <div className="fx-stack fx-stack--sm">
              <p className="font-serif text-xl tracking-[-0.02em] text-ink">Eventsli</p>
              <p className="max-w-[34ch] text-sm text-muted">
                Tickets and seat maps for events across Canada and the United States.
              </p>
            </div>

            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} className="fx-stack fx-stack--sm" aria-label={group.heading}>
                <h2 className="text-xs uppercase tracking-[0.14em] text-subtle">{group.heading}</h2>
                <ul className="fx-stack fx-stack--sm gap-1.5">
                  {group.links.map((link) => (
                    <li key={`${group.heading}-${link.path}`}>
                      <Link
                        href={link.path}
                        className="text-sm text-muted transition-colors hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          <div className="fx-row fx-row--between mt-8 border-t border-border-base pt-6">
            {/* These pages are prerendered at BUILD time, so the year baked
                into the HTML is the year of the deploy. On the first of January
                that disagrees with the browser's, which React reports as a
                hydration mismatch — a console error every visitor sees, for a
                copyright notice. Suppressed here rather than solved, because the
                mismatch is the correct behaviour: the client's year is right. */}
            <p className="text-xs text-subtle" suppressHydrationWarning>
              © {new Date().getFullYear()} Eventsli
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-xs text-muted transition-colors hover:text-ink"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
