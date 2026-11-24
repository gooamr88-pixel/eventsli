import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { messageFor } from '@/api/client';
import { eventBySlug, hold } from '@/api/endpoints';
import type { Tier } from '@/api/types';
import { useToken } from '@/auth/session';
import { eventWhen, money, price } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { Failed, Header, Stepper } from '@/ui/bits';
import { BottomBar } from '@/ui/BottomBar';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { haptic, RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

/** The ceiling the API would enforce anyway, so the + button stops where the hold would refuse. */
function maxFor(t: Pick<Tier, 'maxPerOrder' | 'remaining'>, eventMax: number | null | undefined, others: number): number {
  const caps = [t.maxPerOrder, t.remaining, eventMax ? eventMax - others : null, 20]
    .filter((n): n is number => typeof n === 'number');
  return Math.max(0, Math.min(...caps));
}

/**
 * Select Tickets (the mockup's first lower frame), for general admission: a
 * quantity per ticket type, the total, Continue. Continue HOLDS the tickets
 * (POST /hold with `lines`) — the stock is set aside for the buyer while they
 * pay — and opens the checkout. Prices here are the face prices; tax and any
 * fee appear itemised on the next screen, from the server's own quote.
 */
export default function SelectTickets() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const token = useToken();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['event', slug], queryFn: () => eventBySlug(slug, token) });
  if (q.isLoading) {
    return <View style={styles.root}><Header title="Select Tickets" /><Container style={{ gap: space.md, paddingTop: space.lg }}>{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</Container></View>;
  }
  if (q.isError || !q.data) {
    return <View style={styles.root}><Header title="Select Tickets" /><Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} /></View>;
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
      haptic.commit();
      useReservation.getState().start({ ...h, slug: e.slug, eventTitle: e.title });
      router.push({ pathname: '/checkout/[reservationId]', params: { reservationId: h.reservationId } });
    } catch (err) {
      haptic.error();
      setError(messageFor(err));
      void q.refetch(); // what sold out under us shows as sold out now
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Header title="Select Tickets" />
      <ScrollView contentContainerStyle={styles.body}>
        <Container style={{ gap: space.md }}>
          <View style={[styles.summary, shadow.card]}>
            <Cover uri={e.coverUrl} title={e.title} style={styles.thumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight="bold" numberOfLines={2}>{e.title}</Text>
              <View style={styles.meta}><Icon name="calendar" size={13} color={colors.muted} /><Text variant="caption" color={colors.muted}>{eventWhen(e.startsAt, e.timezone)}</Text></View>
              {e.venue ? <View style={styles.meta}><Icon name="pin" size={13} color={colors.muted} /><Text variant="caption" color={colors.muted} numberOfLines={1}>{e.venue}</Text></View> : null}
            </View>
          </View>

          <Text variant="title" style={{ marginTop: space.sm }} accessibilityRole="header">Choose your tickets</Text>
          {tiers.map((t, i) => {
            const others = count - (qty[t.id] ?? 0);
            const max = t.onSale && !t.soldOut ? maxFor(t, e.maxTicketsPerOrder, others) : 0;
            const n = qty[t.id] ?? 0;
            const off = !t.onSale || t.soldOut;
            return (
              <Animated.View key={t.id} entering={FadeInDown.delay(i * 50).duration(240)} style={[styles.tier, n > 0 && styles.tierOn, off && styles.tierOff]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight="bold">{t.name}</Text>
                  <Text variant="small" weight="semibold" color={colors.accent}>{price(t.priceCents, e.currency)}</Text>
                  {t.description ? <Text variant="caption" color={colors.muted} numberOfLines={3}>{t.description}</Text> : null}
                  {t.soldOut ? <Text variant="caption" weight="semibold" color={colors.danger}>Sold out</Text>
                    : t.notYetOnSale ? <Text variant="caption" color={colors.muted}>Not on sale yet</Text>
                      : t.salesEnded ? <Text variant="caption" color={colors.muted}>Sales ended</Text>
                        : t.remaining !== null && t.remaining <= 10 ? <Text variant="caption" weight="semibold" color={colors.warning}>Only {t.remaining} left</Text> : null}
                </View>
                {off ? null : (
                  <Stepper
                    label={`${t.name} tickets`}
                    value={n}
                    max={Math.max(max, n)}
                    onChange={(v) => { setError(null); setQty((prev) => ({ ...prev, [t.id]: v })); }}
                  />
                )}
              </Animated.View>
            );
          })}

          <View style={styles.note}>
            <Icon name="shield" size={16} color={colors.muted} />
            <Text variant="caption" color={colors.muted} style={{ flex: 1 }}>
              Your tickets are held for you while you pay.{e.maxTicketsPerOrder ? ` Up to ${e.maxTicketsPerOrder} per order.` : ''}
            </Text>
          </View>
          {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
        </Container>
      </ScrollView>

      <BottomBar>
        <View style={styles.totalRow}>
          <View>
            <Text variant="small" color={colors.muted}>{count ? `${count} ticket${count === 1 ? '' : 's'}` : 'Total'}</Text>
            <Text variant="heading">{count ? money(total, e.currency) : '—'}</Text>
          </View>
          <Button label="Continue" onPress={() => { void next(); }} disabled={count === 0} busy={busy} iconRight="arrow" style={{ flex: 1, maxWidth: 240 }} />
        </View>
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { paddingTop: space.lg, paddingBottom: 200 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tier: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  tierOn: { borderColor: colors.accent, backgroundColor: colors.coral50 },
  tierOff: { opacity: 0.6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.lg },
});
