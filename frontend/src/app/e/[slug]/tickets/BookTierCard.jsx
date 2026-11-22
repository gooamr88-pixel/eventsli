import NavIcon from '../../../components/shell/NavIcon';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import Stepper from './Stepper';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE TICKET TYPE, WITH EVERYTHING ABOUT IT ON THE CARD (owner, 2026-11-22).
 *
 * The "What's included" chip and the sheet it opened are gone: the owner's
 * reference shows the ticket's details as a checklist right under its name,
 * with the quantity under that. A buyer reads what they get and picks how
 * many in one place, without opening anything.
 *
 * The price is the type's own `priceCents`, formatted only. Every real total
 * comes from the quote after the hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const UNIT = { person: 'per person', table: 'per table', group: 'per group' };
const KIND = { vip: ['crown', 'VIP'], early_bird: ['clock', 'Early bird'], complimentary: ['star', 'Guest list'] };

export default function BookTierCard({
  tier, currency, timeZone, count, blocked, busy, focused, onPlus, onMinus,
}) {
  const d = tier.details || {};
  const included = d.included || [];
  const notes = d.notes || [];
  const about = d.tagline || tier.description;
  const unavailable = tier.soldOut || tier.onSale === false;
  const kind = KIND[tier.kind];
  const free = Number(tier.priceCents) === 0;

  return (
    <li className={`es-book-tier ${count > 0 ? 'is-on' : ''} ${unavailable ? 'is-off' : ''} ${focused ? 'is-focus' : ''}`}>
      {d.image?.url && (
        // eslint-disable-next-line @next/next/no-img-element -- the organizer's photo, straight from storage
        <img src={d.image.url} alt="" className="es-book-tier__photo" loading="lazy" decoding="async" />
      )}

      <div className="es-book-tier__head">
        <div className="fx-min0">
          {(kind || focused) && (
            <p className="es-book-tier__tags">
              {kind && <span className="es-book-tag"><NavIcon name={kind[0]} size={13} />{kind[1]}</span>}
              {focused && <span className="es-book-tag es-book-tag--link"><NavIcon name="tag" size={13} />Your link</span>}
            </p>
          )}
          <h3 className="es-book-tier__name fx-break">{tier.name}</h3>
          {about && <p className="es-book-tier__about fx-break">{about}</p>}
        </div>
        <p className="es-book-tier__price es-nums">
          {free ? 'Free' : formatMoney(tier.priceCents, currency)}
          {!free && UNIT[d.priceUnit] && <small>{UNIT[d.priceUnit]}</small>}
        </p>
      </div>

      {included.length > 0 && (
        <ul className="es-book-tier__list" aria-label={`Included with ${tier.name}`}>
          {included.map((item, i) => (
            <li key={`${item.title}-${i}`}>
              <span className="es-book-check" aria-hidden="true"><NavIcon name="tick" size={13} /></span>
              <span className="fx-min0 fx-break">
                {item.title}
                {item.text && <small>{item.text}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="es-book-tier__notes">
          {notes.map((n, i) => (
            <li key={`${n.text}-${i}`}><NavIcon name="info" size={15} /><span className="fx-min0 fx-break">{n.text}</span></li>
          ))}
        </ul>
      )}

      <div className="es-book-tier__foot">
        <TierStatus tier={tier} timeZone={timeZone} />
        {unavailable ? (
          <span className="es-book-tier__off">{tier.soldOut ? 'Sold out' : 'Not on sale'}</span>
        ) : (
          <div className="es-book-tier__qty">
            <span className="es-book-tier__qty-label" aria-hidden="true">Quantity</span>
            <Stepper
              value={count}
              name={tier.name}
              onMinus={onMinus}
              onPlus={onPlus}
              minusDisabled={count === 0 || busy}
              plusDisabled={Boolean(blocked) || busy}
              plusTitle={blocked || undefined}
            />
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Where a type stands, in one line. "Not on sale yet" and "sold out" stay
 * different sentences: the first is a reason to come back.
 */
function TierStatus({ tier, timeZone }) {
  if (tier.soldOut) return <span />;
  if (tier.notYetOnSale && tier.salesStartAt) {
    return <span className="es-book-tier__state">On sale from {formatEventTime(tier.salesStartAt, timeZone)}</span>;
  }
  if (tier.salesEnded) return <span className="es-book-tier__state">No longer on sale</span>;
  if (tier.remaining !== null && tier.remaining !== undefined && tier.remaining <= 10) {
    return <span className="es-book-tier__state es-book-tier__state--warn">Only {tier.remaining} left</span>;
  }
  if (tier.salesEndAt) {
    return <span className="es-book-tier__state">Until {formatEventTime(tier.salesEndAt, timeZone)}</span>;
  }
  return <span />;
}
