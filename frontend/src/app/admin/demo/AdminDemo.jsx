'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import DemoBookings from '../../components/demo/admin/DemoBookings';
import DemoSettingsForm from '../../components/demo/admin/DemoSettingsForm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Book a demo, from the console (owner, 2026-11-19): "complete controlling
 * from admin dashboard".
 *
 *   Bookings   every demo: upcoming, past, cancelled; open one to add notes
 *              and the call link, mark it done or missed, move or cancel it
 *   Settings   the public page's texts, the hours, the rules, the form and
 *              who is emailed — a super admin's (the API enforces it too)
 *
 * `?booking=<id>` (the link in the admin email) opens that booking.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminDemo() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState(params.get('tab') === 'settings' ? 'settings' : 'bookings');

  function changeTab(next) {
    setTab(next);
    router.replace(next === 'settings' ? '/admin/demo?tab=settings' : '/admin/demo', { scroll: false });
  }

  return (
    <div className="fx-stack">
      <PageHeader
        icon="calendarPlus"
        eyebrow="Sales"
        title="Demo bookings"
        lede="People who booked a demo on the public Book a demo page, and how that page works."
        actions={<a className="es-btn es-btn--secondary es-btn--sm" href="/demo" target="_blank" rel="noopener">Open the public page</a>}
      />
      <Segmented
        label="Section"
        value={tab}
        onChange={changeTab}
        options={[{ value: 'bookings', label: 'Bookings' }, { value: 'settings', label: 'Settings' }]}
      />
      {tab === 'bookings'
        ? <DemoBookings openId={params.get('booking')} />
        : <DemoSettingsForm canEdit={Boolean(user?.isSuperAdmin)} />}
    </div>
  );
}
