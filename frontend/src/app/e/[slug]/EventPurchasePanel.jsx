import Link from 'next/link';
import { formatPrice } from '../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WAY IN — the notice that explains, and the bar that acts.
 *
 * THE STICKY SIDE PANEL IS GONE, and that is the point rather than a casualty.
 * It held the price, the tier list and the button in a column beside the
 * description — a desktop shape. Below `lg` there was no column to sit beside,
 * so it became the LAST block of a long single stack: the one action the page
 * exists to offer opened several screens down, under the description, the
 * gallery, four tab panels and the sponsors.
 *
 * The page is one column at every width now. The tier list is a card in the
 * flow (`EventTickets`), and the decision lives in a bar fixed to the bottom of
 * the viewport — always reachable, at every scroll position and every size.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * WHAT THE WAY IN IS, FOR THIS EVENT — decided once, read in three places.
 *
 * The bar, the notice and the tests all call this. They MUST agree: a page
 * offering "Choose your seats" in one place and "Get tickets" in another is one
 * where two copies were edited separately, and a bar that still linked to
 * `/seats` on an event switched to general admission would send every buyer to
 * a redirect.
 *
 * Returns `null`-shaped kinds when there is nothing to offer, and the caller
 * decides how to say so — the notice has room for a sentence, the bar does not.
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

/**
 * The sentences the bar has no room for.
 *
 * Only ever renders for an event somebody CANNOT buy from, or one they were
 * sent to a specific tier of. On an ordinary event on sale it is nothing at
 * all — the bar says everything there is to say, and a paragraph repeating it
 * above the fold is a paragraph in the way.
 */
export function EventPurchaseNotice({ event, soldOut, focusTier }) {
  const cta = ctaFor(event, soldOut, focusTier?.id);

  return (
    <>
      {focusTier && (
        <p className="es-notice es-notice--info" role="status">
          <span>You were sent here for <strong>{focusTier.name}</strong>.</span>
        </p>
      )}
      {cta.kind !== 'buy' && (
        <p className="rounded-(--es-radius-md) bg-bg-sunken px-4 py-3 text-center text-muted" role="status">
          {cta.note}
        </p>
      )}
    </>
  );
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUY BAR — the price and the way in, fixed to the bottom at every width.
 *
 * Every word of it comes from `ctaFor`, so it cannot drift from the notice
 * above it.
 *
 * A sold-out or display-only event gets NO BAR AT ALL rather than a bar with a
 * dead label in it. The notice already says why, in a full sentence with room
 * to explain; a fixed strip repeating "Sold out" over every scroll position is
 * an obstruction that tells nobody anything they have not read.
 *
 * `aria-hidden` is deliberately NOT set. This is the primary action on the
 * page, and hiding it from a screen reader to avoid announcing the price twice
 * would hide the button too. It is a labelled landmark instead, so it is
 * reachable and skippable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function EventBuyBar({ event, soldOut, tierId, cheapest = [] }) {
  const cta = ctaFor(event, soldOut, tierId);
  if (cta.kind !== 'buy') return null;

  const from = cheapest.length > 0 ? Math.min(...cheapest) : null;
  const free = cta.free || from === 0;

  return (
    <div className="es-buybar" role="region" aria-label="Get tickets">
      <div className="es-buybar__price">
        {from === null ? (
          <span className="text-sm text-muted">Tickets available</span>
        ) : (
          <>
            {/* "Entry" rather than "From" when everything is free: there is no
                range to be the bottom of. */}
            <span className="es-eyebrow">{free ? 'Entry' : 'From'}</span>
            <span className="es-nums text-lg font-medium text-ink">
              {free ? 'Free' : formatPrice(from, event.currency)}
            </span>
          </>
        )}
      </div>
      <div className="es-buybar__action">
        <Link href={cta.href} className="es-btn es-btn--primary">
          {cta.label}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
