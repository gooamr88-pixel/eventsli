import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { markNotificationsRead, notifications } from '@/api/endpoints';
import type { AppNotification } from '@/api/types';
import { useToken } from '@/auth/session';
import { ago } from '@/lib/format';
import { Empty, Failed, Header, Loading } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Mark } from '@/ui/Logo';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const ICON: Record<AppNotification['kind'], IconName> = {
  tickets_issued: 'ticket',
  ticket_received: 'ticket',
  event_reminder: 'bell',
  event_cancelled: 'alert',
  event_moved: 'calendar',
  welcome: 'sparkle',
};

/**
 * The inbox (GET /me/notifications). Opening it marks everything read after a
 * moment — long enough for the unread dots to be seen, which is the point of
 * them. A tap opens what the notice is about.
 */
export default function Notifications() {
  const token = useToken();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notifications(token as string).then((r) => r.data),
    enabled: Boolean(token),
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
    if (n.kind === 'tickets_issued' || n.kind === 'ticket_received' || n.kind === 'event_reminder') router.push('/(tabs)/tickets');
    else if (n.eventSlug) router.push({ pathname: '/event/[slug]', params: { slug: n.eventSlug } });
  };

  return (
    <View style={styles.root}>
      <Header title="Notifications" back />
      {!token ? (
        <Empty icon="bell" title="Sign in for updates" body="Reminders, ticket confirmations, and news about events you saved." action="Sign In" onAction={() => router.push('/sign-in')} />
      ) : q.isLoading ? <Loading /> : q.isError ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => open(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgSunken }]}>
              <View style={styles.icon}>
                {item.kind === 'welcome' ? <Mark size={22} /> : <Icon name={ICON[item.kind]} size={20} color={colors.accent} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight={item.read ? 'medium' : 'bold'}>{item.title}</Text>
                <Text variant="small" color={colors.muted}>{item.body}</Text>
                <Text variant="caption" color={colors.subtle}>{ago(item.createdAt)}</Text>
              </View>
              {!item.read ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
            </Pressable>
          )}
          ListEmptyComponent={<Empty icon="bell" title="All quiet" body="Ticket confirmations and reminders will appear here." />}
          ListFooterComponent={anyUnread ? <Button label="Mark all as read" variant="ghost" onPress={() => read.mutate()} /> : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coral500, marginTop: 6 },
});
