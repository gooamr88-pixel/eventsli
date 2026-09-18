'use client';

import { formatMoney } from '../../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The seat picker's action bar: what is chosen, what it costs, and the way on.
 *
 * Split out of `SeatPicker.jsx` when that file crossed the project's 500-line
 * cap. The seam was already there — everything left behind is the map and the
 * state of what is chosen on it, and this only renders a selection it is
 * handed and calls back. It holds nothing of its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SelectionBar({
  count, subtotal, currency, label, seats = [], busy, onContinue, onRemoveSeat, onClear,
}) {
  return (
    /* Sticky to the bottom: on a phone the map fills the screen, so an action
       bar above it scrolls away the moment you start choosing. */
    <div className="es-seatbar fx-safe-bottom sticky bottom-0 z-(--es-z-sticky)">
      {/**
        * EVERY SEAT, NAMED, WITH A WAY OUT.
        *
        * The total alone used to be the whole of this bar, and taking a seat
        * back meant finding it again on the map and clicking it a second time —
        * on a two-hundred-seat plan, zoomed out, after picking six. The seat
        * you want to drop is the one you are least able to point at.
        *
        * Capped and scrolled rather than allowed to grow: this is fixed to the
        * bottom of the viewport, and ten seats listed in full would cover the
        * map they were chosen from.
        */}
      {seats.length > 0 && (
        <div className="fx-stack fx-stack--sm mb-3 border-b border-border-base pb-3">
          <div className="fx-row fx-row--between items-baseline">
            <p className="text-sm text-ink">
              Selected {seats.length === 1 ? 'seat' : 'seats'} ({seats.length})
            </p>
            <button type="button" onClick={onClear} disabled={busy} className="text-sm text-accent">
              Clear
            </button>
          </div>

          {/* `.es-seatbar__list` hides the native scrollbar, which on Android
              drew a hard grey slab down the right of the panel — the loudest
              thing on a screen whose job is to be quiet. It fades the last row
              instead, which says "there is more" without a widget. */}
          <ul className="es-seatbar__list fx-stack fx-stack--sm">
            {seats.map((seat) => (
              <li key={seat.id} className="es-seatbar__row">
                <span className="fx-min0 text-sm text-ink">{seatName(seat)}</span>
                <span className="fx-row shrink-0 items-center gap-2">
                  <span className="es-nums text-sm text-muted">
                    {/* An em dash beside a × read as a broken row. A seat whose
                        price comes from the tier says so. */}
                    {seat.priceCents === null || seat.priceCents === undefined
                      ? <span className="text-xs text-subtle">at checkout</span>
                      : formatMoney(seat.priceCents, currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveSeat(seat)}
                    disabled={busy}
                    aria-label={`Remove ${seatName(seat)}`}
                    // 28px painted, 44px to press (`.fx-hit`). This drops a
                    // seat from an order mid-purchase, so a mis-tap costs the
                    // buyer their seat — and the row is too tight to draw it
                    // any bigger without pushing the price off the line.
                    className="fx-hit grid h-7 w-7 place-items-center rounded-full text-subtle transition-colors hover:bg-bg-sunken hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          {count > 0 ? (
            <>
              {/* The money leads. This pair was 13px over 10.4px — the running
                  total of what you are about to spend, set two steps below the
                  venue address on the page before it. The subtotal is now the
                  larger of the two and the seat description supports it,
                  because the number is what a person checks before pressing
                  Continue. */}
              <p className="es-nums text-lg font-medium text-ink">
                {subtotal === null
                  ? 'Price at checkout'
                  : formatMoney(subtotal, currency)}
              </p>
              <p className="text-sm text-muted">
                {label || `${count} ${count === 1 ? 'seat' : 'seats'}`}
                {label && ` · ${count} seats`}
                {subtotal !== null && ' · before tax and fees'}
              </p>
            </>
          ) : (
            <p className="text-muted">Tap a seat to choose it</p>
          )}
        </div>

        <div className="fx-row">
          {count > 0 && (
            <button type="button" onClick={onClear} className="es-btn es-btn--ghost es-btn--sm">
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={count === 0 || busy}
            onClick={onContinue}
            /* `aria-busy` as well as `disabled`, and the label changes rather
               than being replaced by a spinner: a spinner alone announces
               nothing, and this is the control that spends money. */
            aria-busy={busy || undefined}
            className="es-btn es-btn--primary"
          >
            {busy ? 'Holding…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One seat, as a person reads it off a map.
 *
 * `row_label` is 'A' for every seat attached to a table, so repeating it next
 * to a section that is already the table's name reads as noise — the same rule
 * `TicketStub` applies to the printed ticket, so the seat is described
 * identically here, on the ticket, and at the door.
 */
function seatName(seat) {
  const { section, row, number } = seat;
  if (row && row !== 'A') return `${section} · row ${row} · seat ${number}`;
  return `${section} · seat ${number}`;
}

export function Legend() {
  return (
    /* Was `text-xs` — 10.4px on a phone. This is the key to the only piece of
       information on the screen that is carried by colour alone, so it is the
       last thing that should have been set at the smallest size in the app. */
    <ul className="fx-row fx-row--gap text-sm text-muted">
      <Swatch color="var(--es-seat-available)">Available</Swatch>
      <Swatch color="var(--es-seat-selected)">Selected</Swatch>
      <Swatch color="var(--es-seat-sold)">Taken</Swatch>
    </ul>
  );
}

function Swatch({ color, children }) {
  return (
    <li className="fx-row gap-2">
      <span
        className="inline-block size-3.5 rounded-full"
        style={{ background: color }}
      />
      {children}
    </li>
  );
}
