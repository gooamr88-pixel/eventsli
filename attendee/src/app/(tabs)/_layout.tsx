import { Tabs } from 'expo-router';

import { Icon, type IconName } from '@/ui/Icon';
import { colors, fonts } from '@/ui/theme';

/** Home, Explore, Saved, Tickets, Profile — the mockup's tab bar, coral when active. */
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'explore', title: 'Explore', icon: 'compass' },
  { name: 'saved', title: 'Saved', icon: 'heart' },
  { name: 'tickets', title: 'Tickets', icon: 'ticket' },
  { name: 'profile', title: 'Profile', icon: 'user' },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.subtle,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, focused }) => (
              <Icon name={t.icon} size={23} color={String(color)} fill={focused && t.icon === 'heart' ? String(color) : undefined} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
