import Image from 'next/image';
import { safeExternalUrl } from '../../utils/safeUrl';
import NavIcon from '../../components/shell/NavIcon';
import { Zoomable } from '../../components/Lightbox';
import EventShare from './EventShare';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The top of the event page: the poster, the title, and the three facts.
 *
 * NOTHING IS WRITTEN OVER THE POSTER, and that is the whole correction.
 *
 * The first version laid the title, a supporting line and the venue across the
 * artwork behind a scrim. It looked right in a mockup drawn around a photograph
 * chosen for it, and it was wrong for this product: an organizer's cover IS
 * already a poster. It carries the event's name, its date, its venue and its
 * selling points, set by a designer. Printing our own title on top of it hid
 * the poster behind a scrim, repeated every word it already said, and covered
 * the part the organizer paid to have made — so the picture stopped being worth
 * showing at all.
 *
 * So the poster is shown clean, at its own aspect ratio, and every word sits
 * underneath it. The page is longer by one line of type and the artwork is
 * finally legible.
 *
 * AND IT OPENS. A poster's small print — the dress code, the door time, the
 * line-up — is unreadable at the width of a phone. Tapping it opens the shared
 * `Lightbox` full screen, where it can be read and then dismissed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventHero({ event, kicker, lede }) {
  return (
    <section className="es-ev-head">
      {event.coverUrl ? (
        <div className="es-ev-poster">
          <Zoomable
            items={[{ url: event.coverUrl, caption: event.title }]}
            label={`Open the poster for ${event.title} full screen`}
          >
            {/* `object-contain` on a tinted ground, not `cover`. A poster is
                usually portrait and the card is not; cropping it to fill would
                cut the top or the bottom off — which on a poster is the title
                or the date. The blurred copy behind fills the gap so the card
                still reads as one object rather than a picture with bars. */}
            <span aria-hidden className="es-ev-poster__wash">
              <Image src={event.coverUrl} alt="" fill sizes="100vw" />
            </span>
            <Image
              src={event.coverUrl}
              alt={`Poster for ${event.title}`}
              fill
              sizes="(max-width: 48rem) 100vw, 46rem"
              priority
              className="es-ev-poster__img"
            />
          </Zoomable>

          <div className="es-ev-head__actions">
            <EventShare title={event.title} slug={event.slug} />
          </div>
        </div>
      ) : (
        /* No artwork is a normal state — an event may publish without one. The
           title on the brand tint reads as a deliberate cover rather than as
           the image that failed to load. */
        <div className="es-ev-poster es-ev-poster--empty">
          <p className="es-ev-poster__fallback fx-break">{event.title}</p>
          <div className="es-ev-head__actions">
            <EventShare title={event.title} slug={event.slug} />
          </div>
        </div>
      )}

      <div className="es-ev-title">
        {kicker && <p className="es-ev-title__kicker">{kicker}</p>}
        <h1 className="es-ev-title__h1 fx-break">{event.title}</h1>
        {lede && <p className="es-ev-title__lede fx-break">{lede}</p>}
      </div>
    </section>
  );
}

/**
 * When, where and who.
 *
 * A LIST OF ROWS, not three columns. Three columns of real words at phone
 * width gave each about 110px, which broke "(America/Los_Angeles)" across a
 * line mid-word and left the organizer's arrow stranded on a line of its own.
 * Rows give every value the full width, and the icons still let the eye jump
 * straight to the one it wants. From `sm` there is room for two across.
 *
 * The zone is named under the time rather than left to be inferred. A show at
 * 4pm in San Diego is at 4pm on the poster and at the door; printing it in the
 * reader's own clock is how people miss events.
 */
export function EventFacts({ event, when, organizerHref }) {
  return (
    <ul className="es-ev-facts">
      <Fact icon="calendar" label="When" value={when.date}>
        <span className="es-ev-fact__note">{when.time}</span>
        {/* `fx-break` and its own line: a zone name is one unbreakable token
            and will otherwise set the width of the column it sits in. */}
        <span className="es-ev-fact__zone fx-break">{event.timezone}</span>
      </Fact>

      <Fact icon="pin" label="Where" value={event.venue || event.city || 'To be announced'}>
        {(event.venueAddress || (event.venue && event.city)) && (
          <span className="es-ev-fact__note fx-break">{event.venueAddress || event.city}</span>
        )}
      </Fact>

      {event.organizer?.name && (
        <Fact icon="user" label="Organizer" value={event.organizer.name} href={organizerHref} />
      )}
    </ul>
  );
}

function Fact({ icon, label, value, href, children }) {
  const body = (
    <>
      <span aria-hidden className="es-ev-fact__icon"><NavIcon name={icon} size={18} /></span>
      <span className="es-ev-fact__text">
        <span className="es-ev-fact__label">{label}</span>
        <span className="es-ev-fact__value fx-break">{value}</span>
        {children}
      </span>
      {href && (
        <span aria-hidden className="es-ev-fact__go"><NavIcon name="arrow" size={16} /></span>
      )}
    </>
  );

  return (
    <li className="es-ev-fact">
      {href ? <a href={href} className="es-ev-fact__link">{body}</a> : body}
    </li>
  );
}

/**
 * "Presented by" — the single most senior sponsor, and only that one.
 *
 * The full list still has its own place under the Organizer tab; this is the
 * one an organizer sold a headline package to, and showing all six here would
 * make none of them the headline.
 *
 * The logo opens full screen like every other picture on the page. A sponsor's
 * mark is often the only place their strapline is legible, and it is drawn at
 * 36px here.
 */
export function EventPresentedBy({ sponsors = [] }) {
  const lead = sponsors.find((s) => s.level === 'headline') || null;
  if (!lead) return null;

  return (
    <aside className="es-ev-sponsor" aria-label="Presented by">
      <p className="es-ev-sponsor__label">Presented by</p>

      <div className="es-ev-sponsor__logo">
        {lead.logoUrl ? (
          <Zoomable
            items={[{ url: lead.logoUrl, caption: lead.name }]}
            label={`Open the ${lead.name} logo full screen`}
            className="es-ev-sponsor__zoom"
          >
            <Image src={lead.logoUrl} alt={lead.name} width={220} height={72} />
          </Zoomable>
        ) : (
          <span className="es-ev-sponsor__name fx-break">{lead.name}</span>
        )}
      </div>

      {safeExternalUrl(lead.linkUrl) && (
        <a
          href={safeExternalUrl(lead.linkUrl)}
          target="_blank"
          // `nofollow` with the rest, matching the full sponsor list: these are
          // addresses an organizer typed, and this page should not lend them
          // its own standing.
          rel="noreferrer noopener nofollow"
          className="es-ev-sponsor__link"
        >
          Visit<span className="sr-only"> {lead.name} — opens in a new tab</span>
        </a>
      )}
      <p className="es-ev-sponsor__level">Official sponsor</p>
    </aside>
  );
}
