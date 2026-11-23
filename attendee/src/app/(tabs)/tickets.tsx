import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import type { Order } from '@/api/types';
import { useToken } from '@/auth/session';
import { isUpcoming, useTickets } from '@/hooks/useTickets';
import { dateBlock, eventTime } from '@/lib/format';
import { Empty, Failed, Loading } from '@/ui/bits';
import { Cover } from '@/ui/Cover';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

/**
 * My Tickets (the mockup's "My Tickets" frame): Upcoming and Past, one card
 * per order. Everything bought with this account, everything bought as a
 * guest with its address, and every ticket somebody transferred to it —
 * GET /tickets gathers all three.
 */
export default function Tickets() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const q = useTickets();

  if (!token) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
        <Text variant="screenTitle" style={styles.title} accessibilityRole="header">My Tickets</Text>
        <Empty icon="ticket" title="Your tickets live here" body="Sign in to see the tickets you have booked — even ones bought as a guest with the same email." action="Sign In" onAction={() => router.push('/sign-in')} />
      </View>
    );
  }

  const orders = q.data ?? [];
  const upcoming = orders.filter((o) => isUpcoming(o)).sort((a, b) => Date.parse(a.event!.startsAt) - Date.parse(b.event!.startsAt));
  const past = orders.filter((o) => !isUpcoming(o));
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Text variant="screenTitle" style={styles.title} accessibilityRole="header">My Tickets</Text>
      <View style={styles.segment} accessibilityRole="tablist">
        {(['upcoming', 'past'] as const).map((t) => {
          const on = tab === t;
          const n = t === 'upcoming' ? upcoming.length : past.length;
          return (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(t)} style={[styles.segmentItem, on && styles.segmentOn]}>
              <Text variant="small" weight="semibold" color={on ? colors.onAccent : colors.text}>
                {t === 'upcoming' ? 'Upcoming' : 'Past'}{n ? ` (${n})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {q.isLoading ? <Loading /> : q.isError && !q.data ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(o) => o.orderId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ItemSeparatorComponent={() => <View style={{ height: space.lg }} />}
          renderItem={({ item }) => <OrderCard order={item} />}
          ListEmptyComponent={
            <Empty
              icon="ticket"
              title={tab === 'upcoming' ? 'No upcoming tickets' : 'No past tickets'}
              body={tab === 'upcoming' ? 'When you book an event, your tickets appear here.' : undefined}
              action={tab === 'upcoming' ? 'Explore events' : undefined}
              onAction={tab === 'upcoming' ? () => router.push('/(tabs)/explore') : undefined}
            />
          }
        />
      )}
    </View>
  );
}

function OrderCard({ order }: { order: Order }) {
  const e = order.event;
  if (!e) return null;
  const { month, day } = dateBlock(e.startsAt, e.timezone);
  const usable = order.tickets.filter((t) => !t.transferredAway).length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${month} ${day}, ${usable} ticket${usable === 1 ? '' : 's'}`}
      onPress={() => router.push({ pathname: '/ticket/[orderId]', params: { orderId: order.orderId } })}
      style={({ pressed }) => [styles.card, shadow.card, pressed && { opacity: 0.9 }]}
    >
      <Cover uri={null} title={e.title} style={styles.cover} />
      <View style={styles.cardBody}>
        <View style={styles.date}>
          <Text variant="caption" weight="bold" color={colors.accent}>{month}</Text>
          <Text variant="title">{day}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold" numberOfLines={1}>{e.title}</Text>
          <Text variant="caption" color={colors.muted} numberOfLines={1}>{eventTime(e.startsAt, e.timezone)}{e.venue ? ` · ${e.venue}` : ''}</Text>
          <Text variant="caption" weight="semibold" color={e.cancelled ? colors.danger : colors.text}>
            {e.cancelled ? 'Cancelled' : `${usable} ticket${usable === 1 ? '' : 's'}${order.received ? ' · received' : ''}`}
          </Text>
        </View>
        <Icon name="qr" size={26} color={colors.text} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { paddingHorizontal: space.lg, marginBottom: space.md },
  segment: { flexDirection: 'row', marginHorizontal: space.lg, padding: 4, borderRadius: radius.pill, backgroundColor: colors.bgSunken, marginBottom: space.md },
  segmentItem: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  list: { padding: space.lg, flexGrow: 1 },
  card: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  cover: { height: 96 },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  date: { width: 48, alignItems: 'center', paddingVertical: 4, borderRadius: radius.md, backgroundColor: colors.wash },
});
