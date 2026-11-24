import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { hold, seatMap } from '@/api/endpoints';
import { useToken } from '@/auth/session';
import { money } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { buildModel, OPEN_SEAT, type MapModel, type MapSeat, type MapTable } from '@/seating/model';
import { SeatList } from '@/seating/SeatList';
import { SeatMapView } from '@/seating/SeatMapView';
import { Chip, Empty, Failed, Header, IconButton } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useLayout } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

/**
 * THE SEATING MAP (the mockup's sixth frame), for a reserved event.
 *
 * The organizer's own floor plan — stage, bars, tables in their shapes, every
 * seat where the website puts it (src/seating) — to pan, pinch and tap. Seats
 * are coloured by ticket type, and the chips across the top are the legend:
 * tapping one picks that type out and dims the rest. Nothing moves the map
 * but the person (owner, 2026-11-19).
 *
 * A table that can be booked whole is chosen by tapping the table itself;
 * that replaces any single seats, and a seat replaces a table, because the
 * hold takes one or the other.
 *
 * The drawn map cannot be read aloud, so there is a List view of the same
 * seats — and it is where the screen opens when a screen reader is on.
 *
 * Continue HOLDS the choice (POST /hold) — the seats are set aside while the
 * buyer pays — and opens the checkout. A seat someone else took in the
 * meantime comes back as a clear message, and the map refreshes.
 */
export default function Seats() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const token = useToken();
  const { wide, tablet } = useLayout();
  const [picked, setPicked] = useState<string[]>([]);
  const [table, setTable] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then((on) => { if (on) setMode('list'); }).catch(() => undefined);
  }, []);

  const q = useQuery({ queryKey: ['seat-map', slug], queryFn: () => seatMap(slug, token) });
  const m = q.data;
  const model = useMemo(() => (m ? buildModel(m) : null), [m]);
  const focusTiers = useMemo(() => (focus ? new Set([focus]) : null), [focus]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  if (q.isLoading) {
    return (
      <View style={styles.root}>
        <Header title="Seating Map" />
        <View style={{ padding: space.lg, gap: space.md, flex: 1 }}>
          <Skeleton height={38} width="70%" round={radius.pill} />
          <Skeleton height={400} round={radius.xl} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }
  if (q.isError || !m) {
    return <View style={styles.root}><Header title="Seating Map" /><Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} /></View>;
  }
  if (m.event.admissionType === 'general' || !model) {
    // No map: the quantity picker is the way in.
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
  const count = chosenTable ? chosenTable.seatCount : chosen.length;
  const colourOf = (tierId: string | null) => (model.byTier && tierId ? model.palette.get(tierId) : null) || model.look?.seat || OPEN_SEAT;

  const onSeat = (s: MapSeat) => {
    setError(null);
    if (!s.available && !pickedSet.has(s.id)) {
      haptic.error();
      setError(s.reason === 'held' ? 'Someone is buying that seat right now.' : 'That seat is taken.');
      return;
    }
    if (pickedSet.has(s.id)) {
      haptic.select();
      setPicked((prev) => prev.filter((id) => id !== s.id));
      return;
    }
    if (picked.length >= max) {
      haptic.error();
      setError(`Up to ${max} seats per order.`);
      return;
    }
    haptic.select();
    setTable(null);
    setPicked((prev) => [...prev, s.id]);
  };

  const onTable = (t: MapTable) => {
    setError(null);
    if (!t.canBookWhole) return;
    if (t.status !== 'available' && table !== t.id) {
      haptic.error();
      setError(`Table ${t.label} is not available as a whole.`);
      return;
    }
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

  const legend = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
      <Chip label="All" active={!focus} onPress={() => setFocus(null)} />
      {data.tiers.map((t) => (
        <Chip key={t.id} label={`${t.name} · ${money(t.priceCents, currency)}`} dot={colourOf(t.id)} active={focus === t.id}
          onPress={() => setFocus((f) => (f === t.id ? null : t.id))} />
      ))}
    </ScrollView>
  );

  const canvas = mode === 'map' ? (
    <View style={styles.mapWrap}>
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
      <View style={[styles.key, shadow.card]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <KeyDot color={OPEN_SEAT} label="Available" />
        <KeyDot color={colors.accent} label="Selected" ring />
        <KeyDot color="#c4c4cc" label="Taken" />
      </View>
    </View>
  ) : (
    <ScrollView contentContainerStyle={styles.listBody}>
      <SeatList data={data} model={model} picked={pickedSet} onSeat={onSeat} />
    </ScrollView>
  );

  const selection = (
    <Selection
      model={model}
      chosen={chosen}
      chosenTable={chosenTable}
      currency={currency}
      total={total}
      count={count}
      max={max}
      error={error}
      busy={busy}
      hiddenTables={data.hiddenTableCount}
      onRemove={(id) => { haptic.select(); setPicked((prev) => prev.filter((x) => x !== id)); }}
      onClearTable={() => setTable(null)}
      onContinue={() => { void next(); }}
      side={wide}
    />
  );

  const headerRight = (
    <IconButton
      icon={mode === 'map' ? 'list' : 'map'}
      label={mode === 'map' ? 'Show seats as a list' : 'Show the map'}
      variant="soft"
      size={20}
      onPress={() => { haptic.select(); setMode((v) => (v === 'map' ? 'list' : 'map')); }}
    />
  );

  return (
    <View style={styles.root}>
      <Header title="Seating Map" subtitle={data.event.title} right={headerRight} />
      {wide ? (
        <View style={styles.wideRow}>
          <View style={{ flex: 1, gap: space.sm }}>
            {legend}
            {canvas}
          </View>
          <View style={styles.side}>{selection}</View>
        </View>
      ) : (
        <View style={{ flex: 1, gap: space.sm, paddingTop: space.xs }}>
          {legend}
          <View style={[{ flex: 1 }, tablet && { paddingHorizontal: space.sm }]}>{canvas}</View>
          {selection}
        </View>
      )}
    </View>
  );
}

function KeyDot({ color, label, ring = false }: { color: string; label: string; ring?: boolean }) {
  return (
    <View style={styles.keyItem}>
      <View style={[styles.keyDot, { backgroundColor: color }, ring && styles.keyRing]} />
      <Text variant="caption" weight="semibold">{label}</Text>
    </View>
  );
}

/**
 * "Selected Seats · 2 × VIP · EGP 3,200 · Continue" — the mockup's bar. Each
 * chosen seat is a chip that takes it off again, so a wrong tap is undone
 * without hunting for it on the map.
 */
function Selection({
  model, chosen, chosenTable, currency, total, count, max, error, busy, hiddenTables, onRemove, onClearTable, onContinue, side,
}: {
  model: MapModel; chosen: MapSeat[]; chosenTable: MapTable | null; currency: string; total: number; count: number; max: number;
  error: string | null; busy: boolean; hiddenTables: number;
  onRemove: (id: string) => void; onClearTable: () => void; onContinue: () => void; side: boolean;
}) {
  const insets = useSafeAreaInsets();
  const short = (s: MapSeat) => model.nameOf(s).replace(/^Section /, '').replace(/^Table /, 'T');
  const nothing = !chosen.length && !chosenTable;
  return (
    <View style={[side ? styles.panel : [styles.bar, shadow.float, { paddingBottom: insets.bottom + space.md }]]}>
      <View style={styles.barHead}>
        <View style={{ flex: 1 }}>
          <Text variant="small" color={colors.muted}>Selected Seats</Text>
          <Text variant="label" weight="bold" accessibilityLiveRegion="polite">
            {chosenTable ? `Table ${chosenTable.label} · ${chosenTable.seatCount} seats` : nothing ? 'Tap a seat to choose it' : `${count} of up to ${max}`}
          </Text>
        </View>
        {!nothing ? <Text variant="heading">{money(total, currency)}</Text> : null}
      </View>

      {chosen.length ? (
        <ScrollView horizontal={!side} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.picked, side && styles.pickedSide]} style={{ flexGrow: 0 }}>
          {chosen.map((s) => (
            <Animated.View key={s.id} entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} layout={LinearTransition.duration(180)}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${model.nameOf(s)}`} onPress={() => onRemove(s.id)} style={styles.seatChip}>
                <View style={[styles.seatDot, { backgroundColor: (model.byTier && s.tierId && model.palette.get(s.tierId)) || OPEN_SEAT }]} />
                <Text variant="caption" weight="bold" numberOfLines={1}>{short(s)}</Text>
                {s.priceCents !== null ? <Text variant="caption" color={colors.muted}>{money(s.priceCents, currency)}</Text> : null}
                <Icon name="close" size={14} color={colors.muted} />
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>
      ) : chosenTable ? (
        <View style={styles.picked}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove table ${chosenTable.label}`} onPress={onClearTable} style={styles.seatChip}>
            <Icon name="users" size={14} color={colors.accent} />
            <Text variant="caption" weight="bold">Whole table {chosenTable.label}</Text>
            <Icon name="close" size={14} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Animated.View entering={FadeInDown.duration(180)} style={styles.error}>
          <Icon name="alert" size={16} color={colors.danger} />
          <Text variant="small" color={colors.danger} style={{ flex: 1 }} accessibilityLiveRegion="assertive">{error}</Text>
        </Animated.View>
      ) : null}
      {hiddenTables > 0 && side ? (
        <Text variant="caption" color={colors.muted}>{hiddenTables} private table{hiddenTables === 1 ? '' : 's'} need a password from the organizer.</Text>
      ) : null}

      <Button label={nothing ? 'Choose your seats' : `Continue · ${count} ${count === 1 ? 'seat' : 'seats'}`} onPress={onContinue} disabled={nothing} busy={busy} iconRight={nothing ? undefined : 'arrow'} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 2 },
  mapWrap: { flex: 1, marginHorizontal: space.md },
  map: { flex: 1, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
  key: {
    position: 'absolute', left: space.md, bottom: space.md, flexDirection: 'row', gap: space.md,
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.94)',
  },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  keyDot: { width: 10, height: 10, borderRadius: 5 },
  keyRing: { borderWidth: 2, borderColor: colors.white, shadowColor: colors.accent, shadowOpacity: 0.6, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } },
  listBody: { padding: space.lg, paddingBottom: space.xxl },
  bar: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.lg, paddingHorizontal: space.lg, gap: space.md },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  picked: { gap: space.sm },
  pickedSide: { flexDirection: 'column', alignItems: 'stretch' },
  seatChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md,
    borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  seatDot: { width: 9, height: 9, borderRadius: 5 },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  wideRow: { flex: 1, flexDirection: 'row', gap: space.lg, padding: space.lg },
  side: { width: 360 },
  panel: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: space.xl, gap: space.md },
});
