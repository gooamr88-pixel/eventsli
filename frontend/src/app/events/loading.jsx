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
 * The structure mirrors `page.jsx`: the sidebar card, then the card grid,
 * so the arrival swaps the content in place instead of moving the page.
 *
 * `.es-skeleton` collapses to a static grey block under
 * `prefers-reduced-motion` (the global block in `globals.css` zeroes the
 * duration), so the shape survives and the movement does not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventsLoading() {
  // Mirrors page.jsx (2026-11-19 layout): the sidebar card, then the grid of
  // poster cards, so the arrival swaps the content in place.
  return (
    <main className="es-evx">
      <div className="es-evx__layout">
        <div aria-hidden="true" className="es-evx-side">
          <span className="es-skeleton h-14 w-full rounded-[10px]" />
          <span className="es-skeleton es-skeleton--line mt-10 w-1/2" />
          <span className="es-skeleton mt-4 h-14 w-full rounded-[10px]" />
          <span className="es-skeleton es-skeleton--line mt-10 w-1/3 max-lg:hidden" />
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="es-skeleton es-skeleton--line mt-4 w-2/5 max-lg:hidden" />
          ))}
        </div>

        {/* One announcement for the whole region; the blocks are hidden. */}
        <div role="status" aria-live="polite" aria-label="Loading events">
          <ul aria-hidden="true" className="es-evx__grid">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <div className="es-evx-card">
                  <span className="es-skeleton aspect-[16/9] w-full rounded-[8px]" />
                  <span className="es-skeleton es-skeleton--text mt-6 w-4/5" />
                  <span className="es-skeleton es-skeleton--line mt-5 w-1/2" />
                  <span className="es-skeleton es-skeleton--line mt-3 w-3/4" />
                  <span className="es-skeleton mt-6 h-12 w-48 rounded-[6px]" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
