import { useNetInfo } from '@react-native-community/netinfo';
import { router } from 'expo-router';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { useOfflineList } from '@/gate/offlineList';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useDoorExit, useGateStatus, useMe, useRecent } from '@/gate/useDoor';
import { lockedNote } from '@/gate/outcomes';
import { ago, count, doorTime, eventDate } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Ring } from '@/ui/charts';
import { Icon, type IconName } from '@/ui/Icon';
import { Card, Header, IconButton, Pill } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * The event's live door — the mockup's last screen. How many are in, how many
 * are still to come, who just arrived, and the way into the scanner. Counts
 * refresh every 10 seconds while the screen is in front.
 */
export default function Dashboard() {
  const door = useSession((s) => s.door);
  const leaveDoor = useSession((s) => s.leaveDoor);
  const signOut = useSession((s) => s.signOut);
  const exit = useDoorExit();
  const me = useMe();
  const status = useGateStatus();
  const recent = useRecent('admitted', 5);
  const net = useNetInfo();
  const records = useScanLog((s) => s.records);
  const syncing = useScanLog((s) => s.syncing);
  const held = pendingCount(records);
  const list = useOfflineList();
  const conflicts = records.filter((r) => r.answer?.conflict).length;

  const event = me.data?.event;
  const stats = status.data?.stats ?? me.data?.stats ?? null;
  const gate = status.data?.gate ?? me.data?.gate ?? null;
  const admitted = stats?.admitted ?? 0;
  const remaining = stats?.pending ?? 0;
  const total = admitted + remaining;
  const offline = net.isConnected === false || (status.isError && !status.isFetching);
  const perms = me.data?.permissions;

  function leave() {
    if (held > 0) {
      Alert.alert('Scans still waiting', `${held} scan(s) have not uploaded yet. Stay until they do, so nobody's admission is lost.`);
      return;
    }
    if (door?.kind === 'pin') {
      Alert.alert('Sign this device out?', 'You will need the device ID and PIN to sign it back in.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
      ]);
    } else {
      leaveDoor();
    }
  }

  async function uploadNow() {
    if (!door) return;
    const res = await useScanLog.getState().sync(door.token).catch(exit);
    if (res && typeof res === 'object' && res.conflicts > 0) {
      Alert.alert('Already inside', `${res.conflicts} guest(s) this phone let in offline had already been admitted at another door. The organizer can see them on the door list.`);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.pad}>
        <Header
          title={event?.title ?? door?.eventTitle ?? 'Event'}
          onBack={leave}
          right={<IconButton icon="settings" label="Settings" onPress={() => router.push('/settings')} />}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.pad, styles.body]}
        refreshControl={(
          <RefreshControl
            refreshing={status.isRefetching}
            onRefresh={() => { status.refetch(); recent.refetch(); me.refetch(); }}
            tintColor={colors.accent}
          />
        )}
      >
        {event && (
          <View style={styles.meta}>
            <Icon name="calendar" size={16} color={colors.muted} />
            <Text variant="small" color={colors.muted}>{eventDate(event.startsAt, event.timezone)}</Text>
            {(event.city || event.venue) && (
              <>
                <Icon name="pin" size={16} color={colors.muted} />
                <Text variant="small" color={colors.muted} numberOfLines={1}>{event.city || event.venue}</Text>
              </>
            )}
          </View>
        )}

        <Card style={styles.live}>
          <View style={styles.pillRow}>
            {gate?.locked && !gate.override ? (
              <Pill tone="refuse" label="Scanning switched off" />
            ) : offline ? (
              <Pill tone="hold" label={`Offline · updated ${ago(status.dataUpdatedAt ? new Date(status.dataUpdatedAt).toISOString() : null) || 'never'}`} />
            ) : (
              <Pill tone="admit" label="Live Check-in" />
            )}
          </View>
          {/* Why it is off — the door staff's next call differs for an unpaid
              invoice, an Eventsli stop and a cancellation. */}
          {gate?.locked && !gate.override && lockedNote(gate.reason) && (
            <Text variant="small" color={colors.danger} style={styles.lockNote}>{lockedNote(gate.reason)}</Text>
          )}
          <View style={styles.liveRow}>
            <Ring value={admitted} total={total} label={count(admitted)} sublabel="Checked In" />
            <View style={styles.legend}>
              <Legend color={colors.accent} label="Checked In" value={admitted} />
              <Legend color={colors.teal200} label="Remaining" value={remaining} />
              <Legend color={colors.teal100} label="Total" value={total} />
            </View>
          </View>
        </Card>

        {held > 0 && (
          <Pressable onPress={uploadNow} style={styles.held} accessibilityRole="button">
            <Icon name="offline" size={20} color={colors.hold} />
            <Text variant="small" style={{ flex: 1 }}>
              {held} scan{held === 1 ? '' : 's'} waiting to upload
            </Text>
            <Text variant="small" weight="semibold" color={colors.accent}>{syncing ? 'Uploading…' : 'Upload now'}</Text>
          </Pressable>
        )}

        <Pressable onPress={() => router.push('/offline')} style={styles.held} accessibilityRole="button">
          <Icon name={conflicts > 0 ? 'alert' : 'shield'} size={20} color={conflicts > 0 ? colors.warning : colors.muted} />
          <Text variant="small" style={{ flex: 1 }}>
            {conflicts > 0
              ? `${conflicts} guest${conflicts === 1 ? '' : 's'} let in at two doors offline`
              : list.off
                ? 'Offline check-in switched off by the organizer'
                : list.complete
                  ? `Offline check-in ready · ${count(list.count)} tickets`
                  : 'Offline check-in: getting the ticket list…'}
          </Text>
          <Icon name="chevronRight" size={18} color={colors.muted} />
        </Pressable>

        <View style={styles.actions}>
          <Action icon="scan" label="Scan" onPress={() => router.push('/scan')} />
          <Action
            icon="users"
            label="Attendees"
            disabled={perms ? !perms.viewGuests : false}
            onPress={() => (perms?.viewGuests
              ? router.push('/attendees')
              : Alert.alert('Guest list not shared', 'The organizer has not shared the guest list with the door team. You can still scan tickets.'))}
          />
          <Action icon="chart" label="Analytics" onPress={() => router.push('/analytics')} />
        </View>

        <View style={styles.sectionHead}>
          <Text variant="title">Recent Check-ins</Text>
          <Pressable onPress={() => router.push('/recent')} accessibilityRole="link" hitSlop={8} style={styles.viewAll}>
            <Text variant="small" weight="semibold" color={colors.accent}>View All</Text>
            <Icon name="arrow" size={16} color={colors.accent} />
          </Pressable>
        </View>
        <Card style={{ paddingVertical: space.xs }}>
          {(recent.data ?? []).length === 0 ? (
            <Text variant="small" color={colors.muted} style={{ paddingVertical: space.md }}>
              {recent.isLoading ? 'Loading…' : 'Nobody has checked in yet.'}
            </Text>
          ) : (
            recent.data!.map((r, i) => (
              <Pressable
                key={r.id}
                onPress={() => r.ticketId && router.push({ pathname: '/ticket/[ticketId]', params: { ticketId: r.ticketId } })}
                disabled={!r.ticketId}
                accessibilityRole="button"
                accessibilityHint="Opens the ticket"
                style={[styles.recentRow, i > 0 && styles.recentBorder]}
              >
                <View style={styles.tick}><Icon name="tick" size={14} color={colors.white} strokeWidth={3} /></View>
                <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{r.holder || r.tier || 'Guest'}</Text>
                <Text variant="small" color={colors.muted}>{doorTime(r.at)}</Text>
              </Pressable>
            ))
          )}
        </Card>
      </ScrollView>
      <View style={[styles.pad, styles.footer]}>
        <Button label="Scan Tickets" icon="scan" size="lg" onPress={() => router.push('/scan')} />
      </View>
    </SafeAreaView>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text variant="small" color={colors.muted} style={{ flex: 1 }}>{label}</Text>
      <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>{count(value)}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, disabled = false }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.teal50 }, disabled && { opacity: 0.55 }]}
    >
      <Icon name={icon} size={28} color={colors.accent} />
      <Text variant="small" weight="medium">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: space.lg },
  body: { gap: space.lg, paddingBottom: space.xl },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', flexWrap: 'wrap' },
  live: { gap: space.md, backgroundColor: colors.bgSunken, borderColor: colors.bgSunken },
  pillRow: { alignItems: 'center' },
  lockNote: { textAlign: 'center', marginTop: space.sm },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  legend: { flex: 1, gap: space.md },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  held: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.md, backgroundColor: colors.holdSoft,
  },
  actions: { flexDirection: 'row', gap: space.md },
  action: {
    flex: 1, alignItems: 'center', gap: space.sm, paddingVertical: space.lg,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  recentBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tick: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.successStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: { paddingTop: space.sm, paddingBottom: space.lg },
});
