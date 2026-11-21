'use client';

import { useState } from 'react';
import { formatMoney } from '../../../utils/money';
import { useApi } from '../../../hooks/useApi';
import { Panel } from '../../../components/ui/Page';
import DocumentsCard from '../../../components/vendors/booking/DocumentsCard';

/**
 * A vendor's add-ons and documents on their booking page (2026-11-21), read
 * from the booking API. Documents can still be uploaded after sending: a
 * missing one, or one the organizer rejected, is replaced here.
 */
export default function VendorExtras({ appId }) {
  const api = useApi(`/partner/vendors/bookings/${appId}`);
  const [override, setOverride] = useState(null);
  const b = override || api.data;
  if (!b) return null;
  const closed = ['rejected', 'withdrawn', 'cancelled', 'expired'].includes(b.stage);
  return (
    <>
      {b.addons.length > 0 && (
        <Panel icon="plus" title="Your add-ons" description={`Provided by ${b.event.organizerName || 'the organizer'}.`}>
          <ul className="es-vb-orgaddons">
            {b.addons.map((x) => (
              <li key={x.id}>
                <span>{x.name}<span className="text-xs text-subtle"> · {x.kind === 'marketing' ? 'Marketing' : 'Booth'}</span></span>
                <b className="es-nums">{x.priceCents === 0 ? 'Free' : formatMoney(x.priceCents, b.currency)}</b>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {!closed && (
        <DocumentsCard base={`/partner/vendors/bookings/${appId}`} spec={b.program.documents} documents={b.documents}
          onChange={setOverride} locked title="Your documents" />
      )}
    </>
  );
}
