import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { analytics } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { describeScan } from '@/gate/outcomes';
import { useDoorExit } from '@/gate/useDoor';
import { count, doorTime } from '@/lib/format';
import { Bars, ShareBar } from '@/ui/charts';
import { Card, Empty, Header } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * How the door is going: arrivals over time, the pace right now, by ticket
 * type, by door, and what was turned away. Built from the tickets' current
 * state — an undone admission is not an arrival.
 */
export default function Analytics() {
  const door = useSession((s) => s.door);
  const exit = useDoorExit();
  const q = useQuery({
    queryKey: ['analytics', door?.token],
    queryFn: () => analytics(door!.token, 15),
    enabled: Boolean(door),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (q.error) exit(q.error);
  }, [q.error, exit]);

  const a = q.data;
  const expected = a ? a.stats.admitted + a.stats.pending : 0;
  const share = expected ? Math.round((a!.stats.admitted / expected) * 100) : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.pad}><Header title="Analytics" /></View>
      <ScrollView
        contentContainerStyle={[styles.pad, styles.body]}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} tintColor={colors.accent} />}
      >
        {!a ? (
          q.isLoading ? <Text color={colors.muted}>Loading…</Text> : (
            <Empty icon="chart" title="Could not load analytics" body={messageFor(q.error)} />
          )
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label="Checked in" value={count(a.stats.admitted)} sub={`${share}% of ${count(expected)}`} />
              <Tile label="Last 5 min" value={count(a.lastFiveMinutes)} sub="arrivals" />
            </View>
            <View style={styles.tiles}>
              <Tile label="Peak" value={count(a.peak?.admitted ?? 0)} sub={a.peak ? `per ${a.bucketMinutes} min at ${doorTime(a.peak.at)}` : 'no arrivals yet'} />
              <Tile label="First in" value={a.firstAt ? doorTime(a.firstAt) : '—'} sub={a.lastAt ? `last ${doorTime(a.lastAt)}` : ''} />
            </View>

            <Card style={{ gap: space.md }}>
              <Text variant="label">Arrivals every {a.bucketMinutes} minutes</Text>
              {a.timeline.length ? (
                <>
                  <Bars values={a.timeline.map((b) => b.admitted)} />
                  <View style={styles.axis}>
                    <Text variant="caption" color={colors.subtle}>{doorTime(a.timeline[0].at)}</Text>
                    <Text variant="caption" color={colors.subtle}>{doorTime(a.timeline[a.timeline.length - 1].at)}</Text>
                  </View>
                </>
              ) : (
                <Text variant="small" color={colors.muted}>Nobody has arrived yet.</Text>
              )}
            </Card>

            <Card style={{ gap: space.md }}>
              <Text variant="label">By ticket type</Text>
              {a.byTier.map((t) => (
                <View key={t.tier ?? 'none'} style={{ gap: 6 }}>
                  <View style={styles.between}>
                    <Text variant="small">{t.tier || 'No ticket type'}</Text>
                    <Text variant="small" color={colors.muted}>{count(t.admitted)} / {count(t.issued)}</Text>
                  </View>
                  <ShareBar value={t.admitted} total={t.issued} />
                </View>
              ))}
            </Card>

            {a.byDevice.length > 0 && (
              <Card style={{ gap: space.sm }}>
                <Text variant="label">By door</Text>
                {a.byDevice.map((d, i) => (
                  <View key={i} style={styles.between}>
                    <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>{d.staff || d.device || 'Unknown device'}</Text>
                    <Text variant="small" color={colors.muted}>{count(d.admitted)}</Text>
                  </View>
                ))}
              </Card>
            )}

            <Card style={{ gap: space.sm }}>
              <Text variant="label">Turned away or flagged</Text>
              {a.refusals.length === 0 && a.conflicts === 0 ? (
                <Text variant="small" color={colors.muted}>Nothing so far.</Text>
              ) : (
                <>
                  {a.refusals.map((r) => (
                    <View key={r.result} style={styles.between}>
                      <Text variant="small">{describeScan(r.result).title}</Text>
                      <Text variant="small" color={colors.muted}>{count(r.count)}</Text>
                    </View>
                  ))}
                  {a.conflicts > 0 && (
                    <View style={styles.between}>
                      <Text variant="small" color={colors.warning}>Let in twice while offline</Text>
                      <Text variant="small" color={colors.warning}>{count(a.conflicts)}</Text>
                    </View>
                  )}
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card style={{ flex: 1, gap: 2 }}>
      <Text variant="small" color={colors.muted}>{label}</Text>
      <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text variant="caption" color={colors.subtle} numberOfLines={1}>{sub}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: space.lg },
  body: { gap: space.lg, paddingBottom: space.xl },
  tiles: { flexDirection: 'row', gap: space.md },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
});
