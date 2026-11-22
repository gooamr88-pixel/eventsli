import NavIcon from '../../../components/shell/NavIcon';
import { formatMoney } from '../../../utils/money';
import Stepper from './Stepper';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "MAKE IT SPECIAL" — the event's add-ons, drawn the same way wherever they
 * are chosen: beside the tickets before checkout (owner, 2026-11-22), and on
 * the checkout for a seated order, whose seat page has no room for them.
 *
 * Presentation only. `rows` are `{ id, name, description, priceCents,
 * imageUrl, mine, ceiling, soldOut, off, note }`; the caller decides the
 * limits (one per ticket, the organizer's stock) and what a tap does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ExtrasList({
  rows, currency, organizerName, tickets, disabled, busyId = null, onSet, lockedHint = null, headingId = 'book-extras',
}) {
  if (rows.length === 0) return null;
  return (
    <section className={`es-extras ${lockedHint ? 'is-locked' : ''}`} aria-labelledby={headingId}>
      <div className="es-extras__head">
        <span className="es-extras__icon" aria-hidden="true"><NavIcon name="sparkle" size={20} /></span>
        <div className="fx-min0">
          <h3 id={headingId} className="es-extras__title">Make it special</h3>
          <p className="es-extras__sub">
            {lockedHint || `Optional extras · up to one per ticket${tickets ? ` (${tickets} on this order)` : ''}`}
          </p>
        </div>
      </div>

      <ul className="es-extras__list">
        {rows.map((a) => {
          const free = Number(a.priceCents) === 0;
          return (
            <li key={a.id} className={`es-extra ${a.mine > 0 ? 'is-on' : ''}`}>
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the add-on's picture, straight from storage
                <img src={a.imageUrl} alt="" className="es-extra__img" loading="lazy" decoding="async" />
              ) : (
                <span className="es-extra__img es-extra__img--blank" aria-hidden="true"><NavIcon name="star" size={22} /></span>
              )}
              <div className="es-extra__body fx-min0">
                <p className="es-extra__name fx-break">{a.name}</p>
                {a.description && <p className="es-extra__desc">{a.description}</p>}
                <p className="es-extra__price es-nums">
                  {free ? 'Free' : <>+ {formatMoney(a.priceCents, currency)}<span> each</span></>}
                  {a.note && <em> · {a.note}</em>}
                </p>
              </div>
              {a.soldOut ? (
                <span className="es-book-tier__off">Sold out</span>
              ) : (
                <Stepper
                  value={a.mine}
                  name={a.name}
                  working={busyId === a.id}
                  onMinus={() => onSet(a.id, a.mine - 1)}
                  onPlus={() => onSet(a.id, a.mine + 1)}
                  minusDisabled={disabled || Boolean(busyId) || a.mine === 0}
                  plusDisabled={disabled || Boolean(busyId) || a.off || a.mine >= a.ceiling}
                  plusTitle={a.mine >= a.ceiling && !a.off ? 'One per ticket on this order' : undefined}
                />
              )}
            </li>
          );
        })}
      </ul>

      <p className="es-extras__note">
        <NavIcon name="info" size={15} />
        <span>
          Provided at the event by {organizerName || 'the organizer'}, who alone is responsible for delivering
          them. Eventsli only takes the payment.
        </span>
      </p>
    </section>
  );
}
