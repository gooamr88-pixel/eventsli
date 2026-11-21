'use client';

import FormError from '../../../components/forms/FormError';
import { useStartBooking } from '../../../components/vendors/booking/useStartBooking';

/** "Apply without a booth" on the vendor page (apply mode only). */
export default function StartBooking({ slug, label, className }) {
  const { start, busy, error } = useStartBooking(slug);
  return (
    <div className="fx-stack fx-stack--sm">
      <button type="button" className={className} onClick={() => start()} disabled={busy} aria-busy={busy || undefined}>
        {busy ? 'Starting…' : label}
      </button>
      <FormError error={error} />
    </div>
  );
}
