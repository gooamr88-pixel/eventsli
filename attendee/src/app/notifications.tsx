import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { messageFor } from '@/api/client';
import { markNotificationsRead, notifications } from '@/api/endpoints';
import type { AppNotification } from '@/api/types';
import { useToken } from '@/auth/session';
import { ago } from '@/lib/format';
import { Empty, Failed, Header } from '@/ui/bits';
import { Icon, type IconName } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { Mark } from '@/ui/Logo';
import { RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const ICON: Record<AppNotification['kind'], { icon: IconName; tint: string; bg: string }> = {
  tickets_issued: { icon: 'ticket', tint: colors.accent, bg: colors.coral50 },
  ticket_received: { icon: 'send', tint: colors.accent, bg: colors.coral50 },
  event_reminder: { icon: 'bell', tint: colors.onHighlight, bg: colors.sun100 },
  event_cancelled: { icon: 'alert', tint: colors.danger, bg: colors.dangerSoft },
  event_moved: { icon: 'calendar', tint: colors.warning, bg: colors.warningSoft },
  welcome: { icon: 'sparkle', tint: colors.accent, bg: colors.coral50 },
};

/**
 * The inbox (GET /me/notifications), split into New and Earlier. Opening it
 * marks everything read after a moment — long enough for the unread dots to
 * be seen, which is the point of them. A tap opens what the notice is about:
 * the ticket for a ticket, the event for news about an event.
 */
export default function Notifications() {
  const token = useToken();
  const qc = useQueryClient();
  const { gutter } = useLayout();
  const q = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notifications(token as string).then((r) => r.data),
    enabled: Boolean(token),
  });
  const read = useMutation({
    mutationFn: () => markNotificationsRead(token as string, { all: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const list = q.data ?? [];
  const anyUnread = list.some((n) => !n.read);
  useEffect(() => {
    if (!anyUnread) return undefined;
    const t = setTimeout(() => read.mutate(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyUnread]);

  const open = (n: AppNotification) => {
    if ((n.kind === 'tickets_issued' || n.kind === 'ticket_received' || n.kind === 'event_reminder') && n.orderId) {
      router.push({ pathname: '/ticket/[orderId]', params: { orderId: n.orderId } });
    } else if (n.kind === 'tickets_issued' || n.kind === 'ticket_received') router.push('/(tabs)/tickets');
    else if (n.eventSlug) router.push({ pathname: '/event/[slug]', params: { slug: n.eventSlug } });
  };

  const fresh = list.filter((n) => !n.read);
  const earlier = list.filter((n) => n.read);
  const sections = [
    ...(fresh.length ? [{ title: 'New', data: fresh }] : []),
    ...(earlier.length ? [{ title: 'Earlier', data: earlier }] : []),
  ];

  return (
    <View style={styles.root}>
      <Header
        title="Notifications"
        right={anyUnread ? (
          <Pressable accessibilityRole="button" onPress={() => read.mutate()} hitSlop={8}>
            <Text variant="small" weight="semibold" color={colors.accent}>Read all</Text>
          </Pressable>
        ) : undefined}
      />
      {!token ? (
        <Empty icon="bell" title="Sign in for updates" body="Reminders, ticket confirmations, and news about events you saved." action="Sign In" onAction={() => router.push('/sign-in')} />
      ) : q.isLoading ? (
        <Container style={{ gap: space.md, paddingTop: space.md }}>{[0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}</Container>
      ) : q.isError ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          contentContainerStyle={[{ flexGrow: 1, paddingBottom: space.xxl, paddingHorizontal: gutter }]}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          renderSectionHeader={({ section }) => <Text variant="overline" color={colors.muted} style={styles.sectionHead}>{section.title.toUpperCase()}</Text>}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          renderItem={({ item, index }) => {
            const look = ICON[item.kind] ?? ICON.welcome;
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 40).duration(220)}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}. ${ago(item.createdAt)}`} onPress={() => open(item)}
                  style={({ pressed }) => [styles.row, !item.read && styles.rowUnread, pressed && { opacity: 0.85 }]}>
                  <View style={[styles.icon, { backgroundColor: look.bg }]}>
                    {item.coverUrl ? <Image source={{ uri: item.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
                      : item.kind === 'welcome' ? <Mark size={24} /> : <Icon name={look.icon} size={20} color={look.tint} />}
                    {item.coverUrl ? <View style={[styles.kind, { backgroundColor: look.bg }]}><Icon name={look.icon} size={11} color={look.tint} strokeWidth={2.2} /></View> : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" weight={item.read ? 'semibold' : 'bold'} numberOfLines={2}>{item.title}</Text>
                    <Text variant="small" color={colors.muted} numberOfLines={3}>{item.body}</Text>
                    <Text variant="caption" color={colors.subtle}>{ago(item.createdAt)}</Text>
                  </View>
                  {!item.read ? <View style={styles.dot} /> : null}
                </Pressable>
              </Animated.View>
            );
          }}
          ListEmptyComponent={<Empty icon="bell" title="All quiet" body="Ticket confirmations, reminders and news about events you saved will appear here." />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sectionHead: { marginTop: space.lg, marginBottom: space.sm, marginLeft: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  rowUnread: { borderColor: colors.coral200, backgroundColor: '#fffafa' },
  icon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  kind: { position: 'absolute', right: 2, bottom: 2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral500, marginTop: 6 },
});
