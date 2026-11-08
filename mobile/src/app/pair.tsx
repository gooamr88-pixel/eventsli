import { Redirect, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/auth/session';

/**
 * eventsli-checkin://pair?device=<id> — the organizer's pairing QR, opened by
 * the phone's own camera. Fills in the shared device's id; the PIN is still
 * typed by hand and is never in the code.
 */
export default function Pair() {
  const { device } = useLocalSearchParams<{ device?: string }>();
  const door = useSession((s) => s.door);
  const account = useSession((s) => s.account);
  // Already working a door, or signed in as a person: pairing a tablet would
  // silently replace that. Go home; they can sign out first.
  if (door || account) return <Redirect href="/" />;
  const id = typeof device === 'string' && /^[0-9a-f-]{36}$/i.test(device) ? device : undefined;
  return <Redirect href={{ pathname: '/device-pin', params: id ? { device: id } : {} }} />;
}
