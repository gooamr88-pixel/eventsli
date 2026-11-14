import { router } from 'expo-router';

import { SettingsScreen } from '@/screens/Settings';

/** Settings while choosing an event: the Profile tab of My Events. */
export default function AccountSettings() {
  return (
    <SettingsScreen
      mode="account"
      links={{
        profile: () => router.push('/account/profile'),
        appSettings: () => router.push('/account/app-settings'),
        help: () => router.push('/account/help'),
      }}
    />
  );
}
