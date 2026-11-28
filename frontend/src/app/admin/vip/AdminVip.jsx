'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import VipRequests from '../../components/vip/admin/VipRequests';
import VipInbox from '../../components/vip/admin/VipInbox';
import VipSettingsForm from '../../components/vip/admin/VipSettingsForm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services, from the console (owner, 2026-11-28).
 *
 *   Requests         every request; open one to reply (WhatsApp or email,
 *                    chosen for you), change its status, assign it, note it
 *   WhatsApp inbox   chats that are not tied to a request yet: answer them,
 *                    link them to a request, or dismiss them
 *   Settings         the WhatsApp connection, the number and email
 *                    organizers see, the services offered — a super admin's
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TABS = ['requests', 'inbox', 'settings'];

export default function AdminVip() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  // From the URL, so a link to "?tab=inbox" (the Unmatched card) switches too.
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'requests';

  function changeTab(next) {
    router.replace(next === 'requests' ? '/admin/vip' : `/admin/vip?tab=${next}`, { scroll: false });
  }

  return (
    <div className="fx-stack">
      <PageHeader
        icon="crown"
        eyebrow="Sales"
        title="VIP Services"
        lede="Organizers' requests for the Eventsli team, and the WhatsApp conversations about them."
      />
      <Segmented
        label="Section"
        value={tab}
        onChange={changeTab}
        options={[
          { value: 'requests', label: 'Requests' },
          { value: 'inbox', label: 'WhatsApp inbox' },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'requests' && <VipRequests />}
      {tab === 'inbox' && <VipInbox />}
      {tab === 'settings' && <VipSettingsForm canEdit={Boolean(user?.isSuperAdmin)} />}
    </div>
  );
}
