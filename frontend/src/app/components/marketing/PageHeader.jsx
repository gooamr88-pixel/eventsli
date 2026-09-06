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
    <section className="fx-section fx-section--sm">
      <div className="fx-container fx-container--xl fx-stack">
        {eyebrow && (
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-accent">{eyebrow}</p>
        )}
        <h1 className="max-w-[20ch] text-3xl">{title}</h1>
        {lede && <p className="max-w-[58ch] text-md text-muted">{lede}</p>}
        {children}
      </div>
    </section>
  );
}
