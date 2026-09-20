/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The ticket, while the server resolves the token.
 *
 * `/t/[token]` is opened from an email, from a phone wallet, and at the door
 * with a queue behind you. It fetches the ticket on the server before it can
 * render, and the perceived wait matters more here than anywhere else in the
 * product — somebody is holding a phone up to a scanner.
 *
 * The stub keeps its real proportions: a square for the QR and the same
 * `fx-container--sm` column the page uses, so the code lands where the grey box
 * was rather than pushing the page down as it arrives.
 *
 * NO RETRY OR ERROR WORDING HERE. A boundary that renders while a fetch is in
 * flight must not imply anything about how it ends — a bad token is a 404 and
 * `not-found.jsx` says so.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TicketLoading() {
  return (
    <main className="es-ticket-page fx-section fx-section--sm">
      <div className="fx-container fx-container--sm fx-stack">
        <div role="status" aria-live="polite" aria-label="Loading your ticket">
          <div aria-hidden="true" className="fx-stack">
            {/* "Your ticket", the event title, then when and where. */}
            <div className="fx-stack fx-stack--sm">
              <span className="es-skeleton es-skeleton--line w-24" />
              <span className="es-skeleton h-7 w-3/5" />
              <span className="es-skeleton es-skeleton--text w-2/5" />
            </div>

            {/* The stub. The QR is square at every width, so the placeholder is
                too — a rectangle here would resize the card on arrival. */}
            <div className="fx-stack fx-stack--sm items-center rounded-(--es-radius-lg) border border-border-base p-6">
              <span className="es-skeleton aspect-square w-48 rounded-(--es-radius-md)" />
              <span className="es-skeleton es-skeleton--line w-32" />
              <span className="es-skeleton es-skeleton--line w-24" />
            </div>

            <span className="es-skeleton es-skeleton--line mx-auto w-2/3" />
          </div>
        </div>
      </div>
    </main>
  );
}
