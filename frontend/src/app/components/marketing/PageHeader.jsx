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
    /* On the FIELD tone, up from sunken.
       Every marketing page's first `Band` is on the page tone, so the
       alternation that gives the homepage its rhythm holds on the smaller
       pages too without each of them having to arrange it. A page where the
       masthead and the first section share a ground has no visible start to
       its content.

       Sunken did that job correctly and quietly: it was 1.8 apart from the
       page tone, which is to say invisible, and every one of these pages
       therefore opened on the same flat sheet as the section under it. The
       field makes the masthead the thing it always claimed to be, and it
       matches the homepage — a reader arriving at /trust from / should be on
       the same site. */
    <section className="es-band--field fx-section fx-section--sm relative overflow-hidden">
      <div className="fx-container fx-container--xl fx-stack relative">
        {eyebrow && <p className="es-eyebrow text-accent">{eyebrow}</p>}
        <h1 className="max-w-[20ch] text-4xl">{title}</h1>
        {lede && <p className="max-w-[54ch] text-lg text-muted">{lede}</p>}
        {children}
      </div>
    </section>
  );
}
