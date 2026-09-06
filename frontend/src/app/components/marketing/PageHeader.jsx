/**
 * The top of a marketing page: an eyebrow, the h1, and one paragraph.
 *
 * A server component with no state — these pages are the ones a crawler reads,
 * and nothing up here needs the browser. The eyebrow is a `<p>`, not an `<h2>`
 * above the `<h1>`: a heading level used for size rather than structure is the
 * most common way an outline gets scrambled, and a screen reader reads the
 * outline.
 */
export default function PageHeader({ eyebrow, title, lede, children }) {
  return (
    /* On the SUNKEN tone, and every marketing page's first `Band` is on the
       page tone — so the alternation that gives the homepage its rhythm holds
       on the smaller pages too without each of them having to arrange it.
       A page where the masthead and the first section share a ground has no
       visible start to its content. */
    <section className="es-band--sunken fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        {eyebrow && <p className="es-eyebrow">{eyebrow}</p>}
        <h1 className="max-w-[20ch] text-4xl">{title}</h1>
        {lede && <p className="max-w-[54ch] text-lg text-muted">{lede}</p>}
        {children}
      </div>
    </section>
  );
}
