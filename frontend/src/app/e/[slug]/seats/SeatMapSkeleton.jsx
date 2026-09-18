/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SEAT MAP'S BOX, AND WHAT STANDS IN IT WHILE THE MAP IS COMING.
 *
 * THE FRAME IS EXPORTED, and that is the whole point of this file.
 *
 * Three places draw this box: the loaded map in `SeatPicker`, the skeleton
 * `SeatPicker` shows while it fetches, and the `<Suspense>` fallback on the
 * page above it. When those three disagree by even one class, the map does not
 * fade in — the frame REDRAWS, and that is exactly the bug this replaced: the
 * waiting state was a 420px sunken box with a small white card floating in the
 * middle of it, against a loaded state that was a white plate with padding at
 * `58vh`. Arrival changed the ground colour, gained a border, gained padding
 * and jumped height in a single paint.
 *
 * Writing the classes in one place is what makes that non-recurring. Edit the
 * frame and every state moves together, because there is only one of them.
 *
 * `es-plate bg-surface` outside and a sunken box inside is not decoration: the
 * floor of the room has to be the lightest thing on screen, because every seat
 * colour was chosen to sit on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The white plate the map sits on. */
export const MAP_FRAME = 'es-plate bg-surface p-3 sm:p-4';

/**
 * The canvas box inside it. `58vh` rather than a fixed height so the map gets
 * more room on a laptop than on a phone, with a floor so it never collapses on
 * a short landscape screen.
 */
export const MAP_BOX = 'h-[58vh] min-h-[380px]';

/**
 * The waiting state.
 *
 * `.es-skeleton` brings the sunken ground and the sweep; the radius utility
 * after it restores the canvas's own larger corner, which wins because
 * utilities sit in a later cascade layer than components.
 *
 * `role="status"` with the label on the box: `.es-skeleton` sets
 * `pointer-events: none` and holds no text, so without a label a screen reader
 * announces nothing at all while the map loads.
 */
export default function SeatMapSkeleton({ label = 'Loading the seat map' }) {
  return (
    <div className={MAP_FRAME}>
      <div
        role="status"
        aria-label={label}
        className={`es-skeleton es-map-skeleton w-full rounded-(--es-radius-lg) border border-border-base ${MAP_BOX}`}
      >
        {/* THE SHAPE OF WHAT IS COMING, not a grey rectangle. A blank panel
            for two seconds says only that something is missing; a room with
            tables in it says what is being waited for, and the real map then
            fills a picture the reader has already begun reading.

            `aria-hidden`: the label on the box above is the whole accessible
            answer. These are furniture, and announcing four empty divs
            between "Choose your seats" and the map is noise. */}
        <div aria-hidden className="es-map-skeleton__tables">
          <span className="es-map-skeleton__table" />
          <span className="es-map-skeleton__table" />
          <span className="es-map-skeleton__table" />
        </div>
        <span aria-hidden className="es-map-skeleton__bar" />
      </div>
    </div>
  );
}
