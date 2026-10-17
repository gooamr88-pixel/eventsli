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
 * REBUILT 2026-10-17 from the owner's mockup: the headline, the two buttons and
 * the search bar on the left; one photograph on the right, cut on a diagonal
 * and running off the edge of the screen; the partner logos in a card that
 * overlaps its foot. On a phone everything stacks, and the search card sits
 * over the top edge of a full-width photo.
 *
 * It replaces the poster fan and the numbers card — neither is in the mockup.
 *
 * A SERVER component with two client islands (the search bar and the logo
 * carousel). The headline and the buttons are what a crawler and a share-card
 * scraper need, and neither requires JavaScript.
 *
 * ── The photograph ──────────────────────────────────────────────────────────
 * The admin's hero artwork (`imageUrl`, the landscape file, at every width). A
 * platform with no artwork yet falls back to the first real event cover, and
 * with neither the copy simply stands alone — never a stock picture of
 * something that is not on sale. Decorative (`alt=""`, `aria-hidden`), so its
 * place in the document is free to follow the phone layout: after the search.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Hero({ content, events, sponsors = [] }) {
  const hero = content?.hero || {};
  const copy = content?.sections || {};
  const cover = events.find((e) => e.coverUrl)?.coverUrl;
  /**
   * ONE FILE AT EVERY WIDTH. The phone layout shows the photograph as a
   * landscape strip, so the landscape artwork is the right crop there too;
   * the portrait `mobileImageUrl` cut down to a 2:1 band showed a wall and
   * the tops of heads (owner's review, 2026-10-17). It is only a fallback now.
   */
  const photo = hero.imageUrl || hero.mobileImageUrl || cover;

  return (
    <section className={`es-lp-hero ${photo ? 'es-lp-hero--art' : ''} ${sponsors.length ? 'es-lp-hero--partners' : ''}`}>
      <div className="es-lp-hero__top">
        <div className="es-lp-hero__inner">
          <div className="fx-container fx-container--xl">
            <div className="es-lp-hero__copy">
              {/* Admin-owned, from `landingSchema`'s hero block. Clearing
                  `badgeText` in the console removes it entirely; that is the off
                  switch, so there is no boolean to fall out of sync with the copy. */}
              <HeroBadge hero={hero} />

              <h1 className="es-lp-hero__title">
                <Accent text={hero.title} />
                {hero.titleAccent && (
                  <>
                    {' '}
                    <span className="es-lp-hero__accent">{hero.titleAccent}</span>
                  </>
                )}
              </h1>

              {hero.body && <p className="es-lp-hero__body"><Accent text={hero.body} /></p>}

              <div className="es-lp-hero__ctas">
                {hero.primaryCtaLabel && (
                  <Link href={hero.primaryCtaHref || '/events'} className="es-lp-btn es-lp-btn--solid">
                    {hero.primaryCtaLabel}
                    <NavIcon name="arrow" size={18} />
                  </Link>
                )}
                {/* `HeroCta`, not a plain Link: pointed at `/register` — which is
                    its default — this button bounced every signed-in visitor back
                    to this same page, because the proxy has nothing to register
                    them for. See HeroCta for the rule. */}
                {hero.secondaryCtaLabel && (
                  <HeroCta href={hero.secondaryCtaHref} className="es-lp-btn es-lp-btn--line">
                    {hero.secondaryCtaLabel}
                  </HeroCta>
                )}
              </div>
            </div>

            {hero.showSearch !== false && <HeroSearch />}
          </div>
        </div>

        {photo && (
          <div aria-hidden className="es-lp-hero__art">
            <i className="es-lp-hero__glow" />
            {/* A plain <img> straight from storage: the file is uploaded already
                encoded, and the optimiser's first-request re-encode cost five
                seconds here. */}
            <span className="es-lp-hero__photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img src={photo} alt="" loading="eager" fetchPriority="high" decoding="async" />
            </span>
          </div>
        )}
      </div>

      {/* The sponsors band used to be its own section further down the page;
          the mockup moves it into the hero. Still nothing until an admin
          publishes a real logo — see Social.jsx on why nothing is seeded. */}
      {sponsors.length > 0 && (
        <div className="es-lp-hero__partners">
          <div className="fx-container fx-container--xl">
            <PartnerCarousel label={copy.sponsorsEyebrow || 'Proudly partnered with'} sponsors={sponsors} />
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The badge over the headline, entirely from the admin's content.
 *
 * Nothing at all when `badgeText` is empty — not an empty pill, not a gap.
 * `badgeTag` is optional on its own: a badge with a claim and no "NEW" is a
 * perfectly good badge, while a "NEW" with nothing after it is not.
 *
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
