import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { categories, listEvents, notifications, trending } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { Empty, Failed, IconButton, Loading, Section } from '@/ui/bits';
import { Cover } from '@/ui/Cover';
import { EventRow, EventTile } from '@/ui/EventCard';
import { Icon } from '@/ui/Icon';
import { Logo } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';
import { messageFor } from '@/api/client';

/**
 * Home (the mockup's third frame): the logo and the inbox bell, the city
 * being browsed, a search box that opens Explore, the trending banner, the
 * categories, and what is on next in that city.
 *
 * Trending is the admin's VIP list (/public/vip-events) — or, when there is
 * none, the soonest events with a cover. Upcoming is /public/events filtered
 * to the chosen city, sellers first; with no city chosen it is everywhere.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const city = useSession((s) => s.city);
  const { isSaved, flip } = useSaved();

  const hot = useQuery({ queryKey: ['trending'], queryFn: trending });
  const cats = useQuery({ queryKey: ['categories'], queryFn: categories, staleTime: 3_600_000 });
  const upcoming = useQuery({
    queryKey: ['events', 'upcoming', city?.city ?? null],
    queryFn: () => listEvents({ city: city?.city, ticketedFirst: true, limit: 12 }, token).then((r) => r.data),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notifications(token as string, 1).then((r) => Number(r.meta?.unread ?? 0)),
    enabled: Boolean(token),
  });

  const lead: EventCard | undefined = hot.data?.events?.[0];
  const refreshing = hot.isRefetching || upcoming.isRefetching;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + space.md }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void hot.refetch(); void upcoming.refetch(); void cats.refetch(); }} />}
      >
        <View style={styles.topRow}>
          <Logo height={26} />
          <View>
            <IconButton icon="bell" label="Notifications" onPress={() => router.push(token ? '/notifications' : '/sign-in')} />
            {unread.data ? <View style={styles.badge} accessibilityLabel={`${unread.data} unread`} /> : null}
          </View>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel={`City: ${city?.city ?? 'Everywhere'}. Change city`} onPress={() => router.push('/city')} style={styles.city}>
          <Icon name="pin" size={18} color={colors.accent} />
          <Text variant="label" weight="bold">{city?.city ?? 'Everywhere'}</Text>
          <Icon name="chevronDown" size={16} />
        </Pressable>

        <Pressable accessibilityRole="search" accessibilityLabel="Search events" onPress={() => router.push({ pathname: '/(tabs)/explore', params: { focus: '1' } })} style={styles.search}>
          <Icon name="search" size={20} color={colors.muted} />
          <Text variant="body" color={colors.placeholder}>Search events...</Text>
        </Pressable>

        {hot.isLoading ? <Loading style={{ minHeight: 200 }} /> : lead ? (
          <EventTile
            event={lead}
            saved={isSaved(lead.id)}
            onHeart={() => flip(lead.id)}
            height={200}
            wide
            badge={hot.data?.chosen ? 'Trending' : 'Coming up'}
          />
        ) : null}

        {cats.data?.length ? (
          <View>
            <Section title="Explore Categories" action="See all" onAction={() => router.push('/(tabs)/explore')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
              {cats.data.map((c) => (
                <Pressable
                  key={c.slug}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  onPress={() => router.push({ pathname: '/(tabs)/explore', params: { category: c.slug } })}
                >
                  <Cover uri={c.imageUrl} scrim style={styles.cat}>
                    <Text variant="small" weight="bold" color={colors.white} style={styles.catLabel} numberOfLines={2}>{c.label}</Text>
                  </Cover>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={{ gap: space.md }}>
          <Section title={city ? `Upcoming in ${city.city}` : 'Upcoming events'} action="See all" onAction={() => router.push('/(tabs)/explore')} />
          {upcoming.isLoading ? <Loading /> : upcoming.isError ? (
            <Failed message={messageFor(upcoming.error)} onRetry={() => { void upcoming.refetch(); }} />
          ) : upcoming.data?.length ? (
            upcoming.data.filter((e) => e.id !== lead?.id).map((e) => (
              <EventRow key={e.id} event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />
            ))
          ) : (
            <Empty
              icon="calendar"
              title={city ? `Nothing on in ${city.city} yet` : 'Nothing on yet'}
              body="Try another city, or explore everything on Eventsli."
              action="Change city"
              onAction={() => router.push('/city')}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coral500, borderWidth: 1.5, borderColor: colors.surface },
  city: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48,
    paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldBorder,
  },
  cats: { gap: space.md, paddingRight: space.lg },
  cat: { width: 96, height: 96, borderRadius: radius.md },
  catLabel: { position: 'absolute', left: 8, right: 8, bottom: 8 },
});
