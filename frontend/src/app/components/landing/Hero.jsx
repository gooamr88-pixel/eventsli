import Link from 'next/link';

import Accent from './Accent';
import HeroCta from './HeroCta';
import HeroSearch from './HeroSearch';
import PartnerCarousel from './PartnerCarousel';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero.
 *
 * REBUILT 2026-11-15 to the approved homepage concept ("Eventsli | Website
 * design inspiration"): on a white page, the headline with its second line on
 * a yellow highlight, one sentence, a coral "Explore Events" and an outlined
 * "Create an Event"; on the right a collage of slanted photographs. Under both,
 * across the full width, the search bar — what, where, when, and one coral
 * Search. On a phone it stacks in the concept's order: headline, photographs,
 * search.
 *
 * A SERVER component with two client islands (the search bar and the logo
 * carousel). The headline and the buttons are what a crawler and a share-card
 * scraper need, and neither requires JavaScript.
 *
 * ── The photographs ─────────────────────────────────────────────────────────
 * The admin's hero artwork first, then the covers of events actually on sale,
 * up to four. A platform with fewer simply shows fewer tiles; with none the
 * copy stands alone — never a stock picture of something that is not on sale.
 * Decorative (`alt=""`, `aria-hidden`): the events are named in the list below.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Hero({ content, events, sponsors = [] }) {
  const hero = content?.hero || {};
  const copy = content?.sections || {};
  const photos = collagePhotos(hero, events);

  return (
    <section className={`es-home-hero fx-gutter ${sponsors.length ? 'es-home-hero--partners' : ''}`}>
      <div className="fx-container fx-container--xl">
        <div className={`es-home-hero__grid ${photos.length ? '' : 'es-home-hero__grid--solo'}`}>
          <div className="es-home-hero__copy">
            {/* Admin-owned, from `landingSchema`'s hero block. Clearing
                `badgeText` in the console removes it entirely. */}
            <HeroBadge hero={hero} />

            <h1 className="es-home-hero__title">
              <span className="es-home-hero__line">
                <Accent text={hero.title} />
                <Sparks />
              </span>
              {hero.titleAccent && (
                <>
                  {' '}
                  {/* The concept's yellow highlight: a FILL behind near-black
                      words (12.5:1), never yellow text. */}
                  <span className="es-home-hero__mark"><span>{hero.titleAccent}</span></span>
                </>
              )}
            </h1>

            {hero.body && <p className="es-home-hero__body"><Accent text={hero.body} /></p>}

            <div className="es-home-hero__ctas">
              {hero.primaryCtaLabel && (
                <Link href={hero.primaryCtaHref || '/events'} className="es-lp-btn es-lp-btn--solid">
                  {hero.primaryCtaLabel}
                  <NavIcon name="arrow" size={18} />
                </Link>
              )}
              {/* `HeroCta`, not a plain Link: pointed at `/register` — its
                  default — it bounced every signed-in visitor back here. */}
              {hero.secondaryCtaLabel && (
                <HeroCta href={hero.secondaryCtaHref} className="es-lp-btn es-lp-btn--line">
                  <NavIcon name="calendarPlus" size={18} />
                  {hero.secondaryCtaLabel}
                </HeroCta>
              )}
            </div>
          </div>

          {photos.length > 0 && (
            <div aria-hidden className={`es-home-hero__collage es-home-hero__collage--${photos.length}`}>
              {photos.map((src, i) => (
                <span key={src} className={`es-home-hero__tile es-home-hero__tile--${i + 1}`}>
                  {/* A plain <img> straight from storage: the file is uploaded
                      already encoded, and the optimiser's first-request
                      re-encode cost five seconds here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img
                    src={src}
                    alt=""
                    loading={i === 0 ? 'eager' : 'lazy'}
                    fetchPriority={i === 0 ? 'high' : 'auto'}
                    decoding="async"
                  />
                </span>
              ))}
            </div>
          )}
        </div>

        {hero.showSearch !== false && <HeroSearch />}
      </div>

      {/* Still nothing until an admin publishes a real logo — see Social.jsx
          on why nothing is seeded. */}
      {sponsors.length > 0 && (
        <div className="es-home-hero__partners">
          <div className="fx-container fx-container--xl">
            <PartnerCarousel label={copy.sponsorsEyebrow || 'Proudly partnered with'} sponsors={sponsors} />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The admin's artwork, then real event covers, de-duplicated, at most four.
 * The landscape artwork is used at every width (owner's review, 2026-10-17);
 * the portrait file is only a fallback.
 */
export function collagePhotos(hero, events = []) {
  const list = [hero?.imageUrl || hero?.mobileImageUrl, ...events.map((e) => e.coverUrl)];
  return [...new Set(list.filter(Boolean))].slice(0, 4);
}

/** The three yellow strokes beside the headline in the concept. Decoration. */
function Sparks() {
  return (
    <svg aria-hidden className="es-home-hero__sparks" viewBox="0 0 40 40" focusable="false">
      <path d="M10 22 4 10" />
      <path d="M20 18 22 4" />
      <path d="M27 25 37 17" />
    </svg>
  );
}

/**
 * The badge over the headline, entirely from the admin's content.
 *
 * Nothing at all when `badgeText` is empty — not an empty pill, not a gap.
 * With a link it becomes one; without, it stays a plain statement.
 */
function HeroBadge({ hero }) {
  const text = (hero.badgeText || '').trim();
  if (!text) return null;

  const tag = (hero.badgeTag || '').trim();
  const inner = (
    <>
      <NavIcon name="sparkle" size={14} />
      {tag && <b>{tag}</b>}
      {text}
    </>
  );

  return hero.badgeHref
    ? <Link href={hero.badgeHref} className="es-lp-pill es-lp-pill--link">{inner}</Link>
    : <span className="es-lp-pill">{inner}</span>;
}
