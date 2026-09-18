import Image from 'next/image';
import NavIcon from '../../components/shell/NavIcon';
import EventShare from './EventShare';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The top of the event page: the picture, the three facts, and who is
 * presenting.
 *
 * REBUILT from the approved mobile mockup. What changed and why:
 *
 * THE ART IS A CARD, NOT A BAND. It was full-bleed, which on a phone means the
 * photograph's edges are cut off by the viewport — the organizer's poster,
 * cropped by the device. Inside a rounded card with the page's own gutter the
 * whole frame is visible, which was the brief: let the picture be seen on its
 * own first.
 *
 * THE FACTS ARE A ROW, NOT A LIST. When, where and who were a `<dl>` of ruled
 * rows that took most of a phone screen to say three short things. Three
 * icon-led columns say the same in a fifth of the height, and this page is one
 * the reader should be able to take in without scrolling four times.
 *
 * THE SPONSOR MOVED UP. A headline sponsor was a section at the very bottom,
 * below the tabs and the organizer — past where almost anybody scrolls, which
 * is the one place their money does not reach.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventHero({ event, kicker, lede }) {
  const place = [event.venue, event.city].filter(Boolean);

  return (
    <section className="es-ev-hero">
      {event.coverUrl && (
        <>
          <Image
            src={event.coverUrl}
            alt=""
            fill
            sizes="(max-width: 48rem) 100vw, 46rem"
            priority
          />
          <span aria-hidden className="es-ev-hero__scrim" />
        </>
      )}

      {/* Share and save. Absolute, so they cost no vertical space — see the
          note on `.es-ev-hero__actions` for why they are not in the masthead. */}
      <div className="es-ev-hero__actions">
        <EventShare title={event.title} slug={event.slug} />
      </div>

      <div className="es-ev-hero__body">
        {/* The organizer's own first few highlights, as the kicker. Nothing at
            all when they have written none — an empty eyebrow above a title is
            a gap the reader reads as a mistake. */}
        {kicker && <p className="es-ev-hero__kicker">{kicker}</p>}

        <h1 className="es-ev-hero__title fx-break">{event.title}</h1>

        {lede && <p className="es-ev-hero__lede">{lede}</p>}

        {place.length > 0 && (
          <p className="es-ev-hero__where">
            <NavIcon name="pin" size={18} />
            <span className="fx-min0">
              {place.map((part, i) => (
                <span key={part} className={i === 0 ? 'block font-medium' : 'block'}>{part}</span>
              ))}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * When, where and who — the three things somebody checks before anything else.
 *
 * The zone is named under the time rather than left to be inferred. A show at
 * 4pm in San Diego is at 4pm on the poster and at the door; printing it in the
 * reader's own clock is how people miss events, so the clock it belongs to is
 * part of the answer.
 */
export function EventFacts({ event, when, organizerHref }) {
  return (
    <div className="es-ev-facts fx-grid">
      <Fact icon="calendar" label="When" value={when.date} note={`${when.time}\n(${event.timezone})`} />

      <Fact
        icon="pin"
        label="Where"
        value={event.venue || event.city || 'To be announced'}
        note={event.venueAddress || (event.venue ? event.city : null)}
      />

      {event.organizer?.name && (
        <Fact
          icon="user"
          label="Organizer"
          value={event.organizer.name}
          /* A link only where there is somewhere to go — the organizer panel
             is a tab on this same page, so this is an in-page jump rather
             than a promise of a profile that does not exist. */
          href={organizerHref}
        />
      )}
    </div>
  );
}

function Fact({ icon, label, value, note, href }) {
  const body = (
    <span className="es-ev-fact__text">
      <span className="es-ev-fact__label">{label}</span>
      <span className="es-ev-fact__value fx-break">
        {value}
        {href && <NavIcon name="arrow" size={14} />}
      </span>
      {/* `whitespace-pre-line`, because the time and its zone are one fact on
          two lines and joining them with a comma reads as two. */}
      {note && <span className="es-ev-fact__note fx-break whitespace-pre-line">{note}</span>}
    </span>
  );

  return (
    <div className="es-ev-fact">
      <span aria-hidden className="es-ev-fact__icon"><NavIcon name={icon} size={18} /></span>
      {href ? <a href={href} className="fx-min0 no-underline">{body}</a> : body}
    </div>
  );
}

/**
 * "Presented by" — the single most senior sponsor, and only that one.
 *
 * The full list still has its own section further down; this is the one an
 * organizer sold a headline package to, and showing all six here would make
 * none of them the headline.
 *
 * A logo where there is one, the name in clean type where there is not — never
 * a broken image and never a dead anchor. External links carry `noreferrer`
 * because this page sends traffic to addresses an organizer typed and the
 * platform has not vetted.
 */
export function EventPresentedBy({ sponsors = [] }) {
  const lead = sponsors.find((s) => s.level === 'headline') || null;
  if (!lead) return null;

  const mark = lead.logoUrl
    ? <Image src={lead.logoUrl} alt={lead.name} width={220} height={80} />
    : <span className="es-ev-sponsor__name fx-break">{lead.name}</span>;

  return (
    <aside className="es-ev-sponsor" aria-label="Presented by">
      <p className="es-ev-sponsor__label">Presented by</p>
      <div className="es-ev-sponsor__logo">
        {lead.linkUrl ? (
          <a
            href={lead.linkUrl}
            target="_blank"
            // `nofollow` with the rest, matching the full sponsor list below:
            // these are addresses an organizer typed, and this page should not
            // lend them its own standing.
            rel="noreferrer noopener nofollow"
            // A logo alone is announced as its alt text with no clue that it
            // leaves the site.
            aria-label={`${lead.name} — opens their website in a new tab`}
          >
            {mark}
          </a>
        ) : mark}
      </div>
      <p className="es-ev-sponsor__level">Official<br />sponsor</p>
    </aside>
  );
}
