import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { hold, seatMap } from '@/api/endpoints';
import type { SeatMap } from '@/api/types';
import { useToken } from '@/auth/session';
import { money } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { Empty, Failed, Header, Loading } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

type Seat = SeatMap['seats'][number];

/** Ticket types are told apart by colour, as on the mockup's legend: VIP coral, the next yellow… */
const TIER_COLOURS = [colors.coral600, colors.sun400, '#6d5bd0', '#1f8a70', '#2b6cb0', '#b7791f'];

/**
 * The seating map (the mockup's sixth frame), for a reserved event.
 *
 * The website draws the organizer's floor plan; a phone draws the same seats
 * as the venue lays them out in its own words — section, then row, then seat —
 * which is what a ticket prints and what an usher reads. Each seat is coloured
 * by its ticket type and greyed when it cannot be chosen (`available`, which
 * the API works out per seat, already folds in "sold", "held", "off sale").
 *
 * Whole tables that can be booked as one are offered above the seats.
 * Continue holds the choice (POST /hold) and opens the checkout.
 */
export default function Seats() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const [picked, setPicked] = useState<string[]>([]);
  const [table, setTable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['seat-map', slug], queryFn: () => seatMap(slug, token) });
  const m = q.data;

  const colourOf = useMemo(() => {
    const map = new Map<string, string>();
    (m?.tiers ?? []).forEach((t, i) => map.set(t.id, TIER_COLOURS[i % TIER_COLOURS.length]));
    return map;
  }, [m]);

  const sections = useMemo(() => groupSeats((m?.seats ?? []).filter((s) => !s.tableId)), [m]);
  const tables = (m?.tables ?? []).filter((t) => t.canBookWhole);

  if (q.isLoading) return <View style={styles.root}><Header title="Seating Map" back /><Loading /></View>;
  if (q.isError || !m) {
    return <View style={styles.root}><Header title="Seating Map" back /><Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} /></View>;
  }
  if (m.event.admissionType === 'general' || !m.map) {
    // No map: the quantity picker is the way in.
    return (
      <View style={styles.root}>
        <Header title="Seating Map" back />
        <Empty icon="ticket" title="No seats to choose" body="This event sells tickets by type." action="Choose tickets" onAction={() => router.replace({ pathname: '/event/[slug]/tickets', params: { slug } })} />
      </View>
    );
  }

  const max = m.event.maxTicketsPerOrder ?? 10;
  const seatById = new Map(m.seats.map((s) => [s.id, s]));
  const chosen = picked.map((id) => seatById.get(id)).filter((s): s is Seat => Boolean(s));
  const chosenTable = tables.find((t) => t.id === table) ?? null;
  const total = chosenTable ? chosenTable.priceCents ?? 0 : chosen.reduce((sum, s) => sum + (s.priceCents ?? 0), 0);

  const toggle = (s: Seat) => {
    setError(null);
    setTable(null);
    setPicked((prev) => {
      if (prev.includes(s.id)) return prev.filter((id) => id !== s.id);
      if (prev.length >= max) {
        setError(`Up to ${max} seats per order.`);
        return prev;
      }
      return [...prev, s.id];
    });
  };

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const h = await hold(slug, chosenTable ? { tableId: chosenTable.id } : { seatIds: picked }, token);
      useReservation.getState().start({ ...h, slug, eventTitle: m!.event.title });
      router.push({ pathname: '/checkout/[reservationId]', params: { reservationId: h.reservationId } });
    } catch (err) {
      setError(messageFor(err));
      setPicked([]);
      setTable(null);
      void q.refetch(); // a seat taken under us shows as taken now
    } finally {
      setBusy(false);
    }
  }

  // "2 × VIP" — by ticket type, as the mockup's summary reads.
  const byTier = new Map<string, number>();
  for (const s of chosen) {
    const name = m.tiers.find((t) => t.id === s.tierId)?.name ?? 'Seat';
    byTier.set(name, (byTier.get(name) ?? 0) + 1);
  }
  const summary = chosenTable ? `Table ${chosenTable.label} · ${chosenTable.seatCount} seats`
    : [...byTier.entries()].map(([name, n]) => `${n} × ${name}`).join(', ');

  return (
    <View style={styles.root}>
      <Header title="Seating Map" back />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.stage}><Text variant="small" weight="bold" color={colors.white}>STAGE</Text></View>

        <View style={styles.legend}>
          {m.tiers.map((t) => (
            <View key={t.id} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: colourOf.get(t.id) }]} />
              <Text variant="caption">{t.name} · {money(t.priceCents, m.event.currency)}</Text>
            </View>
          ))}
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.border }]} />
            <Text variant="caption">Taken</Text>
          </View>
        </View>

        {tables.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="title" accessibilityRole="header">Whole tables</Text>
            {tables.map((t) => {
              const on = table === t.id;
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => { setPicked([]); setError(null); setTable(on ? null : t.id); }}
                  style={[styles.table, on && styles.tableOn]}
                >
                  <Text variant="label">Table {t.label}</Text>
                  <Text variant="small" color={colors.muted}>{t.seatCount} seats · {money(t.priceCents, m.event.currency)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {sections.map(({ section, rows }) => (
          <View key={section} style={{ gap: space.sm }}>
            <Text variant="title" accessibilityRole="header">{section}</Text>
            {rows.map(({ row, seats }) => (
              <View key={row} style={styles.row}>
                <Text variant="caption" color={colors.muted} style={styles.rowLabel}>{row}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seats}>
                  {seats.map((s) => {
                    const on = picked.includes(s.id);
                    const tint = colourOf.get(s.tierId ?? '') ?? colors.accent;
                    return (
                      <Pressable
                        key={s.id}
                        disabled={!s.available}
                        onPress={() => toggle(s)}
                        accessibilityRole="button"
                        accessibilityLabel={`${section}, row ${row}, seat ${s.number}${s.priceCents !== null ? `, ${money(s.priceCents, m.event.currency)}` : ''}`}
                        accessibilityState={{ selected: on, disabled: !s.available }}
                        hitSlop={2}
                        style={[
                          styles.seat,
                          !s.available ? styles.seatTaken : on ? { backgroundColor: colors.night, borderColor: colors.night } : { borderColor: tint, backgroundColor: `${tint}22` },
                        ]}
                      >
                        <Text variant="caption" weight="semibold" color={on ? colors.white : s.available ? colors.text : colors.subtle}>{s.number}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ))}
          </View>
        ))}

        {m.hiddenTableCount > 0 ? (
          <Text variant="caption" color={colors.muted}>{m.hiddenTableCount} reserved table{m.hiddenTableCount === 1 ? '' : 's'} not shown.</Text>
        ) : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <Text variant="small" color={colors.muted}>Selected Seats</Text>
        <View style={styles.totalRow}>
          <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{summary || 'None yet'}</Text>
          <Text variant="title">{chosen.length || chosenTable ? money(total, m.event.currency) : ''}</Text>
        </View>
        {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Button label="Continue" onPress={() => { void next(); }} disabled={!chosen.length && !chosenTable} busy={busy} />
      </View>
    </View>
  );
}

/** Section → row → seat, in the order a person reads them (numeric where they are numbers). */
function groupSeats(seats: Seat[]) {
  const cmp = (a: unknown, b: unknown) => String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true });
  const sections = new Map<string, Map<string, Seat[]>>();
  for (const s of seats) {
    const sec = s.section || 'Seats';
    const row = s.row || '—';
    if (!sections.has(sec)) sections.set(sec, new Map());
    const rows = sections.get(sec)!;
    rows.set(row, [...(rows.get(row) ?? []), s]);
  }
  return [...sections.entries()].sort(([a], [b]) => cmp(a, b)).map(([section, rows]) => ({
    section,
    rows: [...rows.entries()].sort(([a], [b]) => cmp(a, b)).map(([row, list]) => ({ row, seats: list.sort((a, b) => cmp(a.number, b.number)) })),
  }));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: space.lg, gap: space.lg, paddingBottom: 220 },
  stage: { alignSelf: 'center', paddingHorizontal: space.xxl, paddingVertical: space.sm, borderRadius: radius.sm, backgroundColor: colors.night },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  table: { padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border },
  tableOn: { borderColor: colors.night, backgroundColor: colors.bgSunken },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowLabel: { width: 28 },
  seats: { gap: 6 },
  seat: { width: 36, height: 36, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  seatTaken: { backgroundColor: colors.bgSunken, borderColor: colors.border },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
