import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { markNotificationsRead, notifications } from '@/api/endpoints';
import type { AppNotification } from '@/api/types';
import { useToken } from '@/auth/session';
import { ago } from '@/lib/format';
import { imageUrl } from '@/lib/images';
import { Empty, Failed, Header } from '@/ui/bits';
import { Icon, type IconName } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { Mark } from '@/ui/Logo';
import { RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

const ICON: Record<AppNotification['kind'], IconName> = {
  tickets_issued: 'ticket',
  ticket_received: 'send',
  event_reminder: 'bell',
  event_cancelled: 'alert',
  event_moved: 'calendar',
  welcome: 'sparkle',
};

/**
 * Notifications — the mockup's frame: a round picture, the title in bold,
 * the message, how long ago, and a red dot while unread. Opening the screen
 * marks everything read after a moment, long enough for the dots to be seen.
 * A tap opens what the notice is about.
 */
export default function Notifications() {
  const token = useToken();
  const qc = useQueryClient();
  const { gutter } = useLayout();
  const q = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notifications(token as string).then((r) => r.data),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const read = useMutation({
    mutationFn: () => markNotificationsRead(token as string, { all: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const anyUnread = (q.data ?? []).some((n) => !n.read);
  useEffect(() => {
    if (!anyUnread) return undefined;
    const t = setTimeout(() => read.mutate(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyUnread]);

  const open = (n: AppNotification) => {
    if (n.orderId && (n.kind === 'tickets_issued' || n.kind === 'ticket_received' || n.kind === 'event_reminder')) {
      router.push({ pathname: '/ticket/[orderId]', params: { orderId: n.orderId } });
    } else if (n.kind === 'tickets_issued' || n.kind === 'ticket_received') router.push('/(tabs)/tickets');
    else if (n.eventSlug) router.push({ pathname: '/event/[slug]', params: { slug: n.eventSlug } });
  };

  return (
    <View style={styles.root}>
      <Header title="Notifications" />
      {!token ? (
        <Empty icon="bell" title="Sign in for updates" body="Reminders, ticket confirmations, and news about events you saved." action="Sign In" onAction={() => router.push('/sign-in')} />
      ) : q.isLoading ? (
        <Container>{[0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}</Container>
      ) : q.isError ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: space.xxl, paddingHorizontal: gutter }}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ItemSeparatorComponent={() => <View style={styles.rule} />}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}. ${ago(item.createdAt)}`}
              onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
              <View style={styles.icon}>
                {item.kind === 'welcome' ? <Mark size={24} />
                  : item.coverUrl ? <Image source={{ uri: imageUrl(item.coverUrl, 48) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
                    : <Icon name={ICON[item.kind] ?? 'bell'} size={22} color={colors.accent} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight="bold" numberOfLines={2}>{item.title}</Text>
                <Text variant="small" numberOfLines={3}>{item.body}</Text>
                <Text variant="caption" color={colors.muted}>{ago(item.createdAt)}</Text>
              </View>
              {!item.read ? <View style={styles.dot} /> : null}
            </Pressable>
          )}
          ListEmptyComponent={<Empty icon="bell" title="All quiet" body="Ticket confirmations and reminders will appear here." />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg, paddingVertical: space.lg },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  rule: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent, marginTop: 6 },
});
