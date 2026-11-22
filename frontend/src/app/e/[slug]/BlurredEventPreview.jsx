/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A PRIVATE EVENT'S PAGE, BLURRED (2026-11-22, the owner: "blur all details
 * and images of a private event until it is unlocked").
 *
 * The shape of the real event page — the cover across the top, the title, the
 * facts row, the description, the ticket box, the photos — drawn behind the
 * password card and blurred, so a guest sees there is an event waiting
 * without being able to read any of it.
 *
 * EVERY WORD HERE IS A PLACEHOLDER BAR, NOT THE EVENT'S TEXT. A CSS blur over
 * real text is undone by the browser's inspector in a second, so the real
 * details are never sent to a locked visitor at all (eventAccess.lockedTeaser).
 * The one picture is a 24-pixel copy of the cover made by the API, or the
 * cover itself where the organizer chose to show it.
 *
 * Decorative throughout: hidden from screen readers, untouchable, unfocusable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BlurredEventPreview({ coverSrc = null }) {
  return (
    <div className="es-pblur" aria-hidden="true" inert>
      <div className="es-pblur__cover">
        {coverSrc
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={coverSrc} alt="" />
          : <span className="es-pblur__wash" />}
      </div>
      <div className="es-pblur__page">
        <div className="es-pblur__head">
          <span className="es-pblur__bar es-pblur__bar--title" />
          <span className="es-pblur__bar es-pblur__bar--title es-pblur__bar--short" />
          <div className="es-pblur__facts">
            {[0, 1, 2, 3].map((i) => <span key={i} className="es-pblur__chip" />)}
          </div>
        </div>
        <div className="es-pblur__cols">
          <div className="es-pblur__main">
            {[96, 88, 92, 70, 84, 60].map((w, i) => (
              <span key={i} className="es-pblur__bar" style={{ width: `${w}%` }} />
            ))}
            <div className="es-pblur__gallery">
              {[0, 1, 2].map((i) => <span key={i} className="es-pblur__tile" />)}
            </div>
          </div>
          <div className="es-pblur__aside">
            <span className="es-pblur__bar es-pblur__bar--short" />
            {[0, 1, 2].map((i) => <span key={i} className="es-pblur__ticket" />)}
            <span className="es-pblur__button" />
          </div>
        </div>
      </div>
    </div>
  );
}
