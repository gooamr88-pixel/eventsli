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
    /* WHITE, under a thin rule of the brand teal.

       It was zinc-950, then a deep green, and since 2026-09-16 it is white:
       the owner rejected dark bands, and confirmed it again when the brand
       guide arrived on 2026-10-16. What ends the page is the teal rule — the
       guide's own top-bar motif — and the change of type size, which is how a
       printed page ends, not a slab of colour. `.es-band--ink` still declares
       its text roles, so the footer reads the same under any page.

       No `mt-16`: the band above supplies its own bottom padding, and adding a
       margin here on top of it gives the footer a gap that changes size
       depending on which page it is under. */
    <footer className="es-band--ink es-site-foot">
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl fx-section fx-section--sm">
          {/* `gap-y-10` and not the grid's own gap. Stacked into one column on
              a phone, the four groups were 16px apart while a heading sat 8px
              above its links and the links were 6px apart — so the strongest
              boundary on the block was only twice the weakest, and the whole
              footer read as one long list with some words in capitals in it.
              The column gap is untouched: from md up these are side by side
              and never needed the room. */}
          {/* Two columns of links on a phone, not one: stacked, the three
              groups made the footer alone a screen and a half of scrolling. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
            <div className="col-span-2 fx-stack fx-stack--sm md:col-span-1">
              {/* THE FULL LOCKUP — mark, word and DISCOVER - BOOK - ENJOY — as
                  the brand guide draws it. The footer is the one place on a
                  page with room for the tagline at a size someone can read; in
                  the masthead it would be 6px tall. It replaced a separate
                  tagline paragraph, which made two slogans side by side. */}
              {/* `lg`: at the default size the tagline is 7px, which is
                  decoration nobody can read. Large puts it near 10px. */}
              <Logo size="lg" tagline />
              <p className="max-w-[34ch] text-sm text-subtle">
                Tickets and seat maps for events across Canada and the United States.
              </p>
            </div>

            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} className="fx-stack fx-stack--sm" aria-label={group.heading}>
                <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-subtle">{group.heading}</h2>
                {/* `fx-touch` and no gap: each link is a 44px row. They were
                    18px tall on a 32px pitch, the smallest targets on every
                    public page and the ones a thumb lands on at the end of
                    one. */}
                <ul className="fx-stack fx-stack--sm gap-0">
                  {group.links.map((link) => (
                    <li key={`${group.heading}-${link.path}`}>
                      <Link
                        href={link.path}
                        className="fx-touch text-sm text-muted transition-colors hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          {/* ── What is NOT here ────────────────────────────────────────
              The design carries a newsletter field and four social icons.
              Neither is in this footer, and that is a decision rather than an
              omission: there is no mailing list behind the field and no
              accounts behind the icons. A form that accepts an address and
              drops it is worse than no form — somebody believes they
              subscribed — and a social icon linking to a profile that does
              not exist is a dead end on every page of the site.
              Both are a few lines to add the day the list and the accounts
              exist. */}
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
            {/* One slogan, the brand's: it is in the lockup above. A second
                line here ("More than events…") competed with it. */}
            <span className="fx-row items-center gap-4">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-xs text-muted transition-colors hover:text-ink"
              >
                {CONTACT_EMAIL}
              </a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
