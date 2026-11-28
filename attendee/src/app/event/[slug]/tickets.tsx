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
import { Card, Failed, Header, Section, Stepper } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Container } from '@/ui/layout';
import { haptic, RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/** The ceiling the API would enforce anyway, so + stops where the hold would refuse. */
function maxFor(t: Pick<Tier, 'maxPerOrder' | 'remaining'>, eventMax: number | null | undefined, others: number): number {
  const caps = [t.maxPerOrder, t.remaining, eventMax ? eventMax - others : null, 20]
    .filter((n): n is number => typeof n === 'number');
  return Math.max(0, Math.min(...caps));
}

/**
 * Select Tickets — the mockup's first lower frame: the event, each ticket
 * type with its price and "− 1 +", the Total, Continue. Continue HOLDS the
 * tickets (POST /hold) and opens the checkout, where tax and fees are listed.
 */
export default function SelectTickets() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['event', slug], queryFn: () => eventBySlug(slug, token) });
  if (q.isLoading) return <View style={styles.root}><Header title="Select Tickets" /><Container>{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</Container></View>;
  if (q.isError || !q.data) return <View style={styles.root}><Header title="Select Tickets" /><Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} /></View>;

  const e = q.data;
  const tiers = (e.tiers ?? []).filter((t) => !t.hidden);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const total = tiers.reduce((sum, t) => sum + (qty[t.id] ?? 0) * t.priceCents, 0);

  async function next() {
    const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([tierId, quantity]) => ({ tierId, quantity }));
    if (!lines.length) return;
    setBusy(true);
    setError(null);
    try {
      const h = await hold(e.slug, { lines }, token);
      haptic.commit();
      useReservation.getState().start({ ...h, slug: e.slug, eventTitle: e.title });
      router.push({ pathname: '/checkout/[reservationId]', params: { reservationId: h.reservationId } });
    } catch (err) {
      haptic.error();
      setError(messageFor(err));
      void q.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Header title="Select Tickets" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
        <Container style={{ gap: space.lg, paddingTop: space.xs }}>
          <Card>
          <View style={styles.event}>
            <Cover uri={e.coverUrl} title={e.title} style={styles.thumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title" numberOfLines={2}>{e.title}</Text>
              <Text variant="small">{eventWhen(e.startsAt, e.timezone)}</Text>
            </View>
          </View>
          </Card>

          <View>
          <Section bar title="Tickets" />
          <Card style={{ paddingVertical: space.xs }}>
          {tiers.map((t, i) => {
            const n = qty[t.id] ?? 0;
            const others = count - n;
            const off = !t.onSale || t.soldOut;
            const max = off ? 0 : maxFor(t, e.maxTicketsPerOrder, others);
            const note = t.soldOut ? 'Sold out' : t.notYetOnSale ? 'Not on sale yet' : t.salesEnded ? 'Sales ended'
              : t.remaining !== null && t.remaining <= 10 ? `Only ${t.remaining} left` : null;
            return (
              <View key={t.id} style={[styles.tier, i < tiers.length - 1 && styles.tierRule]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight="bold" color={off ? colors.subtle : colors.text}>{t.name}</Text>
                  <Text variant="small" color={colors.muted}>{price(t.priceCents, e.currency)}{note ? ` · ${note}` : ''}</Text>
                  {t.description ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{t.description}</Text> : null}
                </View>
                {off ? null : (
                  <Stepper label={`${t.name} tickets`} value={n} max={Math.max(max, n)} onChange={(v) => { setError(null); setQty((p) => ({ ...p, [t.id]: v })); }} />
                )}
              </View>
            );
          })}
          </Card>
          </View>
          {error ? <Text variant="small" color={colors.accent} style={{ marginTop: space.md }} accessibilityLiveRegion="polite">{error}</Text> : null}
        </Container>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <Container style={{ gap: space.lg }}>
          <View style={styles.total}>
            <Text variant="title">Total</Text>
            <Text variant="title">{money(total, e.currency) || '—'}</Text>
          </View>
          <Button label="Continue" onPress={() => { void next(); }} disabled={count === 0} busy={busy} />
        </Container>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  thumb: { width: 68, height: 68, borderRadius: 12 },
  tier: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.lg },
  tierRule: { borderBottomWidth: 1, borderBottomColor: colors.border },
  bar: { backgroundColor: colors.surface, paddingTop: space.lg, borderTopLeftRadius: 26, borderTopRightRadius: 26, shadowColor: '#111018', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
