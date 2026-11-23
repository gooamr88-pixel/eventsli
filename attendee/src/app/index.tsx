import { Redirect } from 'expo-router';

import { useSession } from '@/auth/session';

/**
 * Where the app opens, and where it lands whenever a guard drops the screen
 * it was on (welcome finished, signed in): the welcome screen once, then Home.
 */
export default function Index() {
  const onboarded = useSession((s) => s.onboarded);
  const account = useSession((s) => s.account);
  return <Redirect href={onboarded || account ? '/(tabs)' : '/welcome'} />;
}
