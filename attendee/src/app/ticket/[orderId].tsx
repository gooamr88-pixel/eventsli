// The system's "add event" sheet. SDK 58 moved it to /legacy; the root export
// is now a stub that throws at runtime (expo-calendar/build/legacyWarnings).
import { useQueryClient } from '@tanstack/react-query';
import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { messageFor } from '@/api/client';
import { transferTicket } from '@/api/endpoints';
import type { Order, Ticket } from '@/api/types';
import { useToken } from '@/auth/session';
import { isUpcoming, useTickets } from '@/hooks/useTickets';
import { eventDay, eventTime } from '@/lib/format';
import { Badge, Empty, Failed, Header, IconButton } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { useLayout } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { Perforation } from '@/ui/Perforation';
import { QrCode } from '@/ui/QrCode';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/** The parts of a ticket's place, for the details grid: Section A · Row 5 · Seat 12, or Table 4. */
function placeParts(t: Ticket): [string, string][] {
  const parts: [string, string][] = [];
  if (t.table) parts.push(['Table', String(t.table)]);
  if (t.seat) {
    if (t.seat.section) parts.push(['Section', String(t.seat.section)]);
    if (t.seat.row) parts.push(['Row', String(t.seat.row)]);
    if (t.seat.number !== null && t.seat.number !== undefined) parts.push(['Seat', String(t.seat.number)]);
  }
  return parts;
}

/**
 * One order's tickets — a paper ticket each, swiped through. The codes are
 * drawn on the phone from what My Tickets already fetched, so this screen
 * opens with no signal (see QrCode.tsx).
 *
 * A ticket given away shows no code — the buyer's copy stops working the
 * moment it is transferred, and the screen says so rather than showing a code
 * that will be refused at the door. "Give to someone" passes a ticket on
 * (BRD §10: once), which is why a ticket that was itself received cannot.
 */
export default function TicketScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { width, tablet } = useLayout();
  const q = useTickets();
  const [page, setPage] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [giving, setGiving] = useState<Ticket | null>(null);

  if (q.isLoading) {
    return <View style={styles.root}><Header title="My Ticket" /><View style={{ padding: space.lg }}><Skeleton height={520} round={radius.xl} /></View></View>;
  }
  const order = q.data?.find((o) => o.orderId === orderId);
  if (!order || !order.event) {
    return (
      <View style={styles.root}>
        <Header title="My Ticket" />
        {q.isError ? <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
          : <Empty icon="ticket" title="Ticket not found" body="It may have been transferred to someone else." />}
      </View>
    );
  }

  const e = order.event;
  const tickets = order.tickets;
  const cardWidth = Math.min(width - space.lg * 2, tablet ? 440 : 520);
  const step = cardWidth + space.md;
  const sidePad = (width - cardWidth) / 2;
  const current = tickets[Math.min(page, tickets.length - 1)];

  async function addToCalendar() {
    setNote(null);
    try {
      // The system's own "add event" sheet: no calendar permission, and the
      // person sees exactly what is being added before it is.
      await createEventInCalendarAsync({
        title: e.title,
        startDate: new Date(e.startsAt),
        endDate: new Date(e.endsAt || Date.parse(e.startsAt) + 3 * 3_600_000),
        location: [e.venue, e.city].filter(Boolean).join(', ') || undefined,
        url: `${SITE}/e/${e.slug}`,
        timeZone: e.timezone ?? undefined,
      });
    } catch {
      setNote('Your calendar could not be opened.');
    }
  }

  const directions = () => {
    const where = encodeURIComponent([e.venue, e.city].filter(Boolean).join(', '));
    void Linking.openURL(Platform.select({ ios: `maps:0,0?q=${where}`, android: `geo:0,0?q=${where}`, default: `https://www.google.com/maps/search/?api=1&query=${where}` }) as string);
  };

  const canGive = (t: Ticket | undefined) => Boolean(t && t.qr && !t.transferred && !t.transferredAway && !t.scannedAt && !e.cancelled && isUpcoming(order));

  return (
    <View style={styles.root}>
      <Header
        title="My Ticket"
        subtitle={tickets.length > 1 ? `${Math.min(page, tickets.length - 1) + 1} of ${tickets.length}` : undefined}
        right={<IconButton icon="share" label="Share event" variant="soft" size={20} onPress={() => { void Share.share({ message: `I'm going to ${e.title} — ${SITE}/e/${e.slug}` }); }} />}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {e.cancelled ? (
          <View style={styles.cancelled}>
            <Icon name="alert" size={18} color={colors.danger} />
            <Text variant="small" weight="semibold" color={colors.danger} style={{ flex: 1 }}>This event has been cancelled. Check your email for what happens next.</Text>
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          contentContainerStyle={{ gap: space.md, paddingHorizontal: sidePad, paddingVertical: space.md }}
          onMomentumScrollEnd={(ev) => setPage(Math.round(ev.nativeEvent.contentOffset.x / step))}
        >
          {tickets.map((t, i) => (
            <Animated.View key={t.id} entering={FadeInDown.delay(i * 70).duration(300)}>
              <PaperTicket order={order} ticket={t} index={i} count={tickets.length} width={cardWidth} />
            </Animated.View>
          ))}
        </ScrollView>
        {tickets.length > 1 ? (
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {tickets.map((t, i) => <View key={t.id} style={[styles.dot, i === page && styles.dotOn]} />)}
          </View>
        ) : null}

        <View style={[styles.actions, { width: cardWidth, alignSelf: 'center' }]}>
          <View style={styles.tip}>
            <Icon name="sparkle" size={16} color={colors.onHighlight} />
            <Text variant="caption" weight="semibold" style={{ flex: 1 }}>Turn your screen brightness up at the door. This code works offline.</Text>
          </View>
          <View style={styles.row}>
            <Button label="Add to Calendar" variant="secondary" icon="calendarPlus" size="sm" onPress={() => { void addToCalendar(); }} style={{ flex: 1 }} />
            <Button label="Directions" variant="secondary" icon="map" size="sm" onPress={directions} style={{ flex: 1 }} />
          </View>
          {canGive(current) ? (
            <Button label="Give this ticket to someone" variant="ghost" icon="send" onPress={() => setGiving(current)} />
          ) : null}
          {note ? <Text variant="small" color={colors.danger} align="center">{note}</Text> : null}
        </View>
      </ScrollView>

      <GiveSheet ticket={giving} eventTitle={e.title} onClose={() => setGiving(null)} />
    </View>
  );
}

function PaperTicket({ order, ticket: t, index, count, width }: { order: Order; ticket: Ticket; index: number; count: number; width: number }) {
  const e = order.event!;
  const place = placeParts(t);
  const live = Boolean(t.qr && !t.transferredAway);
  const qrSize = Math.min(220, width - 96);
  return (
    <View style={[styles.ticket, shadow.raised, { width }]} accessible={false}>
      <Cover uri={e.coverUrl ?? null} title={e.title} scrim style={styles.ticketCover}>
        <View style={styles.ticketCoverText}>
          <Text variant="overline" color={colors.sun200}>{count > 1 ? `TICKET ${index + 1} OF ${count}` : 'ADMIT ONE'}</Text>
          <Text variant="title" color={colors.white} numberOfLines={2}>{e.title}</Text>
        </View>
      </Cover>

      <View style={styles.grid}>
        <Cell label="Date" value={eventDay(e.startsAt, e.timezone)} />
        <Cell label="Time" value={eventTime(e.startsAt, e.timezone)} />
        <Cell label="Ticket" value={t.tierName ?? 'Admission'} />
        {place.map(([k, v]) => <Cell key={k} label={k} value={v} />)}
        {e.venue ? <Cell label="Venue" value={e.venue} wide /> : null}
        {t.attendeeName ? <Cell label="Name" value={t.attendeeName} wide /> : null}
        {t.addons.length ? <Cell label="Includes" value={t.addons.join(', ')} wide /> : null}
      </View>

      <Perforation ground={colors.bg} />

      <View style={styles.qrArea}>
        {live ? (
          <View style={styles.qr} accessible accessibilityLabel={`QR code for ticket ${index + 1}${place.length ? `, ${place.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`}>
            <QrCode value={t.qr!} size={qrSize} />
          </View>
        ) : (
          <View style={[styles.qr, styles.noQr, { width: qrSize + 24, height: qrSize + 24 }]}>
            <Icon name={t.transferredAway ? 'send' : 'clock'} size={28} color={colors.muted} />
            <Text variant="small" color={colors.muted} align="center">
              {t.transferredAway ? 'You gave this ticket to someone else. Its code is theirs now.' : 'This ticket has no code yet.'}
            </Text>
          </View>
        )}
        <View style={styles.qrFoot}>
          <Text variant="caption" color={colors.subtle} style={styles.code}>#{t.id.slice(0, 8).toUpperCase()}</Text>
          {t.scannedAt ? <Badge label="Checked in" tone="success" icon="check" />
            : t.transferred ? <Badge label="Received" tone="highlight" /> : null}
        </View>
      </View>
    </View>
  );
}

function Cell({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={[styles.cell, wide && styles.cellWide]}>
      <Text variant="overline" color={colors.muted}>{label.toUpperCase()}</Text>
      <Text variant="label" weight="bold" numberOfLines={2}>{value}</Text>
    </View>
  );
}

/** Pass one ticket on by email. Its code stops working here and a new one is theirs. */
function GiveSheet({ ticket, eventTitle, onClose }: { ticket: Ticket | null; eventTitle: string; onClose: () => void }) {
  const token = useToken();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const close = () => { onClose(); setEmail(''); setError(null); setDone(null); };

  async function give() {
    if (!ticket || !token) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter the email of the person you are giving it to.'); return; }
    setBusy(true);
    setError(null);
    try {
      await transferTicket(token, ticket.id, email.trim());
      haptic.success();
      setDone(email.trim());
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    } catch (err) {
      haptic.error();
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={Boolean(ticket)}
      onClose={close}
      title={done ? 'Ticket sent' : 'Give this ticket'}
      subtitle={eventTitle}
      footer={done ? <Button label="Done" onPress={close} /> : <Button label="Send ticket" icon="send" busy={busy} onPress={() => { void give(); }} />}
    >
      {done ? (
        <View style={styles.done}>
          <View style={styles.doneIcon}><Icon name="send" size={26} color={colors.white} /></View>
          <Text variant="body" color={colors.muted} align="center">We emailed the ticket to {done}. Its code on this phone no longer works.</Text>
        </View>
      ) : (
        <>
          <View style={styles.warn}>
            <Icon name="alert" size={18} color={colors.warning} />
            <Text variant="small" color={colors.warning} style={{ flex: 1 }}>A ticket can be passed on once. Your copy stops working, and you cannot take it back.</Text>
          </View>
          <Field label="Their email" icon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: space.xxl, gap: space.md },
  cancelled: { flexDirection: 'row', alignItems: 'center', gap: space.sm, margin: space.lg, marginBottom: 0, padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  ticket: { backgroundColor: colors.surface, borderRadius: radius.xl, overflow: 'hidden' },
  ticketCover: { height: 120 },
  ticketCoverText: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.md, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, rowGap: space.md },
  cell: { width: '33.33%', paddingRight: space.sm, gap: 2 },
  cellWide: { width: '100%' },
  qrArea: { alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg, paddingTop: space.xs, gap: space.sm },
  qr: { padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  noQr: { alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.bgSunken, padding: space.lg },
  qrFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  code: { letterSpacing: 1.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent, width: 20 },
  actions: { gap: space.md },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.sun100 },
  row: { flexDirection: 'row', gap: space.sm },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  done: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.successStrong, alignItems: 'center', justifyContent: 'center' },
});
