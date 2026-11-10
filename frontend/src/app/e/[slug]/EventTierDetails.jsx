'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NavIcon from '../../components/shell/NavIcon';
import TierDetailsDialog, { hasDetails } from '../../components/tickets/TierDetailsDialog';
import { ctaFor } from './EventPurchasePanel';

/**
 * "What's included" beside a ticket type on the event page, opening the
 * organizer's details card. The event page sells nothing itself, so the card
 * has no quantity here: its button goes on to the seat map or the ticket
 * picker with this type picked out, where the same card can add N at once.
 */
export default function EventTierDetails({ event, tier, soldOut }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!hasDetails(tier)) return null;
  const cta = ctaFor(event, soldOut, tier.id);
  const unavailable = tier.soldOut ? 'Sold out.' : tier.onSale === false ? 'Not on sale right now.' : null;

  return (
    <>
      <button type="button" className="es-tdx-open mt-1.5" onClick={() => setOpen(true)}>
        <NavIcon name="info" size={14} />What’s included<span className="sr-only"> in {tier.name}</span>
      </button>
      {open && (
        <TierDetailsDialog
          tier={tier}
          currency={event.currency}
          showQuantity={false}
          max={1}
          unavailable={unavailable}
          addLabel={event.admissionType === 'general' ? 'Choose tickets' : 'Choose your seats'}
          onAdd={() => { if (cta?.href) router.push(cta.href); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
