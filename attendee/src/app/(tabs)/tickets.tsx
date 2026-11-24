import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import type { Order } from '@/api/types';
import { useToken } from '@/auth/session';
import { isUpcoming, useTickets } from '@/hooks/useTickets';
import { dateBlock, eventDay, eventTime } from '@/lib/format';
import { Badge, Empty, Failed, ScreenTitle, Segmented } from '@/ui/bits';
import { Cover } from '@/ui/Cover';
import { Icon } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { CardSkeleton, Pressy } from '@/ui/motion';
import { Perforation } from '@/ui/Perforation';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

/**
 * My Tickets (the mockup's "My Tickets" frame): Upcoming and Past, one paper
 * ticket per order. Everything bought with this account, everything bought as
 * a guest with its address, and every ticket somebody transferred to it —
 * GET /tickets gathers all three. The list is cached for a day, so it opens in
 * a basement with no signal; the codes are drawn on the phone (QrCode.tsx).
 */
export default function Tickets() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const q = useTickets();
  const { columns, columnWidth, gutter } = useLayout();

  if (!token) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
        <Container><ScreenTitle title="My Tickets" /></Container>
        <Empty
          icon="ticket"
          title="Your tickets live here"
          body="Sign in to see the tickets you have booked — even ones bought as a guest with the same email."
          action="Sign In"
          onAction={() => router.push('/sign-in')}
          secondary="Create an account"
          onSecondary={() => router.push('/sign-up')}
        />
      </View>
    );
  }

  const orders = q.data ?? [];
  const upcoming = orders.filter((o) => isUpcoming(o)).sort((a, b) => Date.parse(a.event!.startsAt) - Date.parse(b.event!.startsAt));
  const past = orders.filter((o) => !isUpcoming(o));
  const shown = tab === 'upcoming' ? upcoming : past;
  const n = Math.min(3, columns(320, space.lg));
  const w = columnWidth(n, space.lg);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      <Container style={{ gap: space.md, paddingBottom: space.md }}>
        <ScreenTitle title="My Tickets" />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ''}` },
            { value: 'past', label: `Past${past.length ? ` (${past.length})` : ''}` },
          ]}
        />
      </Container>

      {q.isLoading ? (
        <Container style={{ gap: space.lg }}><CardSkeleton height={140} /><CardSkeleton height={140} /></Container>
      ) : q.isError && !q.data ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          key={`cols-${n}`}
          data={shown}
          numColumns={n}
          keyExtractor={(o) => o.orderId}
          contentContainerStyle={[styles.list, { paddingHorizontal: gutter }]}
          columnWrapperStyle={n > 1 ? { gap: space.lg } : undefined}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ItemSeparatorComponent={() => <View style={{ height: space.lg }} />}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 5) * 60).duration(260)} style={n > 1 ? { width: w } : undefined}>
              <OrderCard order={item} past={tab === 'past'} />
            </Animated.View>
          )}
          ListEmptyComponent={
            <Empty
              icon="ticket"
              title={tab === 'upcoming' ? 'No upcoming tickets' : 'No past tickets'}
              body={tab === 'upcoming' ? 'When you book an event, your tickets appear here — ready to scan at the door, even offline.' : 'Events you have been to will be kept here.'}
              action={tab === 'upcoming' ? 'Explore events' : undefined}
              onAction={tab === 'upcoming' ? () => router.push('/(tabs)/explore') : undefined}
            />
          }
        />
      )}
    </View>
  );
}

function OrderCard({ order, past }: { order: Order; past: boolean }) {
  const e = order.event;
  if (!e) return null;
  const { month, day } = dateBlock(e.startsAt, e.timezone);
  const usable = order.tickets.filter((t) => !t.transferredAway).length;
  const scanned = order.tickets.filter((t) => t.scannedAt).length;
  const where = [e.venue, e.city].filter(Boolean).join(', ');
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${eventDay(e.startsAt, e.timezone)}, ${usable} ticket${usable === 1 ? '' : 's'}. Show tickets`}
      onPress={() => router.push({ pathname: '/ticket/[orderId]', params: { orderId: order.orderId } })}
      style={[styles.card, shadow.raised, past && styles.cardPast]}
      scale={0.98}
    >
      <Cover uri={e.coverUrl ?? null} title={e.title} scrim style={styles.cover}>
        <View style={styles.coverTop}>
          <View style={styles.stamp}>
            <Text variant="caption" weight="bold" color={colors.accent} style={styles.stampMonth}>{month}</Text>
            <Text variant="title" style={styles.stampDay}>{day}</Text>
          </View>
          <View style={{ flex: 1 }} />
          {e.cancelled ? <Badge label="Cancelled" tone="dark" />
            : order.received ? <Badge label="Received" tone="highlight" icon="send" />
              : scanned && scanned === usable ? <Badge label="Checked in" tone="success" icon="check" /> : null}
        </View>
        <Text variant="title" color={colors.white} numberOfLines={2} style={styles.coverTitle}>{e.title}</Text>
      </Cover>
      <Perforation ground={colors.bg} />
      <View style={styles.cardBody}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.meta}><Icon name="clock" size={14} color={colors.muted} /><Text variant="caption" color={colors.muted}>{eventDay(e.startsAt, e.timezone)} · {eventTime(e.startsAt, e.timezone)}</Text></View>
          {where ? <View style={styles.meta}><Icon name="pin" size={14} color={colors.muted} /><Text variant="caption" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>{where}</Text></View> : null}
          <Text variant="small" weight="bold" color={e.cancelled ? colors.danger : colors.text}>
            {e.cancelled ? 'This event was cancelled' : `${usable} ticket${usable === 1 ? '' : 's'}`}
          </Text>
        </View>
        <View style={styles.qr}><Icon name="qr" size={26} color={colors.white} /></View>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingTop: space.sm, paddingBottom: space.xxl, flexGrow: 1 },
  card: { borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden' },
  cardPast: { opacity: 0.8 },
  cover: { height: 140 },
  coverTop: { flexDirection: 'row', alignItems: 'flex-start', padding: space.md },
  coverTitle: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.md },
  stamp: { minWidth: 48, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.md, backgroundColor: colors.white, alignItems: 'center' },
  stampMonth: { fontSize: 10, lineHeight: 12, letterSpacing: 0.6 },
  stampDay: { fontSize: 18, lineHeight: 21 },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg, paddingTop: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qr: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
});
