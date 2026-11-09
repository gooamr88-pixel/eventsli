import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { ticket as ticketCall } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { signal } from '@/gate/feedback';
import { describeScan } from '@/gate/outcomes';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit, useMe } from '@/gate/useDoor';
import { doorTime } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Card, Empty, FactRow, Header, Pill, Screen } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

const METHOD: Record<string, string> = { scan: 'Scanned', manual: 'Checked in by hand', offline: 'Scanned offline' };

/**
 * One ticket: who it is for, where it stands, and everything that happened to
 * it at the door. Manual check-in lives here — for a dead phone or a code that
 * will not read — when the organizer allows it.
 */
export default function TicketDetail() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const door = useSession((s) => s.door);
  const me = useMe();
  const exit = useDoorExit();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['ticket', door?.token, ticketId],
    queryFn: () => ticketCall(door!.token, ticketId),
    enabled: Boolean(door && ticketId),
  });

  useEffect(() => {
    if (q.error) exit(q.error);
  }, [q.error, exit]);

  const t = q.data;
  const inside = t?.status === 'scanned';

  async function checkIn() {
    if (!door || !t) return;
    setBusy(true);
    try {
      const rec = await useScanLog.getState().manual(t.ticketId, door.token);
      signal(describeScan(rec.result || 'error').tone);
      client.invalidateQueries({ queryKey: ['ticket'] });
      client.invalidateQueries({ queryKey: ['status'] });
      client.invalidateQueries({ queryKey: ['recent'] });
      client.invalidateQueries({ queryKey: ['attendees'] });
      router.push({ pathname: '/result', params: { id: rec.clientScanId } });
    } catch (err) {
      if (!(await exit(err))) Alert.alert('Could not check in', messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmCheckIn() {
    Alert.alert(
      'Check this guest in?',
      `${t?.holder || 'This guest'}${t?.tier ? ` · ${t.tier}` : ''}\n\nCheck their name against an ID before you do — no code was scanned.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Check in', onPress: checkIn }],
    );
  }

  return (
    <Screen
      scroll
      footer={t && t.status === 'valid' && t.orderPaid && me.data?.permissions.manualCheckIn ? (
        <Button label="Check in by hand" icon="tick" busy={busy} onPress={confirmCheckIn} />
      ) : undefined}
    >
      <Header title="Ticket" />
      {!t ? (
        q.isLoading ? <Text color={colors.muted}>Loading…</Text> : (
          <Empty icon="ticket" title="Ticket not found" body={q.error ? messageFor(q.error) : 'It is not a ticket for this event.'} />
        )
      ) : (
        <>
          <View style={{ alignItems: 'center', gap: space.sm }}>
            {t.status === 'void' || !t.orderPaid ? (
              <Pill tone="refuse" label="Not valid" />
            ) : inside ? (
              <Pill tone="admit" label={`Checked in · ${doorTime(t.scannedAt)}`} />
            ) : (
              <Pill tone="hold" label="Not checked in yet" />
            )}
          </View>
          <Card style={{ gap: 2 }}>
            <FactRow icon="user">
              <Text variant="label">{t.holder || 'Name not given'}</Text>
              {t.holderIsBuyer && <Text variant="caption" color={colors.subtle}>Name on the order</Text>}
              {t.transferred && !t.holder && <Text variant="caption" color={colors.subtle}>Transferred — ask for the code</Text>}
            </FactRow>
            {t.tier && <FactRow icon="ticket"><Text variant="label" weight="medium">{t.tier}</Text></FactRow>}
            {(t.seat || t.table) && (
              <FactRow icon="pin"><Text variant="label" weight="medium">{[t.seat, t.table].filter(Boolean).join(' · ')}</Text></FactRow>
            )}
            <FactRow icon="qr"><Text variant="small" color={colors.muted}>Ticket {t.ticketId.slice(0, 8).toUpperCase()}</Text></FactRow>
          </Card>

          <Text variant="title">At the door</Text>
          <Card style={{ gap: space.md }}>
            {t.history.length === 0 ? (
              <Text variant="small" color={colors.muted}>Not scanned yet.</Text>
            ) : t.history.map((h, i) => (
              <View key={`${h.at}-${i}`} style={styles.event}>
                <View style={[styles.dot, { backgroundColor: h.result === 'admitted' ? colors.successStrong : h.result === 'undone' ? colors.warningStrong : colors.dangerStrong }]} />
                <View style={{ flex: 1 }}>
                  <Text variant="label" weight="medium">
                    {describeScan(h.result).title}{h.conflict ? ' · two doors' : ''}
                  </Text>
                  <Text variant="small" color={colors.muted}>
                    {[doorTime(h.at), METHOD[h.method] || null, h.staff || h.device].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  event: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
});
