/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The listing, while the server is still fetching it.
 *
 * WHY THIS ROUTE AND NOT EVERY ROUTE. `loading.jsx` only buys anything where
 * the SERVER waits. `/events` awaits `Promise.all([events, categories])` before
 * it can render a byte, so a visitor clicking "Events" in the header sits on
 * the previous page until that round trip finishes — nothing acknowledges the
 * click. Every organizer and admin route is the opposite shape: a `'use client'`
 * layout and page that mount instantly and fetch in an effect, showing their own
 * `<Loading>` skeleton. Adding one there would put a second skeleton in front of
 * the first for one frame, which is the duplication this file's existence is
 * supposed to avoid.
 *
 * NO REAL TEXT IN THIS FALLBACK, and that is the second version of it.
 *
 * The first drew the kicker, the heading and the lede for real — they do not
 * depend on the fetch, so standing in for known text looked like waste. Then
 * the running server showed what Next actually does: `/events/saved` is a
 * nested segment with no layout of its own, so it resolves to THIS boundary,
 * and the response carried two `<h1>`s — "Find your next event" flushed first,
 * "Saved events" swapped in after. Somebody opening their saved list saw the
 * listing's headline first.
 *
 * A skeleton heading on `/events` is slightly less informative. A WRONG
 * heading on `/events/saved` is misleading, and misleading loses.
 *
 * A `loading.jsx` under `saved/` was tried first and does NOT fix it: on a
 * fresh load the OUTER boundary is the one that flushes. Verified against the
 * server, then removed rather than left in place looking like it helped.
 *
 * The structure still mirrors `page.jsx` band for band — `.es-ev-hero` then
 * `.es-band`, both `fx-section--sm`, inside `.fx-container--xl` — so the
 * arrival swaps the cards in place instead of moving the page.
 *
 * `.es-skeleton` collapses to a static grey block under
 * `prefers-reduced-motion` (the global block in `globals.css` zeroes the
 * duration), so the shape survives and the movement does not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventsLoading() {
  return (
    <main>
      <section className="es-ev-hero fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          {/* The kicker, the headline and the lede, as blocks that suit either
              this page's hero or the saved list's page header. */}
          <div aria-hidden="true" className="es-ev-hero__head fx-stack fx-stack--sm">
            <span className="es-skeleton es-skeleton--line w-40" />
            <span className="es-skeleton h-10 w-3/4 max-w-lg" />
            <span className="es-skeleton es-skeleton--text w-2/3" />
          </div>

          {/* The search box and the category rail are the same height as the
              real ones, so the band does not change depth when they arrive. */}
          <div aria-hidden="true" className="fx-stack fx-stack--sm">
            <span className="es-skeleton h-12 w-full rounded-(--es-radius-lg)" />
            <div className="fx-row fx-row--scroll gap-2">
              <span className="es-skeleton h-8 w-24 rounded-(--es-radius-full)" />
              <span className="es-skeleton h-8 w-20 rounded-(--es-radius-full)" />
              <span className="es-skeleton h-8 w-28 rounded-(--es-radius-full)" />
              <span className="es-skeleton h-8 w-16 rounded-(--es-radius-full)" />
            </div>
          </div>
        </div>
      </section>

      <section className="es-band fx-section fx-section--sm">
        <div className="fx-container fx-container--xl">
          {/* One announcement for the whole region. Nine cards' worth of empty
              divs read aloud is noise, which is why the blocks are hidden and
              the status lives here. */}
          <div role="status" aria-live="polite" aria-label="Loading events">
            <ul aria-hidden="true" className="es-ev-results">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  <div className="fx-stack fx-stack--sm">
                    {/* The cover's aspect ratio, not a fixed height — the real
                        card's image box is ratio-driven, so a px height here
                        would shift the grid at exactly one viewport. */}
                    <span className="es-skeleton aspect-[3/2] w-full rounded-(--es-radius-lg)" />
                    <span className="es-skeleton es-skeleton--text w-4/5" />
                    <span className="es-skeleton es-skeleton--line w-2/5" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
