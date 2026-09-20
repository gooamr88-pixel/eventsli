/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The checkout, while the server hands over.
 *
 * It covers `/checkout/[reservationId]` and `/checkout/success`, and neither
 * page fetches anything on the server — so this is not standing in for a slow
 * query. It is standing in for the ROUND TRIP, which this app always pays:
 * `dynamic = 'force-dynamic'` in the root layout means there is no prerendered
 * payload for the router to swap in, so without a boundary the previous screen
 * simply sits there while the RSC response is fetched.
 *
 * Which previous screen that is, is the whole argument for this file. The seat
 * map pushes here the instant a hold succeeds, and the hold is the moment those
 * seats came off sale for everybody else. Leaving the map on screen with a
 * spent button is the one place in the product where "nothing happened yet"
 * and "it worked, wait" look identical — and a buyer who reads it as the first
 * presses again.
 *
 * THE SHAPE IS THE HOLD PANEL, not the form. `HoldConfirm` is what actually
 * renders first on `/checkout/[id]`, and `/checkout/success` opens with the
 * same centred mark-and-headline block, so one skeleton is honest for both.
 * Promising the order summary and three cards would be a layout that moves
 * twice before it settles.
 *
 * No countdown figure and no amount, not even as a placeholder: every number
 * on this journey comes from the server's quote, and a checkout that shows an
 * invented one for half a second has told the buyer something untrue about
 * money. Bars only.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CheckoutLoading() {
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--sm">
        <div role="status" aria-live="polite" aria-label="Opening your checkout">
          <div aria-hidden="true" className="es-plate fx-stack items-center bg-surface p-6">
            {/* The ring. A circle at the size `HoldConfirm` draws one, so the
                countdown does not arrive and shove the page down. */}
            <span className="es-skeleton size-28 rounded-full" />

            {/* Event, then when and where — the three lines under the ring. */}
            <div className="fx-stack fx-stack--sm w-full items-center gap-2">
              <span className="es-skeleton es-skeleton--text w-3/5" />
              <span className="es-skeleton es-skeleton--line w-2/5" />
              <span className="es-skeleton es-skeleton--line w-1/3" />
            </div>

            {/* The action. Full width and at the real button's height, because
                it is the thing a thumb is already on the way to. */}
            <span className="es-skeleton h-12 w-full rounded-(--es-radius-md)" />
          </div>
        </div>
      </div>
    </main>
  );
}
