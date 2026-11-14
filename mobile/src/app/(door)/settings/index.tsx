import { router } from 'expo-router';

import { SettingsScreen } from '@/screens/Settings';

/** Settings (the Profile tab) while working a door. */
export default function DoorSettings() {
  return (
    <SettingsScreen
      mode="door"
      links={{
        profile: () => router.push('/settings/profile'),
        appSettings: () => router.push('/settings/app-settings'),
        dataSync: () => router.push('/settings/data-sync'),
        help: () => router.push('/settings/help'),
      }}
    />
  );
}
