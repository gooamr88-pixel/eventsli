'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CONTACT_EMAIL, FOOTER_GROUPS } from '../lib/siteRoutes';
import { inAppShell } from './SiteHeader';
import Logo from './brand/Logo';

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
  // a countdown running. Neither wants a column of exit links. The dashboard and
  // the console have their own shell, and a footer below a fixed sidebar would
  // sit half underneath it.
  if (inAppShell(pathname) || pathname?.startsWith('/checkout')) return null;

  return (
    /* THE INK BLOCK, and the page's last note.

       Every band above this one is paper or sunken, so the footer is the one
       place on the site where the tone inverts — which is what makes the page
       end rather than just stop. `.es-band--ink` re-points the text roles
       inside itself, so `text-muted` on a link below is zinc-400 on near-black
       (7.76:1) rather than slate-600 on near-black (2.6:1). Setting `color`
       alone on a dark footer is the single most common contrast failure on a
       site, precisely because the headings look right.

       No `mt-16`: the band above supplies its own bottom padding, and adding a
       margin here on top of it gives the footer a gap that changes size
       depending on which page it is under. */
    <footer className="es-band--ink">
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl fx-section fx-section--sm">
          {/* `gap-y-10` and not the grid's own gap. Stacked into one column on
              a phone, the four groups were 16px apart while a heading sat 8px
              above its links and the links were 6px apart — so the strongest
              boundary on the block was only twice the weakest, and the whole
              footer read as one long list with some words in capitals in it.
              The column gap is untouched: from md up these are side by side
              and never needed the room. */}
          <div className="fx-grid fx-grid--4 gap-y-10">
            <div className="fx-stack fx-stack--sm">
              {/* The drawn mark, not the word set in the serif. The masthead,
                  the sidebar and the favicon all show the leaf; a footer that
                  spells the name instead is the one place the brand is absent
                  on a page that has just ended. */}
              <Logo size="md" />
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
