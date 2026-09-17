import Accent from '../landing/Accent';

/**
 * The top of a marketing page: an eyebrow, the h1, and one paragraph.
 *
 * RESTYLED 2026-09-17 to the storefront: a white header with the homepage's
 * faint blue glow, the title in the sans at display size with its last word in
 * blue, and a hairline under it. Every static page opens the way /events does,
 * so a reader moving between them is visibly on the same site.
 *
 * A server component with no state — these pages are the ones a crawler reads.
 * The eyebrow is a `<p>`, not an `<h2>` above the `<h1>`: a heading level used
 * for size rather than structure scrambles the outline a screen reader reads.
 *
 * `centered` is for the short single-purpose pages (find my tickets).
 */
export default function PageHeader({ eyebrow, title, lede, children, centered = false }) {
  return (
    <section className={`es-mk-header fx-section fx-section--sm ${centered ? 'es-mk-header--center' : ''}`}>
      <div className="fx-container fx-container--xl">
        <div className="es-mk-header__inner">
          {eyebrow && <p className={`es-lp-kicker ${centered ? 'es-lp-kicker--center' : ''}`}>{eyebrow}</p>}
          <h1 className="es-ev-title"><Accent text={title} lastWord /></h1>
          {lede && <p className="es-lp-lede">{lede}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}
