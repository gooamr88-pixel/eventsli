import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { eventBySlug, hold, seatMap } from '@/api/endpoints';
import type { EventDetail } from '@/api/types';
import { useToken } from '@/auth/session';
import { money } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { buildModel, OPEN_SEAT, type MapSeat, type MapTable } from '@/seating/model';
import { SeatList } from '@/seating/SeatList';
import { SeatMapView } from '@/seating/SeatMapView';
import { Empty, Failed, Header, IconButton } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * THE SEATING MAP — the mockup's sixth frame: the venue's name in a grey
 * pill, the organizer's own floor plan (pinch, pan, tap a seat; + and −
 * beside it), the ticket types as a legend under it, then "Selected Seats",
 * "2 × VIP … EGP 3,200" and Continue.
 *
 * Tapping a type in the legend picks those seats out and dims the rest; the
 * map itself never moves unless the person moves it (owner, 2026-11-19).
 * A table that can be booked whole is chosen by tapping the table. The List
 * button in the header shows the same seats as a list — and it is where the
 * screen opens when a screen reader is on.
 *
 * Continue HOLDS the choice (POST /hold) and opens the checkout.
 */
export default function Seats() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const token = useToken();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string[]>([]);
  const [table, setTable] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A browser's answer is not a screen reader's (react-native-web), so the web keeps the map.
    if (Platform.OS === 'web') return;
    AccessibilityInfo.isScreenReaderEnabled().then((on) => { if (on) setMode('list'); }).catch(() => undefined);
  }, []);

  // The event page fetched this a moment ago (prefetch); a copy up to 30 s
  // old is shown at once. A seat taken since is refused by the hold with a
  // clear message, and the map is then refreshed.
  const q = useQuery({ queryKey: ['seat-map', slug], queryFn: () => seatMap(slug, token), staleTime: 30_000 });
  const m = q.data;
  const model = useMemo(() => (m ? buildModel(m) : null), [m]);
  const focusTiers = useMemo(() => (focus ? new Set([focus]) : null), [focus]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  // The venue for the row above the map, as drawn (Cairo International
  // Stadium). Usually already here from the event page; fetched if not.
  const ev = useQuery({ queryKey: ['event', slug], queryFn: () => eventBySlug(slug, token), staleTime: 60_000, initialData: () => qc.getQueryData<EventDetail>(['event', slug]) });
  const venue = ev.data?.venue;

  if (q.isLoading) {
    return (
      <View style={styles.root}>
        <Header title="Seating Map" />
        <Container style={{ gap: space.lg, flex: 1, paddingTop: space.sm }}>
          <Skeleton height={44} round={12} />
          <Skeleton height={360} round={16} />
        </Container>
      </View>
    );
  }
  if (q.isError || !m) {
    return <View style={styles.root}><Header title="Seating Map" /><Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} /></View>;
  }
  if (m.event.admissionType === 'general' || !model) {
    return (
      <View style={styles.root}>
        <Header title="Seating Map" />
        <Empty icon="ticket" title="No seats to choose" body="This event sells tickets by type." action="Choose tickets" onAction={() => router.replace({ pathname: '/event/[slug]/tickets', params: { slug } })} />
      </View>
    );
  }

  const data = m;
  const currency = data.event.currency;
  const max = data.event.maxTicketsPerOrder ?? 10;
  const seatById = new Map(data.seats.map((s) => [s.id, s]));
  const chosen = picked.map((id) => seatById.get(id)).filter((s): s is MapSeat => Boolean(s));
  const chosenTable = data.tables.find((t) => t.id === table) ?? null;
  const total = chosenTable ? chosenTable.priceCents ?? 0 : chosen.reduce((sum, s) => sum + (s.priceCents ?? 0), 0);
  const colourOf = (tierId: string | null) => (model.byTier && tierId ? model.palette.get(tierId) : null) || model.look?.seat || OPEN_SEAT;

  // "2 × VIP, 1 × Regular" — by ticket type, as the mockup's summary reads.
  const byTier = new Map<string, number>();
  for (const s of chosen) {
    const name = data.tiers.find((t) => t.id === s.tierId)?.name ?? 'Seat';
    byTier.set(name, (byTier.get(name) ?? 0) + 1);
  }
  const summary = chosenTable ? `Table ${chosenTable.label} · ${chosenTable.seatCount} seats`
    : [...byTier.entries()].map(([name, n]) => `${n} × ${name}`).join(', ');
  const nothing = !chosen.length && !chosenTable;

  const onSeat = (s: MapSeat) => {
    setError(null);
    if (pickedSet.has(s.id)) { haptic.select(); setPicked((prev) => prev.filter((id) => id !== s.id)); return; }
    if (!s.available && s.reason === 'private') {
      // Private tables are on the map, marked Private (2026-11-24); the password
      // that opens one is entered on the website's seat page.
      haptic.error(); setError('This table is private. Enter its password on the event’s seat page at eventsli.com to book it.'); return;
    }
    if (!s.available) { haptic.error(); setError('That seat is taken. Choose another.'); return; }
    if (picked.length >= max) { haptic.error(); setError(`Up to ${max} seats per order.`); return; }
    haptic.select();
    setTable(null);
    setPicked((prev) => [...prev, s.id]);
  };

  const onTable = (t: MapTable) => {
    if (!t.canBookWhole) return;
    setError(null);
    haptic.select();
    setPicked([]);
    setTable((cur) => (cur === t.id ? null : t.id));
  };

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const h = await hold(slug, chosenTable ? { tableId: chosenTable.id } : { seatIds: picked }, token);
      haptic.commit();
      useReservation.getState().start({ ...h, slug, eventTitle: data.event.title });
      router.push({ pathname: '/checkout/[reservationId]', params: { reservationId: h.reservationId } });
    } catch (err) {
      haptic.error();
      setError(messageFor(err));
      setPicked([]);
      setTable(null);
      void q.refetch(); // a seat taken under us shows as taken now
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Header
        title="Seating Map"
        right={<IconButton icon={mode === 'map' ? 'list' : 'map'} size={22} label={mode === 'map' ? 'Show seats as a list' : 'Show the map'} onPress={() => { haptic.select(); setMode((v) => (v === 'map' ? 'list' : 'map')); }} />}
      />

      <Container style={{ flex: 1 }}>
        <View style={styles.venue}>
          <Icon name="pin" size={18} color={colors.accent} />
          <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>{venue || data.event.title}</Text>
        </View>

        {mode === 'map' ? (
          <View style={{ flex: 1 }}>
            <SeatMapView
              model={model}
              currency={currency}
              selectedSeatIds={pickedSet}
              selectedTableId={table}
              focusTiers={focusTiers}
              onSeat={onSeat}
              onTable={onTable}
              style={styles.map}
            />
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: space.md }}>
            <SeatList data={data} model={model} picked={pickedSet} onSeat={onSeat} />
          </ScrollView>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.legend}>
          {data.tiers.map((t) => {
            const on = focus === t.id;
            return (
              <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t.name}, ${money(t.priceCents, currency)}. Show only these seats`}
                onPress={() => { haptic.select(); setFocus(on ? null : t.id); }} style={[styles.legendItem, focus && !on && { opacity: 0.4 }]} hitSlop={6}>
                <View style={[styles.legendDot, { backgroundColor: colourOf(t.id) }]} />
                <Text variant="small" weight={on ? 'bold' : 'medium'}>{t.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Container>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <Container style={{ gap: space.md }}>
          <Text variant="label" weight="bold">Selected Seats</Text>
          <View style={styles.sumRow}>
            <Text variant="label" weight="bold" style={{ flex: 1 }} numberOfLines={1} accessibilityLiveRegion="polite">
              {nothing ? <Text variant="label" color={colors.muted}>Tap a seat to choose it</Text> : summary}
            </Text>
            {!nothing ? <Text variant="label" weight="bold">{money(total, currency)}</Text> : null}
          </View>
          {error ? (
            <Animated.View entering={FadeIn.duration(150)}>
              <Text variant="small" color={colors.accent} accessibilityLiveRegion="assertive">{error}</Text>
            </Animated.View>
          ) : null}
          <Button label="Continue" onPress={() => { void next(); }} disabled={nothing} busy={busy} />
        </Container>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  venue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 44, marginBottom: space.xs },
  map: { flex: 1, borderRadius: 16, backgroundColor: colors.white },
  legend: { flexGrow: 1, justifyContent: 'center', gap: space.xl, paddingVertical: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 },
  legendDot: { width: 13, height: 13, borderRadius: 7 },
  bar: { backgroundColor: colors.surface, paddingTop: space.lg, borderTopLeftRadius: 26, borderTopRightRadius: 26, shadowColor: '#111018', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
