import Link from 'next/link';
import NavIcon from '../shell/NavIcon';
import Accent from './Accent';
import PartnerCarousel from './PartnerCarousel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The bands whose content is other people's — the partners and what guests
 * said — plus the closing call to action.
 *
 * NOTHING HERE IS SEEDED. A logo is a claim that a company works with the
 * platform, a quotation is a claim that a person said it; a placeholder of
 * either is the kind of thing that ships because it looks finished. So both
 * bands RETURN NULL until an admin publishes real rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Partners ───────────────────────────────────────────────────────────────
/**
 * "Trusted by leading brands" — the band that closes the homepage, just above
 * the footer (2026-10-17, owner's footer mockup). The old drifting sponsor
 * strip in the middle of the page is gone; the logos open the page in the
 * hero's card and close it here as tiles.
 *
 * The eyebrow and heading are the admin's (`sponsorsEyebrow`,
 * `sponsorsTitle`); the line under them is in source and says "partners", not
 * the mockup's "global brands" — that is a claim about who the sponsors are,
 * and the admin decides who they are.
 */
export function PartnersBand({ copy, sponsors }) {
  if (sponsors.length === 0) return null;
  const eyebrow = copy.sponsorsEyebrow || 'Our partners';

  return (
    <section className="es-lp-band-partners" aria-label={eyebrow}>
      <div aria-hidden className="es-lp-band-partners__shapes"><i /><i /><i /></div>
      <div className="fx-container fx-container--xl es-lp-band-partners__inner">
        <p className="es-lp-band-partners__eyebrow">{eyebrow}</p>
        <h2 className="es-lp-band-partners__title">
          <Accent text={copy.sponsorsTitle || 'Trusted by leading brands'} lastWord />
        </h2>
        <p className="es-lp-band-partners__lede">
          We&apos;re proud to work with partners who believe in the power of extraordinary events.
        </p>
        <PartnerCarousel label={eyebrow} sponsors={sponsors} heading={false} variant="tiles" />
      </div>
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
