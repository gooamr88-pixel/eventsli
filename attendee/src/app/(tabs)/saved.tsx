import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { savedEvents } from '@/api/endpoints';
import { useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { Empty, Failed } from '@/ui/bits';
import { EventPoster, EventRow } from '@/ui/EventCard';
import { Container, useLayout } from '@/ui/layout';
import { RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * Saved Events — the mockup's frame: the title, then each saved event as a
 * photo, its name and date, and the heart to unsave. From the account
 * (GET /me/saved-events), so the list follows the person to a new phone.
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
  const n = tablet ? Math.max(2, columns(240, space.lg)) : 1;
  const w = columnWidth(n, space.lg);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Text variant="title" align="center" accessibilityRole="header" style={styles.title}>Saved Events</Text>
      {!token ? (
        <Empty icon="heart" title="Keep the ones you love" body="Sign in and tap the heart on any event to keep it here." action="Sign In" onAction={() => router.push('/sign-in')} />
      ) : q.isLoading ? (
        <Container>{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</Container>
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
          ItemSeparatorComponent={() => <View style={{ height: n > 1 ? space.lg : space.sm }} />}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          renderItem={({ item }) => (n > 1
            ? <View style={{ width: w }}><EventPoster event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} /></View>
            : <EventRow event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} />)}
          ListEmptyComponent={<Empty icon="heart" title="Nothing saved yet" body="Tap the heart on an event to keep it here." action="Explore Events" onAction={() => router.push('/(tabs)/explore')} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { paddingVertical: space.md },
  list: { paddingTop: space.sm, paddingBottom: space.xxl, flexGrow: 1 },
});
