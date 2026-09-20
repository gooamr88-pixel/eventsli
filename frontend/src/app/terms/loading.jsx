import { Loading } from '../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The legal documents, while the server fetches them.
 *
 * `/terms` and `/terms/organizer` are `dynamic = 'force-dynamic'` ON PURPOSE —
 * `AGENTS.md` argues it: they were `revalidate = 3600` and a failed fetch baked
 * "We could not load the terms just now" into the cache for an hour, on a
 * document sitting behind a REQUIRED checkbox at checkout. Being always-dynamic
 * is the right call, and it also means every visit pays a round trip, which is
 * exactly the case a loading boundary is for.
 *
 * ONE FILE COVERS BOTH ROUTES, WHICH IS WHY NO TITLE IS WRITTEN HERE.
 * `/terms/organizer` is a nested segment, so it resolves to this boundary. The
 * first version of this file rendered `/terms`' real header — "Ticket terms" —
 * and an organizer opening the agreement from the submit-for-review checkbox
 * would have seen the wrong document named before the right one arrived. On a
 * legal page reached from a consent checkbox that is the worst possible place
 * for a heading that is not true yet. (The same mistake, and the same fix, as
 * `events/loading.jsx`.)
 *
 * The eyebrow stays real because it is the ONE string both pages share.
 *
 * The header band mirrors `PageHeader`'s markup rather than calling it: that
 * component takes `title` as a string and runs it through `<Accent>`, so there
 * is no way to hand it a placeholder. The classes are copied, the structure is
 * identical, and nothing about the band moves when the real header replaces it.
 *
 * Only the document body is genuinely unknown, and `Loading variant="text"` is
 * the primitive that already draws a page of prose — reused rather than
 * re-drawn, because a second hand-rolled paragraph skeleton is how the
 * twenty-four `Loading…` surfaces happened in the first place.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TermsLoading() {
  return (
    <main className="es-mk">
      <section className="es-mk-header fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          <div className="es-mk-header__inner">
            <p className="es-lp-kicker">Legal</p>
            <div aria-hidden="true" className="fx-stack fx-stack--sm">
              <span className="es-skeleton h-10 w-3/5 max-w-md" />
              <span className="es-skeleton es-skeleton--text w-4/5 max-w-xl" />
            </div>
          </div>
        </div>
      </section>

      <div className="fx-section fx-section--sm">
        <article className="es-mk-doc fx-stack">
          <Loading variant="text" rows={14} label="Loading the document" />
        </article>
      </div>
    </main>
  );
}
