'use client';

import { useEventContext } from '../EventContext';
import DoorList from '../vendors/DoorList';

/**
 * The vendor entrance list, on the Door list (owner, 2026-11-23).
 *
 * It was a sixth tab inside Vendors, so there were two "Door lists" in the
 * product and the door team had to know to look in both. Now there is one
 * screen for everybody who comes through a door; this part only shows for an
 * event that has vendors.
 */
export default function VendorStaff({ eventId }) {
  const event = useEventContext()?.event;
  if (!event?.partners?.vendors) return null;
  return <DoorList eventId={eventId} eventTitle={event.title} />;
}
