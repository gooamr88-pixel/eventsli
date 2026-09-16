/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A ticket, drawn, for the guest band.
 *
 * WHY NOT `components/TicketStub`, which draws the real one. Because it takes a
 * `ticket` and a `qrSrc`, and the only way to put it on a marketing page is to
 * invent an order and point the QR at the admission-token endpoint. That is a
 * fabricated record rendered as a real one — and the image it would fetch is
 * the thing that opens a door.
 *
 * So this is a DRAWING. It carries no data, no QR code that scans, and it is
 * `aria-hidden` — the four claims in the band beside it are what actually say
 * what a guest gets. It is the same reasoning the seat map is shown under: the
 * picture illustrates a sentence, and where showing the real component would
 * mean faking real data, it gets drawn instead.
 *
 * The blocks in the "QR" are a fixed pattern, not random: a random one would
 * differ between the server render and the client hydration, which React treats
 * as a mismatch and logs as an error on the homepage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A fixed 7×7 pattern that reads as a QR without being one. */
const CODE = [
  '1110111', '1000101', '1011101', '1010001',
  '1011111', '1000100', '1111011',
];

export default function TicketPreview() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-[20rem]">
      <div className="es-plate bg-surface p-5">
        <div className="fx-stack fx-stack--sm">
          <p className="es-eyebrow">Your ticket</p>

          <p className="font-serif text-lg leading-snug text-ink">
            An evening on the waterfront
          </p>
          <p className="text-sm text-muted">Sat 12 Jun · 7:00 PM</p>

          {/* The tear line. A dashed border rather than two elements and a gap,
              so it stays put when the card's padding changes. */}
          <div className="my-1 border-t border-dashed border-border-base" />

          <div className="fx-row fx-row--between items-center">
            <div className="grid grid-cols-3 gap-3">
              {[['Section', 'A'], ['Row', '12'], ['Seat', '7']].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs uppercase tracking-[0.08em] text-subtle">{label}</p>
                  <p className="es-nums text-md font-medium text-ink">{value}</p>
                </div>
              ))}
            </div>

            <div
              className="grid shrink-0 gap-[2px] rounded-(--es-radius-sm) bg-white p-2"
              style={{ gridTemplateColumns: 'repeat(7, 4px)' }}
            >
              {CODE.flatMap((row, y) => (
                [...row].map((cell, x) => (
                  <span
                    key={`${y}-${x}`}
                    className={`block size-[4px] ${cell === '1' ? 'bg-ink' : 'bg-transparent'}`}
                  />
                ))
              ))}
            </div>
          </div>

          <span className="es-pill es-pill--accent mt-1 self-start">Admitted at the door</span>
        </div>
      </div>
    </div>
  );
}
