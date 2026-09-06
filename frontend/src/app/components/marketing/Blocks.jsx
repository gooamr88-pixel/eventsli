/**
 * The three shapes every marketing page on this site is made of.
 *
 * Server components, no state, no client bundle. Kept in one file because they
 * are only ever used together and three forty-line files would be three imports
 * to keep straight for no benefit.
 */

/** A titled band. `id` so the footer and the in-page links can aim at it. */
export function Band({ id, title, lede, children, flush }) {
  return (
    <section id={id} className={`fx-section fx-section--sm ${flush ? 'fx-section--flush-top' : ''}`}>
      <div className="fx-container fx-container--xl fx-stack">
        {title && <h2 className="text-xl">{title}</h2>}
        {lede && <p className="max-w-[58ch] text-muted">{lede}</p>}
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
    <ol className="fx-grid fx-grid--3">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-5"
        >
          <p className="font-mono text-sm text-accent">{String(i + 1).padStart(2, '0')}</p>
          <h3 className="text-md text-ink">{step.title}</h3>
          <p className="text-sm text-muted">{step.body}</p>
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
    <ul className={`fx-grid ${columns}`}>
      {points.map((point) => (
        <li
          key={point.title}
          className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-5"
        >
          <Heading className="text-md text-ink">{point.title}</Heading>
          <p className="text-sm text-muted">{point.body}</p>
          {point.detail && <p className="text-xs text-subtle">{point.detail}</p>}
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
          className="group rounded-[--es-radius-lg] border border-border-base bg-surface p-4"
        >
          <summary className="cursor-pointer list-none text-ink marker:content-['']">
            <span className="fx-row fx-row--between">
              <span className="fx-min0">{item.q}</span>
              <span aria-hidden className="text-subtle transition-transform group-open:rotate-45">+</span>
            </span>
          </summary>
          <p className="mt-3 max-w-[62ch] text-sm text-muted">{item.a}</p>
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
