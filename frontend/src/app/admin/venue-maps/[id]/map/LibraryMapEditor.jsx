'use client';

import Link from 'next/link';
import { useAuth } from '../../../../hooks/useAuth';
import { Notice } from '../../../../components/Feedback';
import MapEditor from '../../../../organizer/events/[id]/map/MapEditor';

/**
 * Editing Eventsli's library maps is a super admin's (the library's own rule,
 * AdminVenueMaps `canEdit`); the API refuses anyone else's save as well.
 */
export default function LibraryMapEditor({ templateId }) {
  const { user } = useAuth();
  if (user && !user.isSuperAdmin) {
    return (
      <Notice title="Only a super admin can edit library maps.">
        <p><Link href="/admin/venue-maps" className="text-accent">Back to the venue maps</Link></p>
      </Notice>
    );
  }
  return <MapEditor templateId={templateId} />;
}
