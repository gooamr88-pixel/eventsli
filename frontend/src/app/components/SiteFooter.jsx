'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CONTACT_EMAIL, FOOTER_GROUPS, SOCIAL_LINKS } from '../lib/siteRoutes';
import { inAppShell } from './SiteHeader';
import Logo from './brand/Logo';

/**
 * The footer.
 *
 * REBUILT 2026-10-17 from the owner's mockup: the logo, one line about the
 * product and the social icons on the left; Explore, For organizers, Company
 * and Legal beside them; the copyright under a hairline. Light, on a soft
 * teal-grey wash with two faint curves — the site stays white (see the brand
 * notes in globals.css).
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
 *
 * ── What is NOT here, from the mockup ───────────────────────────────────────
 * The app-store badges (the owner's instruction: there are no apps), and the
 * language and currency pickers — the site has one language and prices in the
 * event's own currency, so both would be controls that change nothing. The
 * social icons render only for profiles listed in `SOCIAL_LINKS`.
 */
export default function SiteFooter() {
  const pathname = usePathname();

  // The gate is a tablet at a door; the checkout is somebody holding seats with
  // a countdown running. Neither wants a column of exit links. The dashboard and
  // the console have their own shell, and a footer below a fixed sidebar would
  // sit half underneath it.
  if (inAppShell(pathname) || pathname?.startsWith('/checkout')) return null;

  const socials = SOCIAL_LINKS.filter((s) => SOCIAL_ICONS[s.network] && s.href);

  return (
    /* `.es-band--ink` declares its text roles, so the footer reads the same
       under any page and in either OS theme. No top margin: the band above
       supplies its own bottom padding. */
    <footer className="es-band--ink es-site-foot">
      <div aria-hidden className="es-site-foot__shapes"><i /><i /></div>
      <div className="fx-gutter">
        <div className="fx-container fx-container--xl es-site-foot__inner">
          <div className="es-site-foot__grid">
            <div className="es-site-foot__brand">
              <Logo size="lg" />
              <p className="es-site-foot__about">
                Discover, create and manage extraordinary events — from music and
                culture to business and community.
              </p>
              {socials.length > 0 && (
                <ul className="es-site-foot__social" aria-label="Eventsli on social media">
                  {socials.map((s) => (
                    <li key={s.network}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_ICONS[s.network].label}>
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{SOCIAL_ICONS[s.network].glyph}</svg>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} className="es-site-foot__group" aria-label={group.heading}>
                <h2 className="es-site-foot__heading">{group.heading}</h2>
                {/* Each link is a 44px row on a phone, where a thumb lands on
                    them at the end of every page; tighter from md up. */}
                <ul>
                  {group.links.map((link) => (
                    <li key={`${group.heading}-${link.path}`}>
                      <Link href={link.path} className="es-site-foot__link">{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          <div className="es-site-foot__bar">
            {/* These pages are prerendered at BUILD time, so the year baked
                into the HTML is the year of the deploy. On the first of January
                that disagrees with the browser's, which React reports as a
                hydration mismatch — a console error every visitor sees, for a
                copyright notice. Suppressed here rather than solved, because the
                mismatch is the correct behaviour: the client's year is right. */}
            <p suppressHydrationWarning>
              © {new Date().getFullYear()} Eventsli. All rights reserved.
            </p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="es-site-foot__mail">{CONTACT_EMAIL}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Drawn on a 24px grid in currentColor, so they take the footer's ink. */
const SOCIAL_ICONS = {
  instagram: {
    label: 'Instagram',
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </g>
    ),
  },
  x: {
    label: 'X',
    glyph: <path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44z" />,
  },
  facebook: {
    label: 'Facebook',
    glyph: <path fill="currentColor" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.87.25-1.46 1.5-1.46h1.6V4.46A21 21 0 0 0 14.27 4.3c-2.3 0-3.87 1.4-3.87 3.97v2.23H7.8v3h2.6V21h3.1z" />,
  },
  linkedin: {
    label: 'LinkedIn',
    glyph: <path fill="currentColor" d="M5.3 3.5a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zM3.5 9.2h3.6V20.5H3.5zM9.4 9.2h3.45v1.55h.05c.48-.9 1.66-1.85 3.4-1.85 3.64 0 4.3 2.4 4.3 5.5v6.1h-3.6v-5.4c0-1.3-.03-2.97-1.8-2.97-1.82 0-2.1 1.42-2.1 2.88v5.49H9.4z" />,
  },
  youtube: {
    label: 'YouTube',
    glyph: <path fill="currentColor" d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.8 4.8 12 4.8 12 4.8s-6.8 0-8.5.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 4.8 2.8 2.8 0 0 0 2 2c1.7.4 8.5.4 8.5.4s6.8 0 8.5-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-4.8zM9.8 15.1V8.9l5.5 3.1-5.5 3.1z" />,
  },
};
