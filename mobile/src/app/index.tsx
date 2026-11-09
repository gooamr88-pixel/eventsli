import { Redirect } from 'expo-router';

import { useSession } from '@/auth/session';

/** Where a phone belongs right now: its door, its events, or sign-in. */
export default function Index() {
  const account = useSession((s) => s.account);
  const door = useSession((s) => s.door);
  if (door) return <Redirect href="/dashboard" />;
  if (account) return <Redirect href="/events" />;
  return <Redirect href="/sign-in" />;
}
