import Link from 'next/link';
import { formatPrice } from '../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The price, the ticket types, and the way in.
 *
 * Extracted from the event page when that page crossed the project's 500-line
 * cap. Not a line-shuffle to satisfy a counter: this is the one part of the
 * page that is about BUYING rather than about the event, it is the only part
 * that is sticky, and it is the part whose behaviour changes with admission
 * type and price. Everything else on that page is content.
 *
 * STICKY, from `lg` up. The description on a well-filled event runs past the
 * fold, and when it does, the price and the button scroll away with the top of
 * the page — so the reader finishes the part that convinced them and has to
 * scroll back up to act on it. `self-start` is what makes sticky work at all: a
 * grid item defaults to `stretch`, which makes this column as tall as the
 * content beside it, and an element the full height of its scroll container has
 * nowhere to stick to.
 *
 * `lg:-mt-28` lifts the box over the masthead band above it. That overlap is
 * the one piece of deliberate asymmetry on the page and it does real work: it
 * puts the price physically on top of the artwork, which is the pairing the
 * reader is deciding about, and it stops this column starting on the same
 * horizontal line as the description — which is what made the old layout read
 * as two lists side by side.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventPurchasePanel({ event, focusTier, soldOut, cheapest }) {
  return (
            <aside className="fx-stack lg:-mt-28 lg:sticky lg:top-20 lg:self-start">
              <div className="es-plate bg-surface fx-stack p-6">
                {cheapest.length > 0 && (
                  <div className="fx-stack fx-stack--sm gap-1">
                    <p className="es-eyebrow">From</p>
                    <p className="es-price">
                      {formatPrice(Math.min(...cheapest), event.currency)}
                      {cheapest.length > 1 && (
                        <span className="ml-2 font-sans text-sm text-subtle">and up</span>
                      )}
                    </p>
                  </div>
                )}

                {focusTier && (
                  <p className="es-notice es-notice--info" role="status">
                    <span>You were sent here for <strong>{focusTier.name}</strong>.</span>
                  </p>
                )}

                {event.tiers?.length > 0 && (
                  <ul className="fx-stack fx-stack--sm">
                    {event.tiers.map((tier) => (
                      <li
                        key={tier.id}
                        id={`tier-${tier.id}`}
                        aria-current={focusTier?.id === tier.id ? 'true' : undefined}
                        className={`fx-row fx-row--between border-t border-border-base pt-3 first:border-0 first:pt-0 ${
                          focusTier?.id === tier.id ? '-mx-3 rounded-(--es-radius-md) bg-accent-wash px-3 pb-3' : ''
                        }`}
                      >
                        <span className="fx-min0">
                          <span className="block text-ink">{tier.name}</span>
                          {tier.description && (
                            <span className="block text-sm text-subtle">{tier.description}</span>
                          )}
                        </span>
                        <span className="es-nums font-medium text-ink">
                          {formatPrice(tier.priceCents, event.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <CallToAction event={event} soldOut={soldOut} tierId={focusTier?.id} />

                {event.availability && !soldOut && (
                  <p className="text-center text-sm text-subtle">
                    <span className="es-nums font-medium text-ink">
                      {event.availability.seatsAvailable}
                    </span>
                    {' '}of {event.availability.seatsTotal} seats left
                  </p>
                )}
              </div>

              <p className="text-center text-sm text-subtle">
                Up to {event.maxTicketsPerOrder} tickets per order · seats held for 35 minutes
              </p>
            </aside>
  );
}

/**
 * BRD §12 — a `display_only` event is a listing with no tickets behind it. It
 * gets no buy button at all rather than a disabled one, because a dead control
 * is a question ("why can't I click this?") the page then has to answer.
 */
function CallToAction({ event, soldOut, tierId }) {
  if (event.displayOnly) {
    return (
      <p className="rounded-(--es-radius-md) bg-bg-sunken px-4 py-3 text-center text-muted" role="status">
        This event is listed for information. Tickets are not sold here.
      </p>
    );
  }

  if (soldOut) {
    return (
      <p className="rounded-(--es-radius-md) bg-bg-sunken px-4 py-3 text-center text-muted" role="status">
        Sold out
      </p>
    );
  }

  /**
   * WHERE THE BUTTON GOES, AND WHAT IT SAYS, both follow the event.
   *
   * A reserved event sends the buyer to the seat map; a general-admission one
   * has no map to send them to, so it goes to the ticket picker instead. The
   * label follows the same fact — "Choose your seats" on an event with no seats
   * is a promise the next page cannot keep, and the reader notices immediately.
   *
   * A free event says "Get tickets" rather than anything about buying. Somebody
   * deciding whether to click is deciding whether to spend money, and the
   * answer is no.
   */
  const general = event.admissionType === 'general';
  const free = (event.tiers || []).length > 0
    && (event.tiers || []).every((t) => Number(t.priceCents) === 0);

  return (
    <Link
      // The tier travels with the buyer, so the next page can start from it.
      href={`/e/${event.slug}/${general ? 'tickets' : 'seats'}${tierId ? `?tier=${encodeURIComponent(tierId)}` : ''}`}
      className="es-btn es-btn--primary es-btn--block es-btn--lg"
    >
      {free ? 'Get tickets' : general ? 'Get tickets' : 'Choose your seats'}
    </Link>
  );
}
