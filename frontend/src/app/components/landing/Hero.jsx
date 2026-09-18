import Link from 'next/link';
import Image from 'next/image';

import Accent from './Accent';
import HeroSearch from './HeroSearch';
import NavIcon from '../shell/NavIcon';
import { eventDateParts } from '../EventCard';
import { statTiles } from './Proof';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero.
 *
 * REBUILT 2026-09-17 from the approved mockup: a centred headline whose second
 * half is blue with a soft underline, the filter bar, a fan of real event
 * posters, and the counted numbers in a white card beneath them.
 *
 * A SERVER component with one client island (the filter bar). The headline and
 * the buttons are what a crawler and a share-card scraper need, and neither
 * requires JavaScript.
 *
 * ── The posters ─────────────────────────────────────────────────────────────
 * REAL COVERS, from the same events the page already fetched — no second
 * request, and never a stock picture of something that is not on sale. Up to
 * five, fanned out from the middle one on a desktop and a snapping rail on a
 * phone. With no covers, the admin's hero artwork stands alone in their place,
 * so a young platform opens on its own picture rather than a gap.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Hero({ content, categories, events, stats }) {
  const hero = content?.hero || {};

  return (
    <section className="es-lp-hero fx-section">
      <div aria-hidden className="es-lp-dots"><i /><i /><i /><i /><i /><i /></div>

      <div className="fx-container fx-container--xl relative">
        <div className="es-lp-hero__head">
          {/* Admin-owned, from `landingSchema`'s hero block — it used to be a
              literal here, which made the most prominent claim on the homepage
              the one line nobody could change without a deploy. Clearing
              `badgeText` in the console removes it entirely; that is the off
              switch, so there is no boolean to fall out of sync with the copy. */}
          <HeroBadge hero={hero} />

          <h1 className="es-lp-hero__title">
            <Accent text={hero.title} />
            {hero.titleAccent && (
              <>
                {' '}
                <span className="es-lp-swash">
                  {hero.titleAccent}
                  <svg viewBox="0 0 200 16" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M3 11C45 4 125 2 197 8" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                  </svg>
                </span>
              </>
            )}
          </h1>

          {hero.body && <p className="es-lp-hero__body"><Accent text={hero.body} /></p>}

          <div className="es-lp-hero__ctas">
            {hero.secondaryCtaLabel && (
              <Link href={hero.secondaryCtaHref || '/register'} className="es-lp-btn es-lp-btn--outline">
                {hero.secondaryCtaLabel}
              </Link>
            )}
            {hero.primaryCtaLabel && (
              <Link href={hero.primaryCtaHref || '/events'} className="es-lp-btn es-lp-btn--solid">
                {hero.primaryCtaLabel}
                <NavIcon name="arrow" size={18} />
              </Link>
            )}
          </div>
        </div>

        {hero.showSearch !== false && <HeroSearch categories={categories} />}

        <Posters events={events} hero={hero} />

        <Numbers block={content?.stats || {}} stats={stats} />
      </div>
    </section>
  );
}

/** Distance from the centre for each position, so the middle poster is the
 *  front one whatever the count: one poster is [0], three are [-1, 0, 1]. */
const FAN = { 1: [0], 2: [-1, 0], 3: [-1, 0, 1], 4: [-2, -1, 0, 1], 5: [-2, -1, 0, 1, 2] };

/**
 * The badge over the headline, entirely from the admin's content.
 *
 * Nothing at all when `badgeText` is empty — not an empty pill, not a gap.
 * That is the off switch, and it is the text field itself so there is no
 * boolean to disagree with the copy.
 *
 * `badgeTag` is optional on its own: a badge with a claim and no "NEW" is a
 * perfectly good badge, while a "NEW" with nothing after it is not.
 *
 * With a link it becomes one; without, it stays a plain statement. An
 * announcement pointing at nothing is fine — "you can now pick your seat" is a
 * fact, not a destination — so the link is not required to make the rest work.
 */
function HeroBadge({ hero }) {
  const text = (hero.badgeText || '').trim();
  if (!text) return null;

  const tag = (hero.badgeTag || '').trim();
  const inner = (
    <>
      {tag && <b>{tag}</b>}
      {text}
    </>
  );

  return hero.badgeHref
    ? <Link href={hero.badgeHref} className="es-lp-pill es-lp-pill--link">{inner}</Link>
    : <span className="es-lp-pill">{inner}</span>;
}

function Posters({ events, hero }) {
  const posters = events.filter((e) => e.coverUrl).slice(0, 5);

  if (posters.length === 0) {
    if (!hero.imageUrl) return null;
    return (
      <div className="es-lp-fan">
        <div className="es-lp-poster es-lp-poster--solo" style={{ '--i': 0 }}>
          {/* A plain <picture> straight from storage: both files are uploaded
              already encoded at the width each breakpoint paints, and the
              optimiser's first-request re-encode cost five seconds here. */}
          <picture>
            <source media="(max-width: 47.99rem)" srcSet={hero.mobileImageUrl || hero.imageUrl} />
            <source media="(min-width: 48rem)" srcSet={hero.imageUrl} />
            <img src={hero.imageUrl} alt="" loading="eager" fetchPriority="high" decoding="async" className="es-lp-poster__img" />
          </picture>
        </div>
      </div>
    );
  }

  const offsets = FAN[posters.length];

  return (
    <ul className="es-lp-fan" aria-label="On sale now">
      {posters.map((event, i) => {
        const when = eventDateParts(event);
        const lead = offsets[i] === 0;
        return (
          <li key={event.id} className={`es-lp-poster ${lead ? 'es-lp-poster--lead' : ''}`} style={{ '--i': offsets[i] }}>
            <Link href={`/e/${event.slug}`} className="block h-full">
              <Image
                src={event.coverUrl}
                alt=""
                fill
                sizes="(max-width: 1024px) 66vw, 280px"
                priority={lead}
                className="object-cover"
              />
              {when && (
                <span className="es-lp-datebadge"><b>{when.day}</b><small>{when.month}</small></span>
              )}
              <span className="es-lp-poster__name">
                <span className="es-lp-poster__title">{event.title}</span>
                {event.city && <small>{event.city}</small>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * COUNTED, NEVER TYPED. `statsService` produces every value; the CMS chooses
 * only which measures appear and what they are called. See Proof.js.
 */
function Numbers({ block, stats }) {
  // A zero is dropped, not shown. "0 happy guests" is true on a young platform
  // and still the one number that makes a storefront look empty; the honest
  // way to say nothing is to show nothing.
  const tiles = statTiles(block, stats).filter((tile) => Number(tile.value) > 0);
  if (tiles.length === 0) return null;

  return (
    <div className="es-lp-stats">
      <ul className="es-lp-stats__card" style={{ '--es-lp-cols': tiles.length }} aria-label="Eventsli in numbers">
        {tiles.map((tile) => (
          <li key={tile.key} className="es-lp-stat">
            <span className="es-lp-stat__value es-nums">{tile.display}</span>
            <span className="es-lp-stat__label">
              <NavIcon name={tile.icon} size={16} />
              {tile.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
