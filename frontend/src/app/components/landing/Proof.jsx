import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The two bands that make claims about the platform itself: what people said,
 * and how big it is.
 *
 * THE STATISTICS ARE THE POINT OF THIS FILE.
 *
 * The design this storefront was built to showed "10K+ Events Created · 2M+
 * Happy Guests · 150+ Cities Worldwide". Every one of those is a number
 * somebody typed. This platform currently has one published event, and the
 * honest version of that strip says so.
 *
 * There is no prop here that takes a number from the CMS, and there is no field
 * for one in `landingSchema`. An admin chooses which measures appear and what
 * they are called; the values are counted in `statsService` at render time. The
 * only way to change the number on the page is to change the business.
 *
 * Anything that fails to count comes back null and its tile is dropped, rather
 * than rendering "0" — which would be a claim ("no organizers") where the truth
 * is "we could not count just now".
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A count, written the way a person would say it.
 *
 * NOT "10K+" until it earns it. Rounding 1,240 to "1.2K+" hides nothing and
 * reads as bigger; rounding 12 to "10+" is a lie in the other direction, and
 * rounding 1 to "1+" is absurd. So exact below a thousand, abbreviated above,
 * and the "+" only appears where rounding actually discarded something.
 */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.floor(k) : Math.floor(k * 10) / 10}K+`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.floor(m) : Math.floor(m * 10) / 10}M+`;
}

/**
 * Which tiles the strip would render, as data.
 *
 * Separate from the component because the CALLER has to know whether the strip
 * is empty, and `<StatStrip/>` is an element object — truthy even when the
 * component returns null. Asking "is this element empty?" is not a question
 * JSX can answer, so the emptiness is decided here instead.
 */
export function statTiles(block, stats) {
  if (!stats || !block || block.enabled === false) return [];

  return [
    block.showEvents !== false && { key: 'events', value: stats.events, label: block.eventsLabel, icon: 'sparkle' },
    block.showOrganizers !== false && { key: 'organizers', value: stats.organizers, label: block.organizersLabel, icon: 'briefcase' },
    block.showGuests !== false && { key: 'guests', value: stats.guests, label: block.guestsLabel, icon: 'users' },
    block.showCities !== false && { key: 'cities', value: stats.cities, label: block.citiesLabel, icon: 'pin' },
    block.showVisits === true && { key: 'visits', value: stats.visits, label: block.visitsLabel, icon: 'trend' },
  ]
    .filter(Boolean)
    // A measure that could not be counted is dropped, not rendered as zero.
    .map((tile) => ({ ...tile, display: formatCount(tile.value) }))
    .filter((tile) => tile.display !== null);
}

export function StatStrip({ block, stats }) {
  const tiles = statTiles(block, stats);
  if (tiles.length === 0) return null;

  return (
    <ul className="es-statgrid">
      {tiles.map((tile) => (
        <li key={tile.key} className="es-mark">
          <span aria-hidden className="text-accent"><NavIcon name={tile.icon} size={20} /></span>
          <span className="es-mark__value">{tile.display}</span>
          <span className="es-mark__label">{tile.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The testimonials.
 *
 * A GRID, not a carousel. A carousel hides most of its content behind a control
 * nobody presses, needs JavaScript to show the second item, and on a page whose
 * whole job is persuasion it is the one component that guarantees most of the
 * persuasion is never seen. Three quotations side by side are three quotations
 * read.
 *
 * Returns null when there are none: a testimonials band with nothing in it is
 * worse than no band, and an unpublished-by-default table means "none" is the
 * normal state until somebody deliberately publishes one.
 */
export function Testimonials({ copy, testimonials, stats, statsBlock }) {
  const hasStats = statTiles(statsBlock, stats).length > 0;

  if (testimonials.length === 0) {
    // The statistics still stand on their own — they are counted, not quoted.
    if (!hasStats) return null;
    return (
      <section className="es-band--sunken fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <StatStrip block={statsBlock} stats={stats} />
        </div>
      </section>
    );
  }

  return (
    <section className="es-band--sunken fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        <div className="fx-stack fx-stack--sm">
          {copy.testimonialsEyebrow && <p className="es-eyebrow">{copy.testimonialsEyebrow}</p>}
          <h2 className="font-serif text-2xl">{copy.testimonialsTitle}</h2>
        </div>

        <ul className="fx-grid fx-grid--3 fx-grid--fill">
          {testimonials.slice(0, 6).map((entry) => (
            <li key={entry.id}>
              <figure className="es-quote">
                {entry.rating ? <Stars rating={entry.rating} /> : null}
                <blockquote className="es-quote__body">{entry.body}</blockquote>
                <figcaption className="es-quote__foot">
                  {entry.avatarUrl ? (
                    /* A plain <img>: avatars are small, arbitrary-origin within
                       our own bucket, and square by CSS — the optimiser has
                       nothing to add at 44px. */
                    /* eslint-disable-next-line @next/next/no-img-element --
                       a 44px avatar from our own bucket; the optimiser has
                       nothing to add at that size. */
                    <img
                      src={entry.avatarUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-11 rounded-full object-cover"
                    />
                  ) : (
                    <span aria-hidden className="es-avatar">
                      {entry.authorName.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="fx-min0">
                    <span className="block font-medium text-ink">{entry.authorName}</span>
                    {entry.authorRole && (
                      <span className="block text-sm text-muted">{entry.authorRole}</span>
                    )}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>

        {hasStats && (
          <div className="pt-2">
            <StatStrip block={statsBlock} stats={stats} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Five glyphs, and a sentence for anyone not looking at them.
 *
 * The stars are `aria-hidden` and the rating is written out in visually hidden
 * text. Announcing five <svg>s reads as "star star star star star" whether one
 * is filled or all of them, which tells a listener the opposite of the truth.
 */
function Stars({ rating }) {
  const filled = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <p>
      <span aria-hidden className="es-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <NavIcon
            key={n}
            name="star"
            size={16}
            // The empty ones keep their outline and lose the eye's weight, so
            // the row reads as "four of five" rather than as four stars.
            filled={n <= filled}
            className={n <= filled ? '' : 'opacity-30'}
          />
        ))}
      </span>
      <span className="sr-only">{`Rated ${filled} out of 5`}</span>
    </p>
  );
}
