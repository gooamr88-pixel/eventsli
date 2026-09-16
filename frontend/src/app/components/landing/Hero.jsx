import Link from 'next/link';
import Image from 'next/image';
import HeroSearch from './HeroSearch';

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
export default function Hero({ content, cities, categories }) {
  const hero = content?.hero || {};
  const hasImage = Boolean(hero.imageUrl);

  return (
    <section className="es-band--field es-hero">
      {hasImage && (
        <div className="es-hero__media">
          {/*
            `next/image` with `fill` inside a `<picture>` is not possible — the
            component renders its own <img>. So the art direction is done with
            two <Image> elements and a CSS media query instead, which costs one
            extra element and keeps the optimiser, the AVIF/WebP negotiation and
            the blur placeholder that <picture> with a raw <img> would lose.
          */}
          <Image
            src={hero.imageUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="hidden object-cover md:block"
          />
          <Image
            src={hero.mobileImageUrl || hero.imageUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover md:hidden"
          />
        </div>
      )}

      {/* The ground the text sits on. Always rendered, even with no photograph:
          with no image behind it the scrim resolves to the band's own colour,
          which is exactly what an un-configured hero should look like. */}
      <div aria-hidden className="es-hero__scrim" />

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
                  <HeroSearch cities={cities} />
                </div>
              )}

              {/* The category rail doubles as the hero's "trending" row. It is
                  the same data as the browse section further down, so a reader
                  who arrives knowing what they want never has to scroll. */}
              {categories.length > 0 && (
                <div className="fx-row fx-row--gap items-center pt-1">
                  <span className="text-sm text-muted">Trending</span>
                  <ul className="fx-row fx-row--scroll fx-row--scroll-sm es-rail">
                    {categories.slice(0, 5).map((category) => (
                      <li key={category.slug}>
                        <Link
                          href={`/events?category=${encodeURIComponent(category.slug)}`}
                          className="es-chip"
                        >
                          {category.label}
                        </Link>
                      </li>
                    ))}
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

            {/* The handwritten aside, and it is decoration.
                `aria-hidden` because the sentence is a mood rather than
                information, and this face is genuinely hard to read for anyone
                it is not already easy for — a screen reader spelling it out
                adds nothing the headline above has not already said. */}
            {hero.script && (
              <p aria-hidden className="es-script hidden justify-self-end pe-6 text-end lg:block">
                {hero.script}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
