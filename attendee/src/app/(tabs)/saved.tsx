import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { savedEvents } from '@/api/endpoints';
import { useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { Empty, Failed, ScreenTitle } from '@/ui/bits';
import { EventPoster, EventRow } from '@/ui/EventCard';
import { Container, useLayout } from '@/ui/layout';
import { RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * Saved Events — the hearts, from the account (GET /me/saved-events), so they
 * follow the person to a new phone. Upcoming first, then the ones that have
 * passed, which are kept but dimmed by their own "Past event" tag. Unsaving
 * here takes the row away after the server agrees; a mistaken tap is one more
 * tap on the event to undo.
 */
export default function Saved() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const { isSaved, flip } = useSaved();
  const { tablet, columns, columnWidth, gutter } = useLayout();
  const q = useQuery({
    queryKey: ['saved', 'list'],
    queryFn: () => savedEvents(token as string).then((r) => r.data),
    enabled: Boolean(token),
  });

  const list = [...(q.data ?? [])].sort((a, b) => Number(a.isPast) - Number(b.isPast) || Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const n = tablet ? Math.max(2, columns(250, space.lg)) : 1;
  const w = columnWidth(n, space.lg);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      <Container>
        <ScreenTitle title="Saved Events" right={list.length ? <Text variant="small" weight="semibold" color={colors.muted}>{list.length} saved</Text> : undefined} />
      </Container>
      {!token ? (
        <Empty icon="heart" title="Keep the ones you love" body="Sign in and tap the heart on any event. We will tell you if it moves or is cancelled." action="Sign In" onAction={() => router.push('/sign-in')} />
      ) : q.isLoading ? (
        <Container style={{ gap: space.md, paddingTop: space.md }}>{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</Container>
      ) : q.isError ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          key={`cols-${n}`}
          data={list}
          numColumns={n}
          keyExtractor={(e) => e.id}
          contentContainerStyle={[styles.list, { paddingHorizontal: gutter }]}
          columnWrapperStyle={n > 1 ? { gap: space.lg } : undefined}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ItemSeparatorComponent={() => <View style={{ height: n > 1 ? space.lg : space.md }} />}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 50).duration(240)} style={n > 1 ? { width: w } : undefined}>
              {n > 1 ? <EventPoster event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} />
                : <EventRow event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} />}
            </Animated.View>
          )}
          ListEmptyComponent={
            <Empty icon="heart" title="Nothing saved yet" body="Tap the heart on an event to keep it here. We will remind you before it starts." action="Explore events" onAction={() => router.push('/(tabs)/explore')} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingTop: space.md, paddingBottom: space.xxl, flexGrow: 1 },
});
