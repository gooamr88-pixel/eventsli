'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import { useAuth } from '../../../hooks/useAuth';

/**
 * Starting a vendor booking (2026-11-21): POST /partner/vendors/bookings, then
 * the booking's own page. A booking belongs to an account, so a signed-out
 * visitor is sent to sign in and brought back to where they were — their
 * add-on ticks are lost, which is cheaper than holding a booth for nobody.
 *
 * A vendor who already booked or applied gets their booking, not an error.
 */
export function useStartBooking(slug) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function start({ boothTypeId = null, boothKey = null, addonIds = [] } = {}) {
    if (!user) {
      if (loading) return;
      router.push(`/login?next=${encodeURIComponent(pathname || `/e/${slug}/vendors`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await post('/partner/vendors/bookings', { slug, boothTypeId, boothKey, addonIds }, { noRedirect: true });
      router.push(`/e/${slug}/vendors/book/${made.id}`);
    } catch (err) {
      if (err?.code === 'CONFLICT' && err?.meta?.applicationId) {
        router.push(`/account/vendors/${err.meta.applicationId}`);
        return;
      }
      setError(err);
      setBusy(false);
    }
  }

  return { start, busy, error, signedIn: !!user };
}
