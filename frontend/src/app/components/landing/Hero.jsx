import Link from 'next/link';

import HeroSearch from './HeroSearch';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero.
 *
 * A SERVER component with one client island in it (the search bar). The
 * headline, the photograph and the buttons are the things a crawler and a
 * share-card scraper need, and none of them requires JavaScript to exist.
 *
 * THE PHOTOGRAPH IS TWO FILES, not one with `object-fit` doing the work.
 * The desktop artwork is a 2:1 panorama and the mobile one is a 3:4 portrait,
 * because they are not the same picture cropped — a panorama cropped to a
 * phone is a picture of somebody's shoulder.
 *
 * Both are `priority`. This is the Largest Contentful Paint element on the most
 * visited page on the site; lazy-loading it would mean the hero renders as a
 * dark band and the picture arrives a beat later, which is the exact jank
 * `priority` exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Hero({ content, categories }) {
  const hero = content?.hero || {};
  const video = content?.video;
  const hasImage = Boolean(hero.imageUrl);

  return (
    <section className="es-band--photo es-hero">
      {hasImage && (
        <div className="es-hero__media">
          {/*
            ─────────────────────────────────────────────────────────────────
            A PLAIN <picture>, SERVED STRAIGHT FROM STORAGE. No next/image.

            This is the one place in the app that opts out of the optimiser,
            and it is a measurement rather than a preference.

            WHAT WAS WRONG. Two `<Image>` elements art-directed with
            `hidden md:block` / `md:hidden`. `display: none` does not stop a
            fetch, and both carried `priority`, so every device downloaded and
            PRELOADED both files — a phone spent its first bytes on a desktop
            panorama it would never paint. 210KB + 204KB, LCP 9.1s.

            WHY NOT JUST getImageProps + <picture>. That fixed the double
            download (471KB from 701KB) and left the real cost in place: the
            optimiser has to fetch the original from Supabase, re-encode it and
            cache it. Timed on this build, a cache MISS takes 5.56s and a HIT
            takes 0.03s — so the first visitor after every deploy waits five
            seconds for the largest element on the page, per variant, per size.

            WHAT THE OPTIMISER WOULD ADD HERE IS NOTHING. These two files are
            uploaded through the admin console already encoded as WebP at the
            exact dimensions each breakpoint paints (1983w and 941w). There is
            no format to negotiate and no size to derive. Supabase serves them
            from its own CDN with immutable caching.

            So: the browser fetches one file, directly, with no transform in
            front of it. The `media` attributes decide which — and they are the
            same queries the preloads above use, so exactly one is preloaded
            too.
            ─────────────────────────────────────────────────────────────────
          */}
          <link
            rel="preload"
            as="image"
            href={hero.mobileImageUrl || hero.imageUrl}
            media="(max-width: 47.99rem)"
          />
          <link
            rel="preload"
            as="image"
            href={hero.imageUrl}
            media="(min-width: 48rem)"
          />

          <picture>
            <source media="(max-width: 47.99rem)" srcSet={hero.mobileImageUrl || hero.imageUrl} />
            <source media="(min-width: 48rem)" srcSet={hero.imageUrl} />
            <img
              src={hero.imageUrl}
              alt=""
              // What `priority` sets on an <Image>. A <picture> has to say it.
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </picture>
        </div>
      )}

      {/* The ground the text sits on. Always rendered: with no photograph
          behind it the veil resolves to the band's own colour, which is
          exactly what an un-configured hero should look like. */}
      <div aria-hidden className="es-hero__veil" />

      <div className="es-hero__body fx-gutter">
        <div className="fx-container fx-container--xl">
          <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="fx-stack es-rise">
              {hero.eyebrow && (
                <p className="es-eyebrow text-accent">{hero.eyebrow}</p>
              )}

              <h1 className="es-display es-hero__title">
                {hero.title}
                {hero.titleAccent && (
                  <>
                    {' '}
                    {/* The accent line in italic, on its own line at desktop
                        widths. `block` rather than a <br>, so at 320px it
                        simply wraps like the rest of the sentence instead of
                        forcing a break that leaves one word stranded. */}
                    <em className="block italic">{hero.titleAccent}</em>
                  </>
                )}
              </h1>

              {hero.subtitle && (
                <p className="text-lg font-medium text-ink">{hero.subtitle}</p>
              )}
              {hero.body && (
                <p className="max-w-[46ch] text-muted">{hero.body}</p>
              )}

              {hero.showSearch !== false && (
                <div className="pt-2">
                  <HeroSearch />
                </div>
              )}

              {/* "Trending:" and the chips on one line, which is what the
                  design does — the label is part of the row rather than a
                  heading above it, so the rail starts at the eye's height
                  instead of a line below it. */}
              {categories.length > 0 && (
                <div className="fx-row items-center gap-3">
                  <span className="shrink-0 text-sm font-medium text-ink">Trending</span>
                  <ul className="fx-row fx-row--scroll fx-row--scroll-sm es-rail">
                    {categories.slice(0, 4).map((category) => (
                      <li key={category.slug}>
                        <Link
                          href={`/events?category=${encodeURIComponent(category.slug)}`}
                          className="es-chip"
                        >
                          {category.label}
                        </Link>
                      </li>
                    ))}
                    {/* The rail is cut to four so this always fits beside
                        them. It is the end of the row rather than a link
                        under it: somebody scanning chips for the one they
                        want should find "there are more" in the same
                        movement, not after giving up. */}
                    {categories.length > 4 && (
                      <li>
                        <Link href="#categories" className="es-chip es-chip--more">
                          Explore more
                          <span aria-hidden>→</span>
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="fx-row fx-row--gap pt-1">
                {hero.primaryCtaLabel && (
                  <Link href={hero.primaryCtaHref || '/events'} className="es-btn es-btn--primary es-btn--lg">
                    {hero.primaryCtaLabel}
                  </Link>
                )}
                {hero.secondaryCtaLabel && (
                  <Link href={hero.secondaryCtaHref || '/register'} className="es-btn es-btn--secondary es-btn--lg">
                    {hero.secondaryCtaLabel}
                  </Link>
                )}
              </div>
            </div>

            {/* The right column: the handwritten aside, and the film.

                Both are decoration in different senses. The script is a mood
                and is `aria-hidden` — the face is genuinely hard to read for
                anyone it is not already easy for, and the headline above has
                said the same thing. The watch control is NOT hidden: it is a
                real link to a real section, and it only renders when there is
                a film to watch. */}
            <div className="fx-stack hidden items-end lg:flex">
              {hero.script && (
                <p aria-hidden className="es-script pe-4 text-end">{hero.script}</p>
              )}

              {video?.enabled && video?.url && (
                <a href="#watch" className="es-watch">
                  <span aria-hidden className="es-roundbtn es-roundbtn--lg">
                    <NavIcon name="play" size={20} filled />
                  </span>
                  <span>
                    <span className="es-watch__title">{video.title || 'Watch our story'}</span>
                    {video.caption && <span className="es-watch__note">{video.caption}</span>}
                  </span>
                </a>
              )}
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
