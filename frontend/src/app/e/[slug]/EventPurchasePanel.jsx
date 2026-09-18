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
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE WAY IN IS, FOR THIS EVENT — decided once, read in two places.
 *
 * The sticky panel renders this as a full-width button; `EventBuyBar` renders
 * the same answer in the phone's fixed bar. They MUST agree: a page offering
 * "Choose your seats" in the panel and "Get tickets" in the bar is one where
 * the two were edited separately, and a bar that still linked to `/seats` on an
 * event switched to general admission would send every phone buyer to a
 * redirect. One function, two call sites, nothing to keep in sync.
 *
 * Returns `null` when there is nothing to offer, and the caller decides how to
 * say so — the panel has room for a sentence, the bar does not.
 *
 * BRD §12 — a `display_only` event is a listing with no tickets behind it. It
 * gets no buy button at all rather than a disabled one, because a dead control
 * is a question ("why can't I click this?") the page then has to answer.
 *
 * A reserved event sends the buyer to the seat map; a general-admission one has
 * no map to send them to, so it goes to the ticket picker instead. The label
 * follows the same fact — "Choose your seats" on an event with no seats is a
 * promise the next page cannot keep, and the reader notices immediately.
 *
 * A free event says "Get tickets" rather than anything about buying. Somebody
 * deciding whether to click is deciding whether to spend money, and the answer
 * is no.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ctaFor(event, soldOut, tierId) {
  if (event.displayOnly) {
    return { kind: 'listing', note: 'This event is listed for information. Tickets are not sold here.' };
  }
  if (soldOut) return { kind: 'soldout', note: 'Sold out' };

  const general = event.admissionType === 'general';
  const free = (event.tiers || []).length > 0
    && (event.tiers || []).every((t) => Number(t.priceCents) === 0);

  return {
    kind: 'buy',
    // The tier travels with the buyer, so the next page can start from it.
    href: `/e/${event.slug}/${general ? 'tickets' : 'seats'}${tierId ? `?tier=${encodeURIComponent(tierId)}` : ''}`,
    label: free || general ? 'Get tickets' : 'Choose your seats',
    free,
  };
}

function CallToAction({ event, soldOut, tierId }) {
  const cta = ctaFor(event, soldOut, tierId);

  if (cta.kind !== 'buy') {
    return (
      <p className="rounded-(--es-radius-md) bg-bg-sunken px-4 py-3 text-center text-muted" role="status">
        {cta.note}
      </p>
    );
  }

  return (
    <Link href={cta.href} className="es-btn es-btn--primary es-btn--block es-btn--lg">
      {cta.label}
    </Link>
  );
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PHONE'S BUY BAR — the price and the way in, fixed to the bottom.
 *
 * Below `lg` the purchase panel is the last block of a long single column, so
 * the action this page exists to offer opened several screens down. This is
 * that action, always on screen. `.es-buybar` argues the CSS side; what matters
 * here is that every word of it comes from `ctaFor`, so it cannot drift from
 * the panel above it.
 *
 * A sold-out or display-only event gets NO BAR AT ALL rather than a bar with a
 * dead label in it. The panel already says why, in a full sentence with room to
 * explain; a fixed strip repeating "Sold out" over every scroll position is an
 * obstruction that tells nobody anything they have not read.
 *
 * `aria-hidden` is deliberately NOT set. This is the primary action on a phone,
 * and hiding it from a screen reader to avoid announcing the price twice would
 * hide the button too. It is a labelled landmark instead, so it is reachable
 * and skippable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function EventBuyBar({ event, soldOut, tierId, cheapest = [] }) {
  const cta = ctaFor(event, soldOut, tierId);
  if (cta.kind !== 'buy') return null;

  const from = cheapest.length > 0 ? Math.min(...cheapest) : null;

  return (
    <div className="es-buybar" role="region" aria-label="Get tickets">
      <div className="es-buybar__price">
        {from === null ? (
          <span className="text-sm text-muted">Tickets available</span>
        ) : (
          <>
            <span className="es-eyebrow">{cta.free || from === 0 ? 'Entry' : 'From'}</span>
            <span className="es-nums text-lg font-medium text-ink">
              {from === 0 ? 'Free' : formatPrice(from, event.currency)}
            </span>
          </>
        )}
      </div>
      <div className="es-buybar__action">
        <Link href={cta.href} className="es-btn es-btn--primary">
          {cta.label}
        </Link>
      </div>
    </div>
  );
}
