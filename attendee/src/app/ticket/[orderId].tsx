// The system's "add event" sheet. SDK 58 moved it to /legacy; the root export
// is now a stub that throws at runtime (expo-calendar/build/legacyWarnings).
import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';

import { messageFor } from '@/api/client';
import type { Ticket } from '@/api/types';
import { useTickets } from '@/hooks/useTickets';
import { eventWhen } from '@/lib/format';
import { Empty, Failed, Header, Loading } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { QrCode } from '@/ui/QrCode';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/** "Section A · Row 5 · Seat 12", "Table 4", or the ticket type for general admission. */
function place(t: Ticket): string {
  const parts: string[] = [];
  if (t.table) parts.push(`Table ${t.table}`);
  if (t.seat) {
    if (t.seat.section) parts.push(String(t.seat.section));
    if (t.seat.row) parts.push(`Row ${t.seat.row}`);
    if (t.seat.number !== null && t.seat.number !== undefined) parts.push(`Seat ${t.seat.number}`);
  }
  return parts.join(' · ');
}

/**
 * One order's tickets, a QR each, swiped through. The codes are drawn on the
 * phone from what My Tickets already fetched, so this screen opens with no
 * signal (see QrCode.tsx).
 *
 * A ticket given away shows no code — the buyer's copy stops working the
 * moment it is transferred, and the screen says so rather than showing a code
 * that will be refused at the door.
 */
export default function TicketScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { width } = useWindowDimensions();
  const q = useTickets();
  const [page, setPage] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  if (q.isLoading) return <View style={styles.root}><Header title="Ticket" back /><Loading /></View>;
  const order = q.data?.find((o) => o.orderId === orderId);
  if (!order || !order.event) {
    return (
      <View style={styles.root}>
        <Header title="Ticket" back />
        {q.isError ? <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
          : <Empty icon="ticket" title="Ticket not found" body="It may have been transferred to someone else." />}
      </View>
    );
  }

  const e = order.event;
  const tickets = order.tickets;
  const cardWidth = width - space.lg * 2;

  async function addToCalendar() {
    setNote(null);
    try {
      // The system's own "add event" sheet: no calendar permission, and the
      // person sees exactly what is being added before it is.
      await createEventInCalendarAsync({
        title: e.title,
        startDate: new Date(e.startsAt),
        endDate: new Date(e.endsAt || Date.parse(e.startsAt) + 3 * 3_600_000),
        location: e.venue ?? undefined,
        url: `${SITE}/e/${e.slug}`,
        timeZone: e.timezone ?? undefined,
      });
    } catch {
      setNote('Your calendar could not be opened.');
    }
  }

  return (
    <View style={styles.root}>
      <Header title={e.title} back />
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="small" color={colors.muted} align="center">{eventWhen(e.startsAt, e.timezone)}{e.venue ? `\n${e.venue}` : ''}</Text>
        {e.cancelled ? (
          <View style={styles.cancelled}><Text variant="small" weight="semibold" color={colors.danger} align="center">This event has been cancelled. Check your email for details.</Text></View>
        ) : null}

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + space.md}
          decelerationRate="fast"
          contentContainerStyle={{ gap: space.md }}
          onMomentumScrollEnd={(ev) => setPage(Math.round(ev.nativeEvent.contentOffset.x / (cardWidth + space.md)))}
        >
          {tickets.map((t, i) => (
            <View key={t.id} style={[styles.ticket, shadow.raised, { width: cardWidth }]}>
              <Text variant="caption" color={colors.muted}>Ticket {i + 1} of {tickets.length}</Text>
              {t.qr && !t.transferredAway ? (
                <View style={styles.qr}><QrCode value={t.qr} size={Math.min(240, cardWidth - 64)} /></View>
              ) : (
                <View style={[styles.qr, styles.noQr]}>
                  <Text variant="small" color={colors.muted} align="center">
                    {t.transferredAway ? 'You gave this ticket to someone else. Its code is theirs now.' : 'This ticket has no code yet.'}
                  </Text>
                </View>
              )}
              <Text variant="label" weight="bold" align="center">{t.tierName ?? 'Ticket'}</Text>
              {place(t) ? <Text variant="small" align="center">{place(t)}</Text> : null}
              {t.attendeeName ? <Text variant="small" color={colors.muted} align="center">{t.attendeeName}</Text> : null}
              {t.addons.length ? <Text variant="caption" color={colors.muted} align="center">Includes: {t.addons.join(', ')}</Text> : null}
              {t.scannedAt ? <Text variant="caption" weight="semibold" color={colors.success} align="center">Checked in</Text> : null}
              <Text variant="caption" color={colors.subtle} align="center">#{t.id.slice(0, 8).toUpperCase()}</Text>
            </View>
          ))}
        </ScrollView>
        {tickets.length > 1 ? (
          <View style={styles.dots}>{tickets.map((t, i) => <View key={t.id} style={[styles.dot, i === page && styles.dotOn]} />)}</View>
        ) : null}

        <Text variant="caption" color={colors.muted} align="center">Turn your screen brightness up at the door.</Text>
        <Button label="Add to Calendar" variant="secondary" icon="calendarPlus" onPress={() => { void addToCalendar(); }} />
        <Button label="Share Event" variant="ghost" icon="share" onPress={() => { void Share.share({ message: `I'm going to ${e.title} — ${SITE}/e/${e.slug}` }); }} />
        {note ? <Text variant="small" color={colors.danger} align="center">{note}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, gap: space.lg },
  cancelled: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  ticket: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl, gap: space.sm, alignItems: 'center' },
  qr: { padding: space.md, borderRadius: radius.lg, backgroundColor: colors.white, marginVertical: space.sm },
  noQr: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSunken },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent, width: 18 },
});
