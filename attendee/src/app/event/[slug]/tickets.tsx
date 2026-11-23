import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { eventBySlug, hold } from '@/api/endpoints';
import type { Tier } from '@/api/types';
import { useToken } from '@/auth/session';
import { eventWhen, money, price } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { Failed, Header, Loading, Stepper } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/** The ceiling the API would enforce anyway, so the + button stops where the hold would refuse. */
function maxFor(t: Tier, eventMax: number | null | undefined, others: number): number {
  const caps = [t.maxPerOrder, t.remaining, eventMax ? eventMax - others : null, 20]
    .filter((n): n is number => typeof n === 'number');
  return Math.max(0, Math.min(...caps));
}

/**
 * Select Tickets (the mockup's first lower frame), for general admission: a
 * quantity per ticket type, the total, Continue. Continue HOLDS the tickets
 * (POST /hold with `lines`) — the stock is set aside for the buyer while they
 * pay — and opens the checkout. Prices shown here are the face prices; tax and
 * any fee appear itemised on the next screen, from the server's own quote.
 */
export default function SelectTickets() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['event', slug], queryFn: () => eventBySlug(slug, token) });
  if (q.isLoading) return <View style={styles.root}><Header title="Select Tickets" back /><Loading /></View>;
  if (q.isError || !q.data) {
    return <View style={styles.root}><Header title="Select Tickets" back /><Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} /></View>;
  }

  const e = q.data;
  const tiers = e.tiers.filter((t) => !t.hidden);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const total = tiers.reduce((sum, t) => sum + (qty[t.id] ?? 0) * t.priceCents, 0);

  async function next() {
    const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([tierId, quantity]) => ({ tierId, quantity }));
    if (!lines.length) return;
    setBusy(true);
    setError(null);
    try {
      const h = await hold(e.slug, { lines }, token);
      useReservation.getState().start({ ...h, slug: e.slug, eventTitle: e.title });
      router.push({ pathname: '/checkout/[reservationId]', params: { reservationId: h.reservationId } });
    } catch (err) {
      setError(messageFor(err));
      void q.refetch(); // what sold out under us shows as sold out now
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Header title="Select Tickets" back />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.summary}>
          <Cover uri={e.coverUrl} style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text variant="label" weight="bold" numberOfLines={2}>{e.title}</Text>
            <Text variant="caption" color={colors.muted}>{eventWhen(e.startsAt, e.timezone)}</Text>
          </View>
        </View>

        {tiers.map((t) => {
          const others = count - (qty[t.id] ?? 0);
          const max = t.onSale && !t.soldOut ? maxFor(t, e.maxTicketsPerOrder, others) : 0;
          return (
            <View key={t.id} style={styles.tier}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label" weight="bold">{t.name}</Text>
                <Text variant="small" color={colors.muted}>{price(t.priceCents, e.currency)}</Text>
                {t.soldOut ? <Text variant="caption" color={colors.danger}>Sold out</Text>
                  : t.notYetOnSale ? <Text variant="caption" color={colors.muted}>Not on sale yet</Text>
                    : t.salesEnded ? <Text variant="caption" color={colors.muted}>Sales ended</Text>
                      : t.remaining !== null && t.remaining <= 10 ? <Text variant="caption" color={colors.warning}>{t.remaining} left</Text> : null}
              </View>
              <Stepper
                label={`${t.name} tickets`}
                value={qty[t.id] ?? 0}
                max={Math.max(max, qty[t.id] ?? 0)}
                onChange={(n) => setQty((prev) => ({ ...prev, [t.id]: n }))}
              />
            </View>
          );
        })}

        {e.maxTicketsPerOrder ? (
          <Text variant="caption" color={colors.muted}>Up to {e.maxTicketsPerOrder} tickets per order.</Text>
        ) : null}
        {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.totalRow}>
          <Text variant="label">Total</Text>
          <Text variant="title">{count ? money(total, e.currency) : '—'}</Text>
        </View>
        <Button label="Continue" onPress={() => { void next(); }} disabled={count === 0} busy={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { padding: space.lg, gap: space.md, paddingBottom: 180 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  tier: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
