import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSession } from '@/auth/session';
import { useOfflineList } from '@/gate/offlineList';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useDoorExit } from '@/gate/useDoor';
import { count, doorTime } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Card, Header, Pill, Screen } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * Offline check-in, as this phone stands: whether it can decide with no
 * signal (its copy of the event's ticket list), what is waiting to upload,
 * and the guests it let in offline whom another door had already admitted
 * (conflicts: both are inside; the organizer sees them on the door list).
 */
export default function Offline() {
  const door = useSession((s) => s.door);
  const exit = useDoorExit();
  const list = useOfflineList();
  const records = useScanLog((s) => s.records);
  const syncing = useScanLog((s) => s.syncing);
  const [busy, setBusy] = useState(false);
  const waiting = pendingCount(records);
  const admittedOffline = records.filter((r) => r.state !== 'done' && r.offlineVerdict === 'admitted').length;
  const conflicts = records.filter((r) => r.answer?.conflict);

  async function refresh() {
    if (!door) return;
    setBusy(true);
    try {
      await useScanLog.getState().sync(door.token);
      await useOfflineList.getState().pull(door.token);
    } catch (err) {
      exit(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Header title="Offline check-in" />

      <Card style={{ gap: space.sm }}>
        {list.off ? (
          <>
            <Pill label="Switched off" tone="hold" />
            <Text>The organizer has switched offline check-in off for this event. With no signal, scans are held and checked when it returns.</Text>
          </>
        ) : list.complete ? (
          <>
            <Pill label="Ready" tone="admit" />
            <Text>
              With no signal, this phone checks tickets itself, from its list of {count(list.count)} ticket{list.count === 1 ? '' : 's'}.
            </Text>
            <Text variant="small" color={colors.muted}>
              {list.syncedAt ? `List updated at ${doorTime(list.syncedAt)}. ` : ''}It refreshes every 15 seconds while there is signal.
            </Text>
            <Text variant="small" color={colors.muted}>
              {list.names ? 'Guest names are on this phone.' : 'No guest names on this phone: answers show the ticket type and seat.'}
              {' '}
              {list.legacyQrOffline === 'hold'
                ? 'Older ticket codes wait for a connection.'
                : 'Older ticket codes are let in if they are on the list.'}
            </Text>
          </>
        ) : (
          <>
            <Pill label={list.pulling ? 'Getting the list…' : 'Not ready'} tone="warn" />
            <Text>
              This phone has not got the event’s ticket list yet. Until it has, scans with no signal are held, not checked.
            </Text>
            {list.lastError && <Text variant="small" color={colors.muted}>{list.lastError}</Text>}
          </>
        )}
      </Card>

      <Card style={{ gap: space.xs }}>
        <View style={styles.row}>
          <Icon name="clock" size={20} color={colors.muted} />
          <Text variant="label" style={{ flex: 1 }}>Waiting to upload</Text>
          <Text variant="title">{count(waiting)}</Text>
        </View>
        {admittedOffline > 0 && (
          <Text variant="small" color={colors.muted}>
            {admittedOffline} of them let in on this phone offline. They count on the dashboard once uploaded.
          </Text>
        )}
      </Card>

      {conflicts.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <View style={styles.row}>
            <Icon name="alert" size={20} color={colors.warning} />
            <Text variant="label" style={{ flex: 1 }}>Let in at two doors</Text>
          </View>
          <Text variant="small" color={colors.muted}>
            This phone let these guests in with no signal, but another door had already admitted them. Both are inside; the organizer can see them on the door list.
          </Text>
          {conflicts.map((r) => (
            <View key={r.clientScanId} style={styles.conflict}>
              <Text variant="label" numberOfLines={1}>{r.answer?.attendee || r.answer?.tier || 'Guest'}</Text>
              <Text variant="small" color={colors.muted}>
                Here at {doorTime(r.occurredAt)}{r.answer?.first_scan?.at ? ` · first at ${doorTime(r.answer.first_scan.at)}` : ''}
                {r.answer?.first_scan?.device ? ` (${r.answer.first_scan.device})` : ''}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Button
        label={busy || syncing || list.pulling ? 'Updating…' : 'Upload and refresh now'}
        icon="refresh"
        variant="secondary"
        disabled={busy}
        onPress={refresh}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  conflict: { gap: 2, paddingTop: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
