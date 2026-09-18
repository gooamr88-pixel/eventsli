import NavIcon from '../../components/shell/NavIcon';
import { formatPrice } from '../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COSTS — the card that used to be a sticky column on the right.
 *
 * On a phone that column was simply the last block of the page, so the price
 * sat below the description, the gallery, four tab panels and the sponsors.
 * Here it is one card in the flow, directly under the sections, and the buy bar
 * carries the button at every scroll position.
 *
 * NOTHING HERE PRICES ANYTHING. Every figure is a tier's own `priceCents` as the
 * API gave it; the real total — taxes, fees, a discount — comes back from the
 * quote after the hold. Two places that both calculate money are two places that
 * can disagree about what somebody owes.
 *
 * A SOLD-OUT OR NOT-YET-OPEN TIER IS SHOWN, NOT HIDDEN, and says which it is.
 * "Early bird — from Friday" is a reason to come back; a tier that quietly is
 * not there reads as an event with less on offer than it has, and collapsing
 * both into "unavailable" tells somebody an early-bird price is gone when it
 * has not opened.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventTickets({ event, cheapest, soldOut }) {
  const tiers = event.tiers || [];
  if (event.displayOnly || tiers.length === 0) return null;

  const from = cheapest.length > 0 ? Math.min(...cheapest) : null;
  const seats = event.availability;

  return (
    <section className="es-ev-tickets" aria-labelledby="event-tickets">
      {/* The eyebrow was "From", qualifying the price under it. It says what
          this card is FOR instead — the card is the step, not a price tag, and
          the number keeps its own meaning from the tiers listed beneath it.

          The verb follows the event: a reserved event really does mean
          choosing a seat, and saying so on a general-admission one would be a
          promise the next screen breaks. */}
      <div>
        <p className="es-ev-tickets__from" id="event-tickets">
          {event.admissionType === 'general'
            ? 'Buy your ticket'
            : 'Choose your seat · Buy your ticket'}
        </p>
        <p className="es-price">
          {from === null ? 'See tickets' : from === 0 ? 'Free' : formatPrice(from, event.currency)}
        </p>
      </div>

      <ul className="fx-stack fx-stack--sm">
        {tiers.map((tier) => (
          <li key={tier.id} className="es-ev-tier">
            <span className="fx-min0">
              <span className="es-ev-tier__name fx-break">{tier.name}</span>
              {tier.description && (
                <span className="es-ev-tier__desc fx-break">{tier.description}</span>
              )}
              <TierState tier={tier} />
            </span>
            <span className="es-ev-tier__price es-nums">
              {tier.soldOut
                ? <span className="es-ev-tier__state">Sold out</span>
                : tier.priceCents === 0 ? 'Free' : formatPrice(tier.priceCents, event.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className="es-ev-tickets__foot fx-grid">
        {/* Only where the room is actually counted. An uncapped event reports
            `null`, and "null of null seats left" is worse than saying nothing. */}
        {!soldOut && seats?.seatsAvailable !== null && seats?.seatsTotal !== null && (
          <p className="es-ev-tickets__stat">
            <NavIcon name="users" size={18} />
            <span>
              <b className="es-nums text-ink">{seats.seatsAvailable}</b>
              {' '}of {seats.seatsTotal} seats left
            </span>
          </p>
        )}
        {event.maxTicketsPerOrder > 0 && (
          <p className="es-ev-tickets__stat">
            <NavIcon name="ticket" size={18} />
            <span>Up to {event.maxTicketsPerOrder} tickets per order</span>
          </p>
        )}
      </div>
    </section>
  );
}

/** The one line under a tier that says where it stands. */
function TierState({ tier }) {
  // Nothing for a sold-out tier: the price column already says so, and saying
  // it twice in one row reads as two different facts.
  if (tier.soldOut) return null;

  if (tier.notYetOnSale && tier.salesStartAt) {
    return (
      <span className="es-ev-tier__state">
        On sale from {new Date(tier.salesStartAt).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric',
        })}
      </span>
    );
  }
  if (tier.salesEnded) return <span className="es-ev-tier__state">No longer on sale</span>;
  // Only when it is genuinely nearly gone. A count on a tier with two hundred
  // left is noise; on one with three left it is why somebody stops deliberating.
  if (tier.remaining !== null && tier.remaining <= 10) {
    return <span className="es-ev-tier__state text-warning">Only {tier.remaining} left</span>;
  }
  return null;
}

/**
 * The organizer's highlights, as icon-led marks.
 *
 * ONE MARK FOR ALL OF THEM, deliberately. The mockup draws a different glyph
 * beside each, but a highlight is free text an organizer typed — there is no
 * field saying which of them means "meet people" and which means "free
 * parking", and guessing an icon from the words would be wrong the first time
 * somebody writes something unexpected. One consistent mark keeps the rhythm
 * the design is after without inventing meaning the data does not carry.
 */
export function EventMarks({ items = [] }) {
  if (items.length === 0) return null;
  return (
    <ul className="es-ev-marks fx-grid" aria-label="Event highlights">
      {items.map((text, i) => (
        <li key={`${text}-${i}`} className="es-ev-mark">
          <span aria-hidden className="es-ev-mark__icon"><NavIcon name="check" size={16} /></span>
          <span className="fx-min0 fx-break">{text}</span>
        </li>
      ))}
    </ul>
  );
}
