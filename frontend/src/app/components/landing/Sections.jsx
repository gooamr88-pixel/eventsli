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

/**
 * The heading every band opens with: an eyebrow, a serif title, a lede, and
 * whatever controls belong on the right.
 *
 * The controls sit on the TITLE's baseline rather than under the lede, which
 * is what keeps a band's top edge to one line on a desktop. Below md the whole
 * thing stacks, because "Explore all →" beside a two-line heading on a phone
 * is two words per line.
 */
function BandHead({ eyebrow, title, body, action }) {
  return (
    <div className="es-sectionhead">
      <div className="fx-stack fx-stack--sm gap-1">
        {eyebrow && <p className="es-eyebrow">{eyebrow}</p>}
        <h2 className="es-sectionhead__title">{title}</h2>
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
            <Link
              href="/events"
              className="fx-row items-center gap-2 whitespace-nowrap text-sm font-medium text-accent hover:text-accent-hover"
            >
              Explore all events <span aria-hidden>→</span>
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
      <div className="fx-container fx-container--xl relative">
        <div className="grid items-center gap-[var(--fx-gap-lg)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="fx-stack">
            {block.eyebrow && <p className="es-eyebrow text-accent">{block.eyebrow}</p>}
            <h2 className="es-display es-display--wide font-serif">{block.title}</h2>
            {block.body && <p className="max-w-[46ch] text-muted">{block.body}</p>}

            {/* ONE LINE EACH, not a title and a paragraph.
                Five two-line entries is a wall of text beside a picture; five
                single lines is a list somebody reads. The detail each one used
                to carry lives on /why-us, which the button below goes to. */}
            <ul className="es-featurerow pt-1">
              {ORGANIZER_POINTS.map((point) => (
                <li key={point.label} className="es-featurerow__item">
                  <span aria-hidden className="es-featurerow__mark">
                    <NavIcon name={point.icon} size={16} />
                  </span>
                  <span className="es-featurerow__label">{point.label}</span>
                </li>
              ))}
            </ul>

            <div className="fx-row fx-row--gap pt-2">
              <Link href={block.ctaHref || '/register'} className="es-btn es-btn--primary es-btn--lg">
                {block.ctaLabel}
              </Link>
              <Link href="/why-us" className="es-btn es-btn--ghost es-btn--lg">Why Eventsli</Link>
            </div>
          </div>

          <div className="fx-stack fx-stack--sm">
            {/* The product, not a photograph of a laptop. `children` is the
                drawn dashboard; an admin-uploaded image replaces it. */}
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
              /* No `.es-plate` wrapper: the device draws its own frame and
                 shadow, and a plate around it is two bezels. */
              children
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
  { icon: 'sparkle', label: 'Event pages that sell' },
  { icon: 'map', label: 'Seat maps and table plans you draw' },
  { icon: 'bank', label: 'Card money straight to your own Stripe' },
  { icon: 'chart', label: 'Sales, holds and check-ins as they happen' },
  { icon: 'scan', label: 'A door that keeps scanning offline' },
];

// ─── The guest band ─────────────────────────────────────────────────────────
/**
 * THREE COLUMNS, and that is the design: the ticket on the left, the argument
 * in the middle, and a picture on the right.
 *
 * It was two — copy beside a phone — which read as the organizer band mirrored.
 * The middle column is the one that has to be legible, so it takes the widest
 * track and the two pictures share what is left. Below lg it stacks, with the
 * copy FIRST: on a phone the argument matters more than the illustration of
 * it, and a reader who has scrolled past two images to reach a sentence has
 * usually stopped scrolling.
 */
export function GuestBand({ block, children }) {
  return (
    <section className="es-band fx-section">
      <div className="fx-container fx-container--xl">
        <div className="es-guestgrid">
          <div className="es-guestgrid__art es-guestgrid__art--first">{children}</div>

          <div className="fx-stack es-guestgrid__copy">
            {block.eyebrow && <p className="es-eyebrow">{block.eyebrow}</p>}
            <h2 className="es-display es-display--wide font-serif">{block.title}</h2>
            {block.body && <p className="max-w-[46ch] text-muted">{block.body}</p>}

            {/* Two by two, because four one-line claims in a column is a
                list and four in a block is a set — and these are four
                independent facts rather than a sequence. */}
            <ul className="es-guestgrid__points">
              {GUEST_POINTS.map((point) => (
                <li key={point.title} className="es-featurelist__item">
                  <span aria-hidden className="es-featurelist__icon">
                    <NavIcon name={point.icon} size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">{point.title}</span>
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

          {/* The third column exists only when there is a picture for it. An
              empty track would leave the copy floating in the middle of a
              three-up grid with nothing on either side. */}
          {block.imageUrl && (
            <div className="es-guestgrid__art">
              <div className="es-figcard" style={{ aspectRatio: '3 / 4' }}>
                <Image
                  src={block.imageUrl}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 360px"
                  className="object-cover"
                />
                <span aria-hidden className="es-figcard__veil" />
                <span className="es-figcard__caption">
                  <span className="block font-serif text-lg">Events bring us closer</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {block.script && (
          <p aria-hidden className="es-script es-script--tight mt-6 hidden lg:block">
            {block.script}
          </p>
        )}
      </div>
    </section>
  );
}

const GUEST_POINTS = [
  { icon: 'locate', title: 'Find events near you', body: 'One tap, and the nearest city with something on.' },
  { icon: 'layers', title: 'Pick the actual seat', body: 'The chair, on the venue map — not a zone.' },
  { icon: 'receipt', title: 'Easy and secure booking', body: 'Every line shown before you pay. Card payment on Stripe.' },
  { icon: 'ticket', title: 'Tickets on your phone', body: 'No app. It arrives by email and sits in your account.' },
];
