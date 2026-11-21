import Link from 'next/link';
import NavIcon from '../../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Innovate. Present. Connect." — the vendor invitation (owner's reference,
 * 2026-11-21), on the event page and at the top of /e/<slug>/vendors.
 *
 *   a headline with one word on a yellow highlight, a line under it,
 *   a fanned stack of up to three photos, a card of big numbers,
 *   and two buttons: "Become a vendor" and "Reserve your booth".
 *
 * THE NUMBERS ARE THE ORGANIZER'S, never ours. The reference shows "80% of
 * exhibitors…"; a figure we made up would be a claim about somebody else's
 * event. With no highlights set, the card shows facts we do know — how many
 * kinds of booth, how many spaces are left, the lowest price.
 *
 * Yellow is a fill, never text (brand rule, globals.css): the highlighted
 * word sits on a yellow marker and the numbers are ink with a yellow bar.
 * An organizer headline can mark its own word with *asterisks*.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VendorShowcase({
  headline = null, intro = null, photos = [], highlights = [], facts = [],
  primary = null, secondary = null, as: Heading = 'h2', id = undefined,
}) {
  const stats = highlights.length ? highlights : facts;
  return (
    <section className="es-vb-show" aria-labelledby={id}>
      <div className="es-vb-show__head">
        <Heading id={id} className="es-vb-show__title"><Headline text={headline} /></Heading>
        <p className="es-vb-show__lede">
          {intro || 'Explore unique vendors, delicious bites and creative brands — all in one vibrant space that celebrates community and originality.'}
        </p>
      </div>

      <div className="es-vb-show__body">
        <PhotoStack photos={photos} />
        <div className="es-vb-show__side">
          {stats.length > 0 && (
            <dl className="es-vb-stats">
              {stats.map((s) => (
                <div key={`${s.value}-${s.label}`} className="es-vb-stats__row">
                  <dt className="es-vb-stats__value es-nums">{s.value}</dt>
                  <dd className="es-vb-stats__label">{s.label}</dd>
                </div>
              ))}
            </dl>
          )}
          {(primary || secondary) && (
            <div className="es-vb-show__actions">
              {secondary && <ActionLink {...secondary} className="es-vb-btn es-vb-btn--outline" />}
              {primary && <ActionLink {...primary} className="es-vb-btn es-vb-btn--sun" />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ActionLink({ href, label, icon, className }) {
  const inner = <>{icon && <NavIcon name={icon} size={20} />}{label}</>;
  return href.startsWith('#') ? <a href={href} className={className}>{inner}</a> : <Link href={href} className={className}>{inner}</Link>;
}

/** "Sell at *our* market" → the starred word on the marker; no stars → the reference's three words. */
function Headline({ text }) {
  if (!text) {
    return <>Innovate. <mark className="es-vb-mark">Present.</mark> Connect.</>;
  }
  const parts = String(text).split(/\*([^*]+)\*/g);
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="es-vb-mark">{p}</mark> : <span key={i}>{p}</span>));
}

/** Up to three photos, fanned like prints on a table; a drawn card when there are none. */
function PhotoStack({ photos }) {
  const list = photos.filter(Boolean).slice(0, 3);
  if (!list.length) {
    return (
      <div className="es-vb-stack es-vb-stack--empty" aria-hidden="true">
        <span className="es-vb-stack__card es-vb-stack__card--back" />
        <span className="es-vb-stack__card es-vb-stack__card--mid" />
        <span className="es-vb-stack__card es-vb-stack__card--front es-vb-stack__art">
          <NavIcon name="store" size={56} />
        </span>
      </div>
    );
  }
  const order = list.length === 1 ? ['front'] : list.length === 2 ? ['back', 'front'] : ['back', 'mid', 'front'];
  return (
    <div className="es-vb-stack" aria-hidden="true">
      {/* Painted back to front: the first photo is the one on top. */}
      {[...list].reverse().map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- the organizer's photos, from storage
        <img key={src} src={src} alt="" className={`es-vb-stack__card es-vb-stack__card--${order[i]}`} />
      ))}
    </div>
  );
}
