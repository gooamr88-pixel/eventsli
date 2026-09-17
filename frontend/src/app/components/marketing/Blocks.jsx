import Accent from '../landing/Accent';

/**
 * The three shapes every marketing page on this site is made of.
 *
 * Server components, no state, no client bundle. Kept in one file because they
 * are only ever used together and three forty-line files would be three imports
 * to keep straight for no benefit.
 */

/**
 * A titled band. `id` so the footer and the in-page links can aim at it.
 *
 * `tone` is what gives a long marketing page its rhythm, and the ONLY rule is
 * that consecutive bands do not share one. The default is the page tone, so a
 * page alternates by passing `tone="sunken"` on every second band — visible by
 * reading the page file rather than by scrolling the rendered page.
 *
 * `ink` is for a closing call to action and there should be at most one per
 * page: two dark blocks and neither of them is the end.
 */
const TONES = {
  base: 'es-band',
  sunken: 'es-band--sunken',
  ink: 'es-band--ink',
  field: 'es-band--field',
};

export function Band({ id, title, lede, children, flush, tone = 'base' }) {
  return (
    <section
      id={id}
      className={`${TONES[tone] || TONES.base} fx-section fx-section--sm ${flush ? 'fx-section--flush-top es-mk-band--first' : ''}`}
    >
      <div className="fx-container fx-container--xl fx-stack">
        {(title || lede) && (
          <div>
            {title && <h2 className="es-lp-title"><Accent text={title} lastWord /></h2>}
            {lede && <p className="es-lp-lede">{lede}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/**
 * Numbered steps.
 *
 * An ordered list, because the order is the meaning — a `<div>` soup with a
 * styled number in it says "1" to a sighted reader and nothing at all to a
 * screen reader. The visible number comes from the data rather than a CSS
 * counter so it can be read aloud too.
 */
export function Steps({ steps }) {
  return (
    /* RESTYLED 2026-09-17. Numbered cards, three across on a desktop; on a
       phone a compact timeline — the number on a line down the left and the
       words beside it — because six stacked cards were three screens of
       scrolling for six sentences. */
    <ol className="es-mk-steps">
      {steps.map((step, i) => (
        <li key={step.title} className="es-mk-step">
          {/* The number is decorative for a sighted reader — the visual order
              carries it — and the `<ol>` says it to a screen reader. */}
          <span className="es-mk-step__n" aria-hidden>{i + 1}</span>
          <div className="es-mk-step__body">
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * A grid of claims. Each one has to map to behaviour that exists — see the note
 * at the top of why-us.
 *
 * `headingLevel` is the caller's, for the same reason it is on EventCard: a
 * grid sitting under a titled `Band` is one level deeper than a grid sitting
 * directly under the page's `<h1>`. Lighthouse caught the second case on
 * /why-us — an `<h3>` with no `<h2>` above it, which a screen reader reads as a
 * section that was missed.
 */
export function Points({ points, columns = 'fx-grid--3', headingLevel = 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    /* RESTYLED 2026-09-17: white cards with a blue tick, in a grid on a
       desktop and one swipeable row on a phone (see .es-lp-rail) — /trust has
       four groups of these, and stacked they were most of the page's length.
       `columns` is kept for callers and only nudges the desktop width. */
    <ul className={`es-mk-points es-lp-rail ${columns === 'fx-grid--2' ? 'es-mk-points--wide' : ''}`}>
      {points.map((point) => (
        <li key={point.title} className="es-mk-point">
          <span aria-hidden className="es-mk-point__mark">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </span>
          <Heading className="es-mk-point__title">{point.title}</Heading>
          <p className="es-mk-point__body">{point.body}</p>
          {point.detail && <p className="es-mk-point__detail">{point.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Questions and answers.
 *
 * `<details>`, not a JavaScript accordion. It opens with no hydration, it is
 * keyboard operable and announced correctly for free, and — the reason that
 * matters here — a crawler reads the answer whether or not it is open. An
 * accordion that mounts its content on click is content a crawler never sees.
 */
export function Faq({ items }) {
  return (
    /* One card with hairlines between the questions, not a stack of cards:
       a list of questions is one object, and ten bordered boxes read as ten. */
    <div className="es-mk-faq">
      {items.map((item) => (
        <details key={item.q} className="es-mk-faq__item group">
          <summary className="es-mk-faq__q">
            <span className="fx-min0">{item.q}</span>
            <span aria-hidden className="es-mk-faq__icon">+</span>
          </summary>
          <p className="es-mk-faq__a">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

/**
 * FAQPage structured data for the same items.
 *
 * Honest caveat, because it belongs next to the code: since 2023 Google shows
 * FAQ rich results only for a narrow set of authoritative sites, so this will
 * probably not draw an expandable result. It is still correct, still parsed,
 * and still what an answer engine reads — and it is built from the SAME array
 * the page renders, so the two cannot drift.
 */
export function FaqJsonLd({ items }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
