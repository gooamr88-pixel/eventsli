import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import Accent from './Accent';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The bands whose content is other people's: sponsors and what guests said —
 * plus the closing call to action that ends the page.
 *
 * NOTHING HERE IS SEEDED. A logo is a claim that a company works with the
 * platform, a quotation is a claim that a person said it; a placeholder of
 * either is the kind of thing that ships because it looks finished. So both
 * bands RETURN NULL until an admin publishes real rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Sponsor logos ──────────────────────────────────────────────────────────
/**
 * A strip of logos that drifts sideways. The list is rendered twice so the
 * loop has no seam; the second copy is `aria-hidden`, so a screen reader hears
 * each sponsor once. Under `prefers-reduced-motion` it stops and scrolls.
 */
export function SponsorStrip({ copy, sponsors }) {
  if (sponsors.length === 0) return null;

  const logos = (hidden) => sponsors.map((sponsor) => (
    <li key={`${hidden ? 'b' : 'a'}-${sponsor.id}`} aria-hidden={hidden || undefined} className="es-lp-logos__item">
      {/* eslint-disable-next-line @next/next/no-img-element --
          sponsor logos are frequently SVG, which next/image passes through
          unoptimised, and they have no intrinsic dimensions we could give
          `fill` without inventing them. */}
      <img
        src={sponsor.logoUrl}
        alt={hidden ? '' : sponsor.name}
        // NOT lazy. A logo has no box until it loads (its width is `auto`),
        // so a lazy one never intersects the viewport and is never fetched.
        decoding="async"
        className="es-lp-logos__mark"
      />
    </li>
  ));

  return (
    <section className="es-band es-lp-logos" aria-label={copy.sponsorsEyebrow || 'Our sponsors'}>
      <p className="es-lp-logos__label">{copy.sponsorsEyebrow || 'Partners & venues'}</p>
      <ul className="es-lp-logos__track">
        {logos(false)}
        {logos(true)}
      </ul>
    </section>
  );
}

// ─── Testimonials ───────────────────────────────────────────────────────────
export function Testimonials({ copy, testimonials }) {
  if (testimonials.length === 0) return null;

  return (
    <section className="es-band fx-section fx-section--sm">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-head">
          <div>
            {copy.testimonialsEyebrow && <p className="es-lp-kicker">{copy.testimonialsEyebrow}</p>}
            <h2 className="es-lp-title"><Accent text={copy.testimonialsTitle || 'Trusted by hosts and guests'} lastWord /></h2>
          </div>
        </div>

        <ul className="es-lp-quotes">
          {testimonials.slice(0, 6).map((entry) => (
            <li key={entry.id}>
              <figure className="es-lp-quote h-full">
                {entry.rating ? <Stars rating={entry.rating} /> : null}
                <blockquote>{`“${entry.body}”`}</blockquote>
                <figcaption>
                  {entry.avatarUrl ? (
                    // A plain <img>: 42px, from our own bucket, square by CSS.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.avatarUrl} alt="" loading="lazy" decoding="async" className="es-lp-quote__avatar" />
                  ) : (
                    <span aria-hidden className="es-lp-quote__avatar">
                      {entry.authorName.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="fx-min0">
                    <span className="block text-sm font-semibold text-ink">{entry.authorName}</span>
                    {entry.authorRole && <span className="block text-xs text-muted">{entry.authorRole}</span>}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The stars are decoration; the sentence is what a screen reader hears. */
function Stars({ rating }) {
  const filled = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <p>
      <span aria-hidden className="es-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <NavIcon key={n} name="star" size={15} filled={n <= filled} className={n <= filled ? '' : 'opacity-30'} />
        ))}
      </span>
      <span className="sr-only">{`Rated ${filled} out of 5`}</span>
    </p>
  );
}

// ─── Closing ────────────────────────────────────────────────────────────────
export function Closing() {
  return (
    <section className="es-band fx-section fx-section--sm">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-close">
          <h2>Your next great night starts here</h2>
          <p>Find something on this weekend, or put your own event on sale in minutes.</p>
          <div className="es-lp-close__ctas">
            <Link href="/events" className="es-lp-btn es-lp-btn--white">Explore events</Link>
            <Link href="/register/organizer" className="es-lp-btn es-lp-btn--glass">Create your event</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
