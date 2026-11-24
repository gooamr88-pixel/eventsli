import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import type { Order } from '@/api/types';
import { useToken } from '@/auth/session';
import { isUpcoming, useTickets } from '@/hooks/useTickets';
import { eventWhen } from '@/lib/format';
import { Empty, Failed, Segmented } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Icon } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { Skeleton } from '@/ui/motion';
import { QrCode } from '@/ui/QrCode';
import { Text } from '@/ui/Text';
import { colors, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * My Tickets — the mockup's frame: "Upcoming (1) | Past", then each ticket
 * as its event's photo with a white card over it — the name, the date, the
 * place, the QR code itself, the ticket number — and Add to Calendar and
 * Share Ticket under it. The code is drawn on the phone (QrCode.tsx) and the
 * list is cached, so it shows at a door with no signal.
 *
 * An order of several tickets shows the first here; the card opens all of
 * them, one QR each.
 */
export default function Tickets() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const q = useTickets();
  const { gutter, tablet } = useLayout();

  const title = (
    <Text variant="title" align="center" accessibilityRole="header" style={styles.title}>My Tickets</Text>
  );

  if (!token) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {title}
        <Empty icon="ticket" title="Your tickets live here" body="Sign in to see the tickets you booked — even ones bought as a guest with the same email."
          action="Sign In" onAction={() => router.push('/sign-in')} secondary="Create an account" onSecondary={() => router.push('/sign-up')} />
      </View>
    );
  }

  const orders = q.data ?? [];
  const upcoming = orders.filter((o) => isUpcoming(o)).sort((a, b) => Date.parse(a.event!.startsAt) - Date.parse(b.event!.startsAt));
  const past = orders.filter((o) => !isUpcoming(o));
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {title}
      <Container>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ''}` },
            { value: 'past', label: `Past${past.length ? ` (${past.length})` : ''}` },
          ]}
          style={{ marginBottom: space.md }}
        />
      </Container>

      {q.isLoading ? (
        <Container style={{ gap: space.md }}><Skeleton height={130} round={16} /><Skeleton height={300} round={16} /></Container>
      ) : q.isError && !q.data ? (
        <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(o) => o.orderId}
          contentContainerStyle={[styles.list, { paddingHorizontal: gutter }, tablet && { alignItems: 'center' }]}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
          ItemSeparatorComponent={() => <View style={{ height: tab === 'upcoming' ? space.xxl : 0 }} />}
          renderItem={({ item }) => (tab === 'upcoming' ? <TicketCard order={item} /> : <PastRow order={item} />)}
          ListEmptyComponent={
            <Empty
              icon="ticket"
              title={tab === 'upcoming' ? 'No upcoming tickets' : 'No past tickets'}
              body={tab === 'upcoming' ? 'When you book an event, your tickets appear here.' : undefined}
              action={tab === 'upcoming' ? 'Explore Events' : undefined}
              onAction={tab === 'upcoming' ? () => router.push('/(tabs)/explore') : undefined}
            />
          }
        />
      )}
    </View>
  );
}

function TicketCard({ order }: { order: Order }) {
  const e = order.event!;
  const live = order.tickets.filter((t) => !t.transferredAway);
  const first = live.find((t) => t.qr) ?? live[0];
  const more = live.length - 1;
  const open = () => router.push({ pathname: '/ticket/[orderId]', params: { orderId: order.orderId } });

  const addToCalendar = () => {
    createEventInCalendarAsync({
      title: e.title,
      startDate: new Date(e.startsAt),
      endDate: new Date(e.endsAt || Date.parse(e.startsAt) + 3 * 3_600_000),
      location: [e.venue, e.city].filter(Boolean).join(', ') || undefined,
      url: `${SITE}/e/${e.slug}`,
      timeZone: e.timezone ?? undefined,
    }).catch(() => undefined);
  };

  return (
    <View style={styles.ticket}>
      <Cover uri={e.coverUrl ?? null} title={e.title} style={styles.banner} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}. Show ${live.length > 1 ? `all ${live.length} tickets` : 'the ticket'}`} onPress={open} style={[styles.card, shadow.raised]}>
        <Text variant="title" align="center" numberOfLines={2}>{e.title}</Text>
        <Text variant="small" align="center">{eventWhen(e.startsAt, e.timezone)}</Text>
        {e.venue ? (
          <View style={styles.venue}>
            <Text variant="small" align="center" numberOfLines={1}>{e.venue}</Text>
            <Icon name="chevronRight" size={16} />
          </View>
        ) : null}
        {e.cancelled ? (
          <Text variant="small" weight="bold" color={colors.accent} align="center" style={{ marginVertical: space.lg }}>This event was cancelled</Text>
        ) : first?.qr ? (
          <View style={styles.qr}><QrCode value={first.qr} size={170} /></View>
        ) : (
          <View style={[styles.qr, styles.noQr]}><Text variant="small" color={colors.muted} align="center">No code yet</Text></View>
        )}
        {first ? <Text variant="small" align="center">Ticket #{first.id.slice(0, 8).toUpperCase()}</Text> : null}
        {more > 0 ? <Text variant="small" weight="bold" color={colors.accent} align="center">+ {more} more ticket{more === 1 ? '' : 's'}</Text> : null}
      </Pressable>
      <View style={styles.actions}>
        <Button label="Add to Calendar" icon="calendarPlus" variant="soft" onPress={addToCalendar} />
        <Button label="Share Ticket" icon="share" variant="soft" onPress={() => { void Share.share({ message: `I'm going to ${e.title} — ${SITE}/e/${e.slug}` }); }} />
      </View>
    </View>
  );
}

/** A past order: just the row, as Saved shows events. */
function PastRow({ order }: { order: Order }) {
  const e = order.event!;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/ticket/[orderId]', params: { orderId: order.orderId } })} style={styles.past}>
      <Cover uri={e.coverUrl ?? null} title={e.title} style={styles.pastThumb} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight="bold" numberOfLines={1}>{e.title}</Text>
        <Text variant="small" color={colors.muted}>{eventWhen(e.startsAt, e.timezone)}</Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.subtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { paddingVertical: space.md },
  list: { paddingBottom: space.xxl, flexGrow: 1 },
  ticket: { width: '100%', maxWidth: 480 },
  banner: { height: 130, borderRadius: 16 },
  card: { marginTop: -28, marginHorizontal: space.md, backgroundColor: colors.white, borderRadius: 16, paddingVertical: space.lg, paddingHorizontal: space.lg, gap: 3, alignItems: 'center' },
  venue: { flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '100%' },
  qr: { marginVertical: space.md, padding: 4, backgroundColor: colors.white },
  noQr: { width: 170, height: 170, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSunken, borderRadius: 12 },
  actions: { gap: space.sm, marginTop: space.lg },
  past: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.sm },
  pastThumb: { width: 64, height: 64, borderRadius: 12 },
});
