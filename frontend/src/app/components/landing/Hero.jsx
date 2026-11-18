import Link from 'next/link';

import Accent from './Accent';
import HeroCta from './HeroCta';
import HeroSearch from './HeroSearch';
import VipSlider from './VipSlider';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero.
 *
 * REBUILT 2026-11-15 to the approved homepage concept ("Eventsli | Website
 * design inspiration"): on a white page, the headline with its second line on
 * a yellow highlight, one sentence, a coral "Explore Events" and an outlined
 * "Create an Event"; on the right the VIP SLIDER (VipSlider.jsx) — the events an
 * admin chose, sliding left and right. It replaced a collage of slanted
 * photographs the owner called "very terrible" (2026-11-15). Under both,
 * across the full width, the search bar — what, where, when, and one coral
 * Search. On a phone it stacks in the concept's order: headline, photographs,
 * search.
 *
 * A SERVER component with two client islands (the search bar and the VIP
 * slider). The headline and the buttons are what a crawler and a share-card
 * scraper need, and neither requires JavaScript.
 *
 * NO SPONSOR STRIP UNDER IT any more (owner, 2026-11-17): "Happening near you"
 * now sits directly below the hero, and the sponsors appear once, in the
 * partners band near the foot of the page (Social.jsx).
 *
 * ── The slider ─────────────────────────────────────────────────────────────
 * `vip` is `/public/vip-events`: the admin's choice in their order, or the
 * soonest upcoming events with a cover when none is chosen. With neither, the
 * copy stands alone — never a stock picture of something that is not on sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const HERO_FALLBACK = Object.freeze({ title: 'Discover Events.', titleAccent: 'Make Memories.', subtitle: 'Discover. Create. Attend. Celebrate.' });

export default function Hero({ content, vip = [] }) {
  /**
   * The admin's hero text, or — when it cannot be loaded at all — the
   * schema's own defaults (backend/utils/landingSchema.js), so the page never
   * shows an empty headline with only the sparks beside it (2026-11-18). An
   * admin who cleared the accent on purpose keeps it cleared: this only applies
   * when there is no hero block at all.
   */
  const hero = content?.hero || HERO_FALLBACK;

  return (
    <section className="es-home-hero fx-gutter">
      <div className="fx-container fx-container--xl">
        <div className={`es-home-hero__grid ${vip.length ? '' : 'es-home-hero__grid--solo'}`}>
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

          {vip.length > 0 && <VipSlider events={vip} />}
        </div>

        {hero.showSearch !== false && <HeroSearch />}
      </div>
    </section>
  );
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
