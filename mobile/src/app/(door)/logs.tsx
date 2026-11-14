import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { analytics } from '@/api/endpoints';
import type { RecentScan } from '@/api/types';
import { useSession } from '@/auth/session';
import { describeScan } from '@/gate/outcomes';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useMe, useRecent } from '@/gate/useDoor';
import { count, doorTime, eventDate, ticketCode } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Dialog';
import { Icon, type IconName } from '@/ui/Icon';
import { Avatar, Empty, InfoRow, Screen, ScreenTitle } from '@/ui/layout';
import { TabBar } from '@/ui/TabBar';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

type Filter = 'all' | 'success' | 'failed';

/** After a sheet closes, iOS needs a moment before the next screen slides in over it. */
const AFTER_SHEET_MS = 350;

/**
 * Check-in Logs, as the mockup draws it: every answer at this event, newest
 * first, from every door. All / Success / Failed are the event's totals and
 * filter the list; the search takes a name or a ticket code (TKT-…); the
 * filter button narrows it to this phone.
 */
export default function Logs() {
  const door = useSession((s) => s.door);
  const me = useMe();
  const recent = useRecent('all', 100);
  const pending = pendingCount(useScanLog((s) => s.records));
  const totals = useQuery({
    queryKey: ['analytics', door?.token, 'logs'],
    queryFn: () => analytics(door!.token),
    enabled: Boolean(door),
    refetchInterval: 15_000,
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState<RecentScan | null>(null);

  const success = totals.data?.byMethod
    ? Object.values(totals.data.byMethod).reduce((a, b) => a + b, 0)
    : totals.data?.stats.admitted ?? 0;
  const failed = (totals.data?.refusals ?? []).reduce((a, r) => a + r.count, 0);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^tkt-?/, '');
    const label = me.data?.device.label;
    return (recent.data ?? []).filter((r) => {
      if (filter === 'success' && r.result !== 'admitted') return false;
      if (filter === 'failed' && (r.result === 'admitted' || r.result === 'undone')) return false;
      if (mine && label && r.device !== label) return false;
      if (!q) return true;
      return (r.holder ?? '').toLowerCase().includes(q) || (r.ticketId ?? '').replace(/-/g, '').startsWith(q);
    });
  }, [recent.data, filter, search, mine, me.data?.device.label]);

  return (
    <Screen bar={<TabBar active="logs" mode="door" />}>
      <ScreenTitle>Check-in Logs</ScreenTitle>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or ticket..."
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Search the logs by name or ticket"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mine ? 'Show every door' : 'Show this phone only'}
          accessibilityState={{ selected: mine }}
          onPress={() => setMine((m) => !m)}
          style={[styles.filterButton, mine && styles.filterOn]}
          hitSlop={6}
        >
          <Icon name="filter" size={20} color={mine ? colors.white : colors.text} />
        </Pressable>
      </View>

      <View style={styles.cards} accessibilityRole="tablist">
        <StatCard label="All" value={success + failed} on={filter === 'all'} onPress={() => setFilter('all')} />
        <StatCard label="Success" value={success} on={filter === 'success'} onPress={() => setFilter('success')} />
        <StatCard label="Failed" value={failed} on={filter === 'failed'} onPress={() => setFilter('failed')} danger />
      </View>
      {mine && <Text variant="small" color={colors.muted}>Showing this phone only ({me.data?.device.label}).</Text>}
      {pending > 0 && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/sync')} style={styles.pending}>
          <Icon name="cloudUpload" size={18} color={colors.accent} />
          <Text variant="small" weight="semibold" color={colors.accent} style={{ flex: 1 }}>
            {pending} check-in{pending === 1 ? '' : 's'} on this phone waiting to sync
          </Text>
          <Icon name="chevronRight" size={18} color={colors.accent} />
        </Pressable>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={(
          <RefreshControl
            refreshing={recent.isRefetching}
            onRefresh={() => { recent.refetch(); totals.refetch(); }}
            tintColor={colors.accent}
          />
        )}
        ListEmptyComponent={recent.isLoading ? undefined : (
          <Empty icon="logs" title={search ? 'Nothing matches' : 'No check-ins yet'} body="Every scan at this event appears here as it happens." />
        )}
        renderItem={({ item, index }) => <LogRow scan={item} first={index === 0} onPress={() => setSelected(item)} />}
      />

      <Sheet visible={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected && (
          <LogDetail
            scan={selected}
            onTicket={selected.ticketId ? () => {
              const ticketId = selected.ticketId!;
              setSelected(null);
              setTimeout(() => router.push({ pathname: '/ticket/[ticketId]', params: { ticketId } }), AFTER_SHEET_MS);
            } : undefined}
            onClose={() => setSelected(null)}
          />
        )}
      </Sheet>
    </Screen>
  );
}

const METHOD: Record<string, string> = { scan: 'QR code scan', manual: 'By hand', offline: 'Scanned offline' };
const BADGE: Record<'admit' | 'refuse' | 'warn' | 'hold', { bg: string; fg: string }> = {
  admit: { bg: colors.successHalo, fg: colors.success },
  refuse: { bg: colors.dangerHalo, fg: colors.danger },
  warn: { bg: colors.warningHalo, fg: colors.warning },
  hold: { bg: colors.holdSoft, fg: colors.hold },
};

/** One entry of the log, in full: what the door answered, for whom, when, where and how. */
function LogDetail({ scan, onTicket, onClose }: { scan: RecentScan; onTicket?: () => void; onClose: () => void }) {
  const o = describeScan(scan.result);
  const s = STATUS[o.tone];
  const b = BADGE[o.tone];
  return (
    <View style={{ gap: space.md }}>
      <View style={[styles.detailHead, { backgroundColor: b.bg }]}>
        <View style={[styles.detailIcon, { backgroundColor: s.color }]}>
          <Icon name={s.icon} size={20} color={colors.white} strokeWidth={3} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" color={b.fg}>{o.title}</Text>
          <Text variant="small" color={b.fg}>{eventDate(scan.at)} at {doorTime(scan.at)}</Text>
        </View>
      </View>

      <View style={styles.detailWho}>
        <Avatar name={scan.holder} size={48} />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={2}>{scan.holder || 'Guest'}</Text>
          {scan.tier ? <Text variant="small" color={colors.muted}>{scan.tier}</Text> : null}
        </View>
      </View>

      <View style={styles.detailRows}>
        {scan.ticketId ? <InfoRow icon="qr" label="Ticket" value={ticketCode(scan.ticketId)} /> : null}
        <InfoRow icon="scan" label="How" value={METHOD[scan.method] ?? scan.method} />
        {scan.device ? <InfoRow icon="tablet" label="Door" value={scan.device} /> : null}
        <InfoRow icon="user" label="Staff" value={scan.staff || '—'} last={!scan.conflict} />
        {scan.conflict ? <InfoRow icon="alert" label="Flag" value="Let in at two doors offline" valueColor={colors.warning} last /> : null}
      </View>

      {scan.result !== 'admitted' && o.note ? <Text variant="small" color={colors.muted}>{o.note}</Text> : null}

      {onTicket ? <Button label="View Ticket" icon="ticket" onPress={onTicket} /> : null}
      <Button label="Close" variant="ghost" onPress={onClose} />
    </View>
  );
}

function StatCard({ label, value, on, onPress, danger = false }: { label: string; value: number; on: boolean; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={[styles.card, on && styles.cardOn, danger && !on && value > 0 && styles.cardDanger]}
    >
      <Text variant="small" weight="medium" color={on ? colors.white : danger && value > 0 ? colors.dangerGlyph : colors.muted}>{label}</Text>
      <Text style={styles.cardValue} color={on ? colors.white : danger && value > 0 ? colors.dangerGlyph : colors.text}>{count(value)}</Text>
    </Pressable>
  );
}

const STATUS: Record<'admit' | 'refuse' | 'warn' | 'hold', { icon: IconName; color: string }> = {
  admit: { icon: 'tick', color: colors.successStrong },
  refuse: { icon: 'close', color: colors.dangerGlyph },
  warn: { icon: 'alert', color: colors.warningGlyph },
  hold: { icon: 'clock', color: colors.hold },
};

function LogRow({ scan, first, onPress }: { scan: RecentScan; first: boolean; onPress: () => void }) {
  const o = describeScan(scan.result);
  const s = STATUS[o.tone];
  const code = ticketCode(scan.ticketId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${scan.holder || 'Guest'}, ${o.title}, ${doorTime(scan.at)}`}
      accessibilityHint="Shows this check-in in full"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowRule, pressed && { opacity: 0.6 }]}
    >
      <Avatar name={scan.holder} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={1}>{scan.holder || scan.tier || 'Guest'}</Text>
        <Text variant="small" color={colors.muted} numberOfLines={1}>
          {[code, doorTime(scan.at), scan.result === 'admitted' ? null : o.title].filter(Boolean).join(' • ')}
        </Text>
      </View>
      <View style={[styles.status, { backgroundColor: s.color }]}>
        <Icon name={s.icon} size={14} color={colors.white} strokeWidth={3} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  search: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    minHeight: 46, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text },
  filterButton: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: colors.accent },
  cards: { flexDirection: 'row', gap: space.sm },
  card: {
    flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  cardOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  cardDanger: { borderColor: colors.dangerGlyph },
  cardValue: { fontFamily: 'DMSans_700Bold', fontSize: 22, lineHeight: 28 },
  pending: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    minHeight: 44, borderRadius: radius.md, backgroundColor: colors.mint,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  status: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md },
  detailIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  detailWho: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  detailRows: { backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: space.md },
});
