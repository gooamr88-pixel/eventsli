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
      className={`${TONES[tone] || TONES.base} fx-section fx-section--sm ${flush ? 'fx-section--flush-top' : ''}`}
    >
      <div className="fx-container fx-container--xl fx-stack">
        {title && <h2 className="text-2xl">{title}</h2>}
        {lede && <p className="max-w-[58ch] text-lg text-muted">{lede}</p>}
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
    /* RULED ROWS, not a grid of cards.
       Every band on every marketing page used to be the same object: a
       heading over three or four bordered rectangles. Steps looked like
       Points looked like the FAQ, so four pages read as one template with
       the words swapped — which is most of what "every page looks the same"
       was, and none of it was a colour problem.

       A sequence is the one thing here that genuinely has an order, so it
       gets the shape that shows one: rows sharing hairlines, reading top to
       bottom. Boxes side by side say "these three are alternatives". */
    <ol className="min-w-0">
      {steps.map((step, i) => (
        <li key={step.title} className="es-marquee__row">
          <span className="es-marquee__index" aria-hidden>
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="fx-stack fx-stack--sm">
            {/* The number is decorative for a sighted reader — the visual
                order carries it — but it is still real content for a screen
                reader, which is why the `<ol>` does the work and the span is
                aria-hidden rather than the other way round. */}
            <h3 className="text-lg">{step.title}</h3>
            <p className="text-muted">{step.body}</p>
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
    /* Claims, not cards — see the note on Steps. A short accent rule does
       the separating a border was doing, without drawing a box around a
       sentence, and it is the one place the brand colour appears in the
       body of a marketing page. */
    <ul className={`fx-grid ${columns} fx-grid--gap-lg`}>
      {points.map((point) => (
        <li key={point.title} className="fx-stack fx-stack--sm">
          <span aria-hidden className="block h-[3px] w-8 rounded-full bg-accent" />
          <Heading className="text-lg">{point.title}</Heading>
          <p className="text-muted">{point.body}</p>
          {point.detail && <p className="text-sm text-subtle">{point.detail}</p>}
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
    <div className="fx-stack fx-stack--sm">
      {items.map((item) => (
        <details
          key={item.q}
          className="es-card group p-5"
        >
          {/* `fx-touch` on the summary: a question is a tap target, and its
              line box on a phone is about 24px. */}
          <summary className="fx-touch w-full cursor-pointer list-none text-ink marker:content-['']">
            <span className="fx-row fx-row--between w-full">
              <span className="fx-min0 font-medium">{item.q}</span>
              <span aria-hidden className="text-xl text-subtle transition-transform group-open:rotate-45">+</span>
            </span>
          </summary>
          <p className="mt-3 max-w-[62ch] text-muted">{item.a}</p>
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
