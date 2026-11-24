import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { categories, listEvents, notifications, savedEvents, trending } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useNearMe } from '@/hooks/useNearMe';
import { useSaved } from '@/hooks/useSaved';
import { distanceText } from '@/lib/location';
import { asCard, useRecent } from '@/lib/recent';
import { buildShelves } from '@/lib/shelves';
import { whenRange } from '@/lib/when';
import { Empty, Failed, IconButton, Section } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { CategoryTile } from '@/ui/CategoryTile';
import { EventPoster, EventRow, EventTile } from '@/ui/EventCard';
import { EventRail } from '@/ui/EventRail';
import { Icon } from '@/ui/Icon';
import { Container, Grid, useLayout } from '@/ui/layout';
import { Logo } from '@/ui/Logo';
import { RowSkeleton, Skeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/** "Good evening" by the phone's clock. */
function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return 'Good evening';
  if (hour < 12) return 'Good morning';
  return 'Good afternoon';
}

/**
 * Home — the mockup's frame (logo and bell, the city, search, Trending,
 * Explore Categories), then rows that make it worth opening every day:
 * Near You, Recently Viewed, This Weekend, Recommended for You, Popular,
 * Free Events, and All Events at the end.
 *
 * NO REPEATS (lib/shelves.ts): an event sits in the first row that wants it
 * and no other, a row with fewer than two is dropped, and everything left
 * over is in All Events — with ten events on the site, the same gala had
 * been on four rows (2026-11-24, seen in a phone-size render).
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const city = useSession((s) => s.city);
  const user = useSession((s) => s.account?.user);
  const { isSaved, flip } = useSaved();
  const { tablet, inner, columnWidth, gutter } = useLayout();
  const recent = useRecent((s) => s.items);
  useEffect(() => { void useRecent.getState().load(); }, []);
  const nearMe = useNearMe();

  const where = city?.city;
  const hot = useQuery({ queryKey: ['trending'], queryFn: trending });
  const cats = useQuery({ queryKey: ['categories'], queryFn: categories, staleTime: 3_600_000 });
  const upcoming = useQuery({
    queryKey: ['events', 'upcoming', where ?? null],
    queryFn: () => listEvents({ city: where, ticketedFirst: true, limit: 30 }, token).then((r) => r.data),
  });
  const weekend = useQuery({
    queryKey: ['events', 'weekend', where ?? null],
    queryFn: () => listEvents({ city: where, limit: 10, ...whenRange('weekend') }, token).then((r) => r.data),
  });
  const free = useQuery({
    queryKey: ['events', 'free', where ?? null],
    queryFn: () => listEvents({ city: where, limit: 10, maxPrice: 0 }, token).then((r) => r.data),
  });
  const saved = useQuery({ queryKey: ['saved', 'list'], queryFn: () => savedEvents(token as string).then((r) => r.data), enabled: Boolean(token) });
  const favourite = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of saved.data ?? []) if (e.category) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [saved.data]);
  const forYou = useQuery({
    queryKey: ['events', 'for-you', favourite, where ?? null],
    enabled: Boolean(favourite),
    queryFn: () => listEvents({ category: favourite!, city: where, limit: 12 }, token).then((r) => r.data),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notifications(token as string, 1).then((r) => Number(r.meta?.unread ?? 0)),
    enabled: Boolean(token),
    staleTime: 30_000,
  });

  const leads: EventCard[] = (hot.data?.events ?? []).slice(0, 5);
  const savedIds = new Set((saved.data ?? []).map((e) => e.id));
  const { shelves, rest } = buildShelves([
    { key: 'near', events: nearMe.near.data?.events },
    { key: 'weekend', events: weekend.data },
    { key: 'forYou', events: (forYou.data ?? []).filter((e) => !savedIds.has(e.id)) },
    { key: 'popular', events: upcoming.data?.slice(0, 10) },
    { key: 'free', events: free.data },
  ], upcoming.data ?? []);
  const bannerW = tablet ? columnWidth(2, space.lg) : inner;
  const firstName = user?.fullName?.split(/\s+/)[0];

  const refresh = () => {
    void hot.refetch(); void upcoming.refetch(); void weekend.refetch(); void free.refetch(); void cats.refetch();
    if (favourite) void forYou.refetch();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: space.sm, paddingBottom: space.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl tintColor={colors.accent} refreshing={hot.isRefetching || upcoming.isRefetching} onRefresh={refresh} />}
      >
        <Container style={{ gap: space.lg }}>
          <View style={styles.topRow}>
            <Logo height={26} />
            <View>
              <IconButton icon="bell" size={24} label={unread.data ? `Notifications, ${unread.data} unread` : 'Notifications'} onPress={() => router.push(token ? '/notifications' : '/sign-in')} />
              {unread.data ? <View style={styles.dot} /> : null}
            </View>
          </View>

          <Animated.View entering={FadeInDown.duration(320)} style={{ gap: 2 }}>
            <Text variant="small" color={colors.muted}>{firstName ? `${greeting(new Date().getHours())}, ${firstName} 👋` : 'Discover events in'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`City: ${where ?? 'Everywhere'}. Change city`} onPress={() => router.push('/city')} style={styles.city} hitSlop={8}>
              <Icon name="pin" size={20} color={colors.accent} strokeWidth={2.2} />
              <Text variant="heading">{where ?? 'Everywhere'}</Text>
              <Icon name="chevronDown" size={18} strokeWidth={2.2} />
            </Pressable>
          </Animated.View>

          <Pressable accessibilityRole="search" accessibilityLabel="Search events" onPress={() => router.push({ pathname: '/(tabs)/explore', params: { focus: String(Date.now()) } })} style={styles.search}>
            <Icon name="search" size={20} color={colors.muted} />
            <Text variant="body" color={colors.placeholder}>Search events...</Text>
          </Pressable>
        </Container>

        <View style={{ marginTop: space.lg }}>
          {hot.isLoading ? (
            <Container><Skeleton height={200} round={radius.lg} /></Container>
          ) : leads.length ? (
            <Trending events={leads} chosen={Boolean(hot.data?.chosen)} width={bannerW} height={tablet ? 240 : 200} />
          ) : null}
        </View>

        {cats.data?.length ? (
          <View style={{ marginTop: space.xl }}>
            <Container>
              <Section title="Explore Categories" action="See all" onAction={() => router.push('/(tabs)/explore')} />
            </Container>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.cats, { paddingHorizontal: gutter }]}>
              {cats.data.map((c, i) => (
                <CategoryTile key={c.slug} category={c} index={i} size="small" onPress={() => router.push({ pathname: '/(tabs)/explore', params: { category: c.slug } })} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <NearYou nearMe={nearMe} events={shelves.near} isSaved={isSaved} flip={flip} />

        <EventRail title="Recently Viewed" events={recent.length >= 2 ? recent.map(asCard) : []} isSaved={isSaved} flip={flip} width={160}
          action="Clear" onAction={() => useRecent.getState().clear()} />
        <EventRail title="This Weekend" events={shelves.weekend} loading={weekend.isLoading} isSaved={isSaved} flip={flip} />
        <EventRail title="Recommended for You" events={shelves.forYou} loading={forYou.isLoading && Boolean(favourite)} isSaved={isSaved} flip={flip}
          action={favourite ? 'More' : undefined} onAction={favourite ? () => router.push({ pathname: '/(tabs)/explore', params: { category: favourite } }) : undefined} />
        <EventRail title={where ? `Popular in ${where}` : 'Popular Events'} events={shelves.popular} loading={upcoming.isLoading} isSaved={isSaved} flip={flip}
          action="See all" onAction={() => router.push('/(tabs)/explore')} />
        <EventRail title="Free Events" events={shelves.free} loading={free.isLoading} isSaved={isSaved} flip={flip} />

        <Container style={{ marginTop: space.xl }}>
          {upcoming.isError ? (
            <Failed message={messageFor(upcoming.error)} onRetry={() => { void upcoming.refetch(); }} />
          ) : upcoming.isLoading ? (
            <View>{[0, 1].map((i) => <RowSkeleton key={i} />)}</View>
          ) : !(upcoming.data ?? []).length && !leads.length ? (
            <Empty icon="calendar" title={where ? `Nothing on in ${where} yet` : 'Nothing on yet'} body="Try another city." action="Change city" onAction={() => router.push('/city')} />
          ) : rest.length ? (
            <>
              <Section title="All Events" action="See all" onAction={() => router.push('/(tabs)/explore')} style={{ marginBottom: space.xs }} />
              {tablet ? (
                <Grid min={220} gap={space.lg}>{rest.map((e) => <EventPoster key={e.id} event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />)}</Grid>
              ) : rest.map((e) => <EventRow key={e.id} event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />)}
            </>
          ) : null}
        </Container>
      </ScrollView>
    </View>
  );
}

/**
 * NEAR YOU — events around the phone, nearest first, each with how far it is.
 * Allowed once, it fills itself every time Home opens (hooks/useNearMe); not
 * yet allowed, it is a card that asks in the app's words first; refused, it
 * points to Settings.
 */
function NearYou({ nearMe, events, isSaved, flip }: {
  nearMe: ReturnType<typeof useNearMe>; events: EventCard[]; isSaved: (id: string) => boolean; flip: (id: string) => void;
}) {
  const { status, busy, enable, near } = nearMe;
  if (status === 'checking') return null;

  const card = (title: string, body: string, button: React.ReactNode) => (
    <Container style={{ marginTop: space.xl }}>
      <Animated.View entering={FadeInDown.duration(300)} style={styles.nearCard}>
        <View style={styles.nearIcon}><Icon name="locate" size={24} color={colors.accent} strokeWidth={2.2} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold">{title}</Text>
          <Text variant="small" color={colors.muted}>{body}</Text>
        </View>
        {button}
      </Animated.View>
    </Container>
  );

  if (status === 'ask') return card('Find events near you', 'See what is happening around you, nearest first.', <Button label="Turn on" size="sm" busy={busy} onPress={() => { void enable(); }} />);
  if (status === 'denied') return card('Find events near you', 'Location is off for Eventsli. Turn it on in Settings.', <Button label="Settings" size="sm" variant="secondary" onPress={() => { void Linking.openSettings(); }} />);

  const answer = near.data;
  if (answer && !answer.events.length) {
    return card('Nothing near you yet', `No events within ${answer.radiusKm} km right now.`, <Button label="City" size="sm" variant="secondary" onPress={() => router.push('/city')} />);
  }
  return (
    <EventRail
      title="Near You"
      header={answer?.nearest ? `Around ${answer.nearest.city}` : undefined}
      events={events}
      loading={near.isLoading}
      isSaved={isSaved}
      flip={flip}
      distanceOf={(e) => distanceText(e.distanceKm)}
      action="See all"
      onAction={() => router.push({ pathname: '/(tabs)/explore', params: { near: String(Date.now()) } })}
    />
  );
}

/** The Trending banners to swipe, with the page dots under them. */
function Trending({ events, chosen, width, height }: { events: EventCard[]; chosen: boolean; width: number; height: number }) {
  const { gutter } = useLayout();
  const [page, setPage] = useState(0);
  const step = width + space.md;
  return (
    <View style={{ gap: space.md }}>
      <FlatList
        horizontal
        data={events}
        keyExtractor={(e) => e.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}
        onMomentumScrollEnd={(ev) => setPage(Math.round(ev.nativeEvent.contentOffset.x / step))}
        renderItem={({ item }) => <EventTile event={item} badge={chosen ? 'Trending' : 'Coming up'} height={height} style={{ width }} />}
      />
      {events.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {events.map((e, i) => <View key={e.id} style={[styles.pageDot, i === page && styles.pageDotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dot: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent, borderWidth: 1.5, borderColor: colors.white },
  city: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.lg, borderRadius: 12, backgroundColor: colors.bgSunken },
  cats: { gap: space.sm },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  pageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  pageDotOn: { width: 18, backgroundColor: colors.accent },
  nearCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: 16, backgroundColor: colors.coral50 },
  nearIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
