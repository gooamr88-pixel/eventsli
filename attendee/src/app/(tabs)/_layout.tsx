import { Tabs } from 'expo-router';

import { isUpcoming, useTickets } from '@/hooks/useTickets';
import { useLayout } from '@/ui/layout';
import { TabBar } from '@/ui/TabBar';

/**
 * Home, Explore, Saved, Tickets, Profile. The bar itself is ui/TabBar.tsx: the
 * mockup's bar on a phone, a left rail on a wide screen. Tickets carries a
 * badge with how many upcoming orders there are, so a ticket bought on the
 * website is noticed here too.
 */
const TABS = [
  { name: 'index', title: 'Home' },
  { name: 'explore', title: 'Explore' },
  { name: 'saved', title: 'Saved' },
  { name: 'tickets', title: 'Tickets' },
  { name: 'profile', title: 'Profile' },
] as const;

export default function TabsLayout() {
  const { wide } = useLayout();
  const tickets = useTickets();
  const upcoming = (tickets.data ?? []).filter((o) => isUpcoming(o)).length;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      // 'shift': the new tab glides in slightly from its side, so moving
      // between tabs feels like moving, not a cut.
      screenOptions={{ headerShown: false, tabBarPosition: wide ? 'left' : 'bottom', animation: 'shift' }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarBadge: t.name === 'tickets' && upcoming ? upcoming : undefined }}
        />
      ))}
    </Tabs>
  );
}
