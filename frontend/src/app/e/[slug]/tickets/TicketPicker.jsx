'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError, isSelectionLost, messageFor } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { useApi } from '../../../hooks/useApi';
import { useReservation } from '../../../hooks/useReservation';
import { Loading, Empty, ErrorNotice, Notice } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * General admission: how many of each ticket type.
 *
 * NOTHING HERE PRICES ANYTHING. The running total is the sum of the ticket
 * prices and is labelled as such; the real total comes back from the quote
 * AFTER the hold, with the taxes and fees this page is in no position to
 * compute. That is the same rule the seat picker follows, for the same reason:
 * two places that both calculate money are two places that can disagree about
 * what somebody owes.
 *
 * WHAT LIMITS A STEPPER, in the order it binds:
 *
 *   • how many are left in that type (`remaining`, null = uncapped);
 *   • that type's own cap on one order (`maxPerOrder`);
 *   • the EVENT's cap across all types, which is what stops somebody taking
 *     ten of each of four types on an event that allows ten in total.
 *
 * All three are enforced again inside `hold_general`, under a row lock. These
 * exist so a buyer is stopped before they have chosen, not after — the server
 * is the authority, this is the explanation.
 *
 * A SOLD-OUT OR NOT-YET-OPEN TYPE IS SHOWN, NOT HIDDEN. "Early bird — from
 * Friday" is a reason to come back; a type that quietly is not there reads as
 * an event with less on offer than it has.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TicketPicker({ slug, focusTierId }) {
  const router = useRouter();
  const { hold } = useReservation();
  const { data: event, error, loading, reload } = useApi(`/public/events/${encodeURIComponent(slug)}`);
  const [counts, setCounts] = useState({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const tiers = useMemo(() => event?.tiers || [], [event]);
  const maxPerOrder = event?.maxTicketsPerOrder || 10;

  const chosen = useMemo(
    () => Object.values(counts).reduce((n, q) => n + q, 0),
    [counts],
  );

  const subtotal = useMemo(
    () => tiers.reduce((sum, t) => sum + (counts[t.id] || 0) * t.priceCents, 0),
    [tiers, counts],
  );

  const everythingFree = tiers.length > 0 && tiers.every((t) => t.priceCents === 0);

  if (loading && !event) return <Loading variant="card" label="Loading tickets" />;
  if (error && !event) return <ErrorNotice error={error} action={{ href: `/e/${slug}`, label: 'Back to the event' }} />;
  if (tiers.length === 0) {
    return <Empty title="No tickets yet" hint="The organizer has not put tickets on sale for this event." />;
  }

  /** What one more of this type would be refused for, or null. */
  function blockedReason(tier) {
    const current = counts[tier.id] || 0;
    if (tier.remaining !== null && current >= tier.remaining) return 'That is all that is left.';
    const own = tier.maxPerOrder;
    if (own !== null && own !== undefined && current >= own) {
      return `Up to ${own} of this type in one order.`;
    }
    if (chosen >= maxPerOrder) return `Up to ${maxPerOrder} tickets in one order.`;
    return null;
  }

  function change(tier, delta) {
    setActionError(null);
    setCounts((c) => {
      const current = c[tier.id] || 0;
      const next = current + delta;
      if (next <= 0) {
        const { [tier.id]: _removed, ...rest } = c;
        return rest;
      }
      return { ...c, [tier.id]: next };
    });
  }

  async function submit() {
    if (chosen === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const lines = Object.entries(counts)
        .filter(([, quantity]) => quantity > 0)
        .map(([tierId, quantity]) => ({ tierId, quantity }));

      const reservation = await hold(slug, { lines });
      router.push(`/checkout/${reservation.reservationId}`);
    } catch (err) {
      setActionError(err);
      /**
       * Somebody else took the last of a type between the render and the hold.
       * The numbers on screen are now wrong, so they are re-read — and the
       * selection is cleared rather than kept, because a quantity the buyer
       * chose against stale availability is not a choice they would make again.
       */
      if (isSelectionLost(err?.code)) {
        setCounts({});
        reload();
      }
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack">
      <ul className="fx-stack fx-stack--sm">
        {tiers.map((tier) => {
          const count = counts[tier.id] || 0;
          const unavailable = tier.soldOut || !tier.onSale;
          const blocked = blockedReason(tier);

          return (
            <li
              key={tier.id}
              className={`es-plate fx-row fx-row--between flex-wrap items-center gap-4 p-4 ${
                focusTierId === tier.id ? 'border-accent' : ''
              }`}
            >
              <div className="fx-min0 flex-1">
                <p className="text-ink">
                  {tier.name}
                  {tier.kind === 'vip' && <span className="es-pill es-pill--accent ml-2">VIP</span>}
                  {tier.kind === 'early_bird' && <span className="es-pill ml-2">Early bird</span>}
                </p>
                {tier.description && <p className="text-sm text-subtle">{tier.description}</p>}
                <p className="es-nums mt-1 text-md font-medium text-ink">
                  {tier.priceCents === 0 ? 'Free' : formatMoney(tier.priceCents, event.currency)}
                </p>
                <TierStatus tier={tier} />
              </div>

              {unavailable ? (
                <span className="es-pill shrink-0">{tier.soldOut ? 'Sold out' : 'Not on sale'}</span>
              ) : (
                <div className="fx-row shrink-0 items-center gap-2">
                  <StepButton
                    onClick={() => change(tier, -1)}
                    disabled={count === 0 || busy}
                    label={`One fewer ${tier.name}`}
                  >
                    −
                  </StepButton>
                  <span className="es-nums w-8 text-center text-md text-ink" aria-live="polite">
                    {count}
                  </span>
                  <StepButton
                    onClick={() => change(tier, 1)}
                    disabled={Boolean(blocked) || busy}
                    label={`One more ${tier.name}`}
                    title={blocked || undefined}
                  >
                    +
                  </StepButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {actionError && (
        <Notice tone="danger" title={describeError(actionError).title}>
          <p>{messageFor(actionError)}</p>
        </Notice>
      )}

      <div className="es-plate fx-stack fx-stack--sm bg-surface p-4">
        <div className="fx-row fx-row--between items-baseline gap-3">
          <span className="text-ink">
            {chosen} {chosen === 1 ? 'ticket' : 'tickets'}
          </span>
          <span className="es-nums text-lg font-medium text-ink">
            {everythingFree || subtotal === 0 ? 'Free' : formatMoney(subtotal, event.currency)}
          </span>
        </div>

        {/* Said before the hold, not after the quote. Somebody choosing four
            tickets should know the number will grow before they see it grow. */}
        {subtotal > 0 && (
          <p className="text-xs text-subtle">
            Tickets only. Any taxes and booking fees are shown at the checkout.
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={chosen === 0 || busy}
          className="es-btn es-btn--primary es-btn--block es-btn--lg"
        >
          {busy ? 'Holding…' : chosen === 0 ? 'Choose your tickets' : 'Continue'}
        </button>

        <p className="text-center text-xs text-subtle">
          Up to {maxPerOrder} tickets per order · held for 35 minutes once you continue
        </p>
      </div>
    </div>
  );
}

/**
 * The one line under a ticket type that says where it stands.
 *
 * "Not on sale yet" and "sold out" are deliberately different sentences, not
 * one "unavailable": the first is an invitation to come back and the second is
 * not, and collapsing them tells somebody an early-bird type is gone when it
 * has not opened.
 */
function TierStatus({ tier }) {
  // Nothing here for a sold-out type: the pill beside it already says so, and
  // saying it twice in one row reads as two different facts.
  if (tier.soldOut) return null;

  if (tier.notYetOnSale && tier.salesStartAt) {
    return (
      <p className="text-sm text-subtle">
        On sale from {new Date(tier.salesStartAt).toLocaleString(undefined, {
          dateStyle: 'medium', timeStyle: 'short',
        })}
      </p>
    );
  }

  if (tier.salesEnded) return <p className="text-sm text-subtle">No longer on sale</p>;

  // Only when it is genuinely nearly gone. A live count on a type with two
  // hundred left is noise, and on one with three left it is the reason
  // somebody stops deliberating.
  if (tier.remaining !== null && tier.remaining <= 10) {
    return (
      <p className="text-sm text-warning">
        Only {tier.remaining} left
      </p>
    );
  }

  if (tier.salesEndAt) {
    return (
      <p className="text-sm text-subtle">
        Until {new Date(tier.salesEndAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
    );
  }

  return null;
}

function StepButton({ onClick, disabled, label, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      // 44px: the smallest square a thumb hits reliably, and these are tapped
      // repeatedly rather than once.
      className="grid h-11 w-11 place-items-center rounded-full border border-border-strong text-lg text-ink transition-colors hover:bg-bg-sunken disabled:opacity-40"
    >
      {children}
    </button>
  );
}
