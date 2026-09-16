import Link from 'next/link';
import Image from 'next/image';
import EventCard from '../EventCard';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The storefront's bands, apart from the hero.
 *
 * One file rather than seven, because each of these is twenty to fifty lines
 * and they share a shape: an eyebrow, a heading from `site_content`, and a body
 * that renders real rows or a real empty state. Seven files would be seven
 * import lines and one idea.
 *
 * EVERY ONE OF THEM CAN RENDER NOTHING, and each decides for itself what that
 * means:
 *
 *   • Sponsors and testimonials RETURN NULL when empty. An empty band with a
 *     heading over blank space reads as a page that failed to load. These
 *     sections are opt-in content — no sponsors is a normal state for a young
 *     platform, not an error, and the honest presentation of "none" is
 *     "nothing here".
 *   • Featured events renders an EMPTY STATE instead. A storefront with no
 *     events is not normal and hiding it would hide the one thing a visitor
 *     came for; the state says whether it is us or the calendar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The heading pattern every band below opens with. */
function BandHead({ eyebrow, title, body, action }) {
  return (
    <div className="fx-row fx-row--between items-end">
      <div className="fx-stack fx-stack--sm">
        {eyebrow && <p className="es-eyebrow">{eyebrow}</p>}
        <h2 className="font-serif text-2xl">{title}</h2>
        {body && <p className="max-w-[52ch] text-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Featured events ────────────────────────────────────────────────────────
export function FeaturedEvents({ copy, events, failed }) {
  return (
    <section className="es-band--sunken fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        <BandHead
          eyebrow={copy.featuredEyebrow}
          title={copy.featuredTitle}
          body={copy.featuredBody}
          action={(
            <Link href="/events" className="es-btn es-btn--ghost es-btn--sm whitespace-nowrap">
              Explore all <span aria-hidden>→</span>
            </Link>
          )}
        />

        {events.length > 0 ? (
          <div className="fx-grid fx-grid--4 fx-grid--fill">
            {events.map((event, i) => (
              <EventCard key={event.id} event={event} priority={i < 4} />
            ))}
          </div>
        ) : (
          <div className="es-empty">
            <p className="text-muted">
              {failed ? 'We could not load events just now.' : 'Nothing is on sale just yet.'}
            </p>
            <p className="mt-1 text-sm text-subtle">
              {failed
                ? 'Please try again in a moment.'
                : 'New events are reviewed and published every week — check back soon.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Categories ─────────────────────────────────────────────────────────────
/**
 * The browse rail.
 *
 * A category with artwork renders as a picture; one without renders as a chip.
 * Mixing the two in one row is deliberate — the alternative is either a grey
 * placeholder box per unillustrated category, which looks broken, or no rail at
 * all until somebody uploads thirteen images.
 */
export function Categories({ copy, categories }) {
  if (categories.length === 0) return null;
  const illustrated = categories.filter((c) => c.imageUrl);
  const plain = categories.filter((c) => !c.imageUrl);

  return (
    <section className="es-band fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        <BandHead eyebrow={copy.categoriesEyebrow} title={copy.categoriesTitle} />

        {illustrated.length > 0 && (
          <ul className="fx-grid fx-grid--4 fx-grid--fill">
            {illustrated.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/events?category=${encodeURIComponent(category.slug)}`}
                  className="es-figcard block"
                  style={{ aspectRatio: '4 / 5' }}
                >
                  <Image
                    src={category.imageUrl}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 50vw, 260px"
                    className="object-cover"
                  />
                  <span aria-hidden className="es-figcard__veil" />
                  <span className="es-figcard__caption">
                    <span className="block font-serif text-lg">{category.label}</span>
                    {category.blurb && (
                      <span className="mt-1 block text-sm opacity-80">{category.blurb}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {plain.length > 0 && (
          <ul className="fx-row fx-row--gap">
            {plain.map((category) => (
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
        )}
      </div>
    </section>
  );
}

// ─── Sponsors ───────────────────────────────────────────────────────────────
/**
 * The logo wall.
 *
 * NOTHING IS SEEDED HERE AND NOTHING EVER SHOULD BE. Every logo in this row is
 * a claim that a company has a relationship with this platform. A placeholder
 * — a famous mark dropped in to show the layout — is the kind of thing that
 * ships, because it looks finished and nobody remembers it is a lie.
 *
 * So: no rows, no band.
 */
export function Sponsors({ copy, sponsors }) {
  if (sponsors.length === 0) return null;

  return (
    <section className="es-band fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        <div className="fx-stack fx-stack--sm">
          {copy.sponsorsEyebrow && <p className="es-eyebrow">{copy.sponsorsEyebrow}</p>}
          <h2 className="font-serif text-2xl">{copy.sponsorsTitle}</h2>
        </div>

        <ul className="grid grid-cols-2 items-center gap-[var(--fx-gap)] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {sponsors.map((sponsor) => {
            /*
              A plain <img>, not next/image, and this is the one place in the app
              that is true.

              Sponsor logos are frequently SVG, which next/image refuses to
              optimise and passes through anyway — so the component buys nothing
              — and they have no intrinsic dimensions we know, which `fill`
              would force us to invent. `.es-sponsor` constrains the tile
              instead, so every mark occupies the same optical area whatever
              shape it arrived in.

              `loading="lazy"` because this band is below the fold on every
              viewport.
            */
            const mark = (
              /* eslint-disable-next-line @next/next/no-img-element --
                 argued above: sponsor logos are frequently SVG, which
                 next/image passes through unoptimised anyway, and they have no
                 intrinsic dimensions we could give `fill` without inventing
                 them. */
              <img
                src={sponsor.logoUrl}
                alt={sponsor.name}
                loading="lazy"
                decoding="async"
                className="es-sponsor__mark"
              />
            );

            return (
              <li key={sponsor.id}>
                {sponsor.linkUrl ? (
                  <a
                    href={sponsor.linkUrl}
                    className="es-sponsor"
                    // An outbound link to somebody else's site, from a list an
                    // admin edits. `noopener` is the one that matters: without
                    // it the opened page gets a handle on ours through
                    // window.opener.
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {mark}
                  </a>
                ) : (
                  <span className="es-sponsor">{mark}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ─── The organizer band ─────────────────────────────────────────────────────
export function OrganizerBand({ block, children }) {
  return (
    <section id="organizers" className="es-band--field fx-section relative overflow-hidden">
      <div aria-hidden className="es-bloom -top-40 -left-32 size-[34rem]" />
      <div className="fx-container fx-container--xl relative">
        <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="fx-stack">
            {block.eyebrow && <p className="es-eyebrow text-accent">{block.eyebrow}</p>}
            <h2 className="es-display es-display--wide font-serif">{block.title}</h2>
            {block.body && <p className="max-w-[46ch] text-muted">{block.body}</p>}

            <ul className="es-featurelist pt-1">
              {ORGANIZER_POINTS.map((point) => (
                <li key={point.title} className="es-featurelist__item">
                  <span aria-hidden className="es-featurelist__icon">
                    <NavIcon name={point.icon} size={18} />
                  </span>
                  <span>
                    <span className="block font-medium text-ink">{point.title}</span>
                    <span className="block text-sm text-muted">{point.body}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="fx-row fx-row--gap pt-2">
              <Link href={block.ctaHref || '/register'} className="es-btn es-btn--primary es-btn--lg">
                {block.ctaLabel}
              </Link>
              <Link href="/why-us" className="es-btn es-btn--secondary es-btn--lg">Why Eventsli</Link>
            </div>
          </div>

          <div className="fx-stack fx-stack--sm">
            {/* The product, not a photograph of a laptop. `children` is the
                seat map the old hero used to carry — it moved here, where it
                is evidence for the claim above it rather than decoration on a
                page that had not made a claim yet. */}
            {block.imageUrl ? (
              <div className="es-plate">
                <div className="es-figure" style={{ '--es-figure-ar': '16 / 10' }}>
                  <Image
                    src={block.imageUrl}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 100vw, 620px"
                    className="object-cover"
                  />
                </div>
              </div>
            ) : (
              <div className="es-plate">{children}</div>
            )}

            {block.script && (
              <p aria-hidden className="es-script es-script--tight hidden text-end lg:block">
                {block.script}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Four capabilities, each one a screen that exists in the dashboard.
 *
 * In source rather than in the CMS, deliberately. These are claims about what
 * the software does — if the seat editor were removed tomorrow this text would
 * have to change in the same commit, and a database row cannot be part of a
 * commit. The CMS owns the heading and the picture; the product's promises stay
 * where the product is.
 */
const ORGANIZER_POINTS = [
  { icon: 'map', title: 'Draw the room', body: 'Rows, round and oval tables, private tables behind a password.' },
  { icon: 'bank', title: 'Paid to your own Stripe', body: 'Card money lands in your account at the sale. Our commission is its own line.' },
  { icon: 'chart', title: 'Numbers as they happen', body: 'Sales, holds and who has walked in, per event.' },
  { icon: 'scan', title: 'A door that works offline', body: 'PIN-locked tablets or named staff. Scanning keeps working without a signal.' },
];

// ─── The guest band ─────────────────────────────────────────────────────────
export function GuestBand({ block, children }) {
  return (
    <section className="es-band fx-section">
      <div className="fx-container fx-container--xl">
        <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="fx-stack">
            {block.eyebrow && <p className="es-eyebrow">{block.eyebrow}</p>}
            <h2 className="es-display es-display--wide font-serif">{block.title}</h2>
            {block.body && <p className="max-w-[46ch] text-muted">{block.body}</p>}

            <ul className="es-featurelist pt-1">
              {GUEST_POINTS.map((point) => (
                <li key={point.title} className="es-featurelist__item">
                  <span aria-hidden className="es-featurelist__icon">
                    <NavIcon name={point.icon} size={18} />
                  </span>
                  <span>
                    <span className="block font-medium text-ink">{point.title}</span>
                    <span className="block text-sm text-muted">{point.body}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="fx-row fx-row--gap pt-2">
              <Link href={block.ctaHref || '/events'} className="es-btn es-btn--primary es-btn--lg">
                {block.ctaLabel}
              </Link>
              <Link href="/tickets/find" className="es-btn es-btn--ghost es-btn--lg">Find my tickets</Link>
            </div>
          </div>

          <div className="fx-stack fx-stack--sm">
            {block.imageUrl ? (
              <div className="es-figcard" style={{ aspectRatio: '4 / 3' }}>
                <Image
                  src={block.imageUrl}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 560px"
                  className="object-cover"
                />
              </div>
            ) : children}

            {block.script && (
              <p aria-hidden className="es-script es-script--tight hidden lg:block">
                {block.script}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const GUEST_POINTS = [
  { icon: 'pin', title: 'Find what is on near you', body: 'Search by city, by date, or by the kind of night you are after.' },
  { icon: 'layers', title: 'Pick the actual seat', body: 'Not a zone — the chair, on the venue map, held while you check out.' },
  { icon: 'receipt', title: 'Every line before you pay', body: 'Price, tax and any fee listed separately, with the total, before payment.' },
  { icon: 'ticket', title: 'The ticket is on your phone', body: 'No app. It arrives by email and sits in your account.' },
];
