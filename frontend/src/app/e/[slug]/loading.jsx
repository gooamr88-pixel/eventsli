/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event page, while the server fetches it.
 *
 * This is the most-travelled server navigation in the product: every card on
 * the homepage and the listing lands here, and `page.jsx` awaits
 * `/public/events/:slug` before it can render anything. Without a boundary the
 * previous page simply sits there for the length of that round trip.
 *
 * IT COVERS `/seats` AND `/tickets` TOO, because they are nested segments and
 * this is the closest `loading.jsx` above them — both also fetch the event on
 * the server. That is why the shape below stops at the hero: it is the one
 * band all three routes share, so it stands in for any of them without
 * promising a layout that two of them do not have.
 *
 * `/e/[slug]/seats` additionally wraps its map in its own
 * `<Suspense fallback={<SeatMapSkeleton />}>` inside `page.jsx`. That boundary
 * is finer-grained than this one and already correct — this file does not
 * replace it and must not be extended to imitate it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventLoading() {
  return (
    <main>
      <div className="fx-gutter">
        <div className="es-ev-page fx-stack">
          <div role="status" aria-live="polite" aria-label="Loading this event">
            <div aria-hidden="true" className="fx-stack">
              {/* The cover. A ratio rather than a height, matching the real
                  hero, so the fold does not move when the image arrives. */}
              <span className="es-skeleton aspect-[16/9] w-full rounded-(--es-radius-lg)" />

              {/* Kicker, title, then the date-and-venue line. Uneven widths:
                  a stack of equal bars reads as a loading graphic rather than
                  as text that has not arrived. */}
              <div className="fx-stack fx-stack--sm">
                <span className="es-skeleton es-skeleton--line w-24" />
                <span className="es-skeleton h-9 w-3/4" />
                <span className="es-skeleton es-skeleton--text w-1/2" />
              </div>

              {/* The facts strip and the primary call to action. */}
              <div className="fx-row gap-3">
                <span className="es-skeleton h-11 w-40 rounded-(--es-radius-md)" />
                <span className="es-skeleton h-11 w-32 rounded-(--es-radius-md)" />
              </div>

              <div className="fx-stack fx-stack--sm">
                <span className="es-skeleton es-skeleton--line w-full" />
                <span className="es-skeleton es-skeleton--line w-full" />
                <span className="es-skeleton es-skeleton--line w-3/5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
