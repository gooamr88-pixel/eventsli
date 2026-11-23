import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { savedEvents } from '@/api/endpoints';
import { useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { Empty, Failed, Loading } from '@/ui/bits';
import { EventRow } from '@/ui/EventCard';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * Saved Events — the hearts, from the account (GET /me/saved-events), so they
 * follow the person to a new phone. Unsaving here takes the row away after
 * the server agrees; a mistaken tap is one more tap on the event to undo.
 */
export default function Saved() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const { isSaved, flip } = useSaved();
  const q = useQuery({
    queryKey: ['saved', 'list'],
    queryFn: () => savedEvents(token as string).then((r) => r.data),
    enabled: Boolean(token),
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Text variant="screenTitle" style={styles.title} accessibilityRole="header">Saved Events</Text>
      {!token ? (
        <Empty icon="heart" title="Keep the ones you love" body="Sign in and tap the heart on any event. We will tell you if it moves or is cancelled." action="Sign In" onAction={() => router.push('/sign-in')} />
      ) : q.isLoading ? <Loading /> : q.isError ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
          renderItem={({ item }) => <EventRow event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} />}
          ListEmptyComponent={
            <Empty icon="heart" title="Nothing saved yet" body="Tap the heart on an event to keep it here." action="Explore events" onAction={() => router.push('/(tabs)/explore')} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { paddingHorizontal: space.lg, marginBottom: space.md },
  list: { padding: space.lg, flexGrow: 1 },
});
