import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { useSession } from '@/auth/session';
import { signal } from '@/gate/feedback';
import { admits, describeScan, screenResult } from '@/gate/outcomes';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit } from '@/gate/useDoor';
import { doorTime, ticketCode } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { dialog } from '@/ui/Dialog';
import { Icon, type IconName } from '@/ui/Icon';
import { Card, FactRow, Header, Screen, StatusIcon } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

const AUTO_CONTINUE_MS = 2000;
const UNDO_WINDOW_MS = 60_000;

/** Which of the mockup's three answer layouts, by outcome. */
const BADGE = { admit: 'success', warn: 'warning', refuse: 'danger', hold: 'hold' } as const;
const ICON: Partial<Record<string, IconName>> = {
  duplicate: 'history', undone: 'undo', error: 'alert', offline_unconfirmed: 'offline', queued: 'cloudUpload', sending: 'clock',
};

/**
 * The answer, in the mockup's three layouts:
 *   Check-in Successful   green tick, the guest, the ticket, the seat, the time
 *   Already Checked In    amber, with when they were let in
 *   Invalid Ticket        red, for every refusal, with the reason
 * An admission returns to the camera on its own after two seconds (a setting);
 * anything else stays until someone has read it.
 */
export default function Result() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const record = useScanLog((s) => s.records.find((r) => r.clientScanId === id));
  const door = useSession((s) => s.door);
  const autoContinue = useSettings((s) => s.autoContinue);
  const exit = useDoorExit();
  const [held, setHeld] = useState(false); // the operator touched something: no auto-return
  const [undoing, setUndoing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const result = screenResult(record);
  const outcome = describeScan(result, (record?.answer as { reason?: string } | undefined)?.reason ?? null);
  const a = record?.answer;

  useEffect(() => {
    if (admits(result) && autoContinue && !held) {
      timer.current = setTimeout(() => router.back(), AUTO_CONTINUE_MS);
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [result, autoContinue, held]);

  // Undo is offered for a minute after the scan: long enough to catch a
  // mistake at the door, short enough that it is not a way to re-admit later.
  const [undoExpired, setUndoExpired] = useState(false);
  const occurredAt = record?.occurredAt;
  useEffect(() => {
    if (!occurredAt) return undefined;
    const left = Math.max(0, UNDO_WINDOW_MS - (Date.now() - Date.parse(occurredAt)));
    const t = setTimeout(() => setUndoExpired(true), left);
    return () => clearTimeout(t);
  }, [occurredAt]);

  const stop = () => {
    setHeld(true);
    if (timer.current) clearTimeout(timer.current);
  };

  async function undo() {
    if (!record || !door) return;
    stop();
    setUndoing(true);
    try {
      await useScanLog.getState().undo(record, door.token);
      signal('warn');
    } catch (err) {
      if (!(await exit(err))) dialog.alert('Could not undo', messageFor(err), { tone: 'danger', icon: 'undo' });
    } finally {
      setUndoing(false);
    }
  }

  const admitted = admits(result);
  const canUndo = admitted && Boolean(record?.ticketId) && !undoExpired;
  // The server's duplicate message carries a time in the EVENT's zone; this
  // screen shows every time on the phone's clock, so it uses its own words.
  const detail = (result === 'duplicate' || admitted ? null : record?.message) || outcome.note;
  const name = a?.attendee || null;
  const seat = [a?.seat, a?.table && `Table ${a.table}`].filter(Boolean).join(' • ');
  const code = ticketCode(record?.ticketId ?? a?.ticket_id);
  const firstAt = a?.first_scan?.at ?? (result === 'duplicate' ? a?.scanned_at : undefined);
  // Refused by this phone with no signal (never uploaded, so never synced).
  const refusedByPhone = record?.method === 'offline' && record.state === 'done' && !record.syncedAt;

  const footer = admitted ? (
    <Button label="Scan Next" onPress={() => router.back()} />
  ) : (
    <>
      {result === 'duplicate' && record?.ticketId && (
        <Button
          label="View Details"
          variant="secondary"
          onPress={() => { stop(); router.push({ pathname: '/ticket/[ticketId]', params: { ticketId: record.ticketId! } }); }}
        />
      )}
      <Button label="Scan Another" onPress={() => router.back()} />
    </>
  );

  return (
    <Screen waves="both" footer={footer}>
      {admitted ? <View style={styles.spacer} /> : <Header onBack={() => router.back()} />}
      <View style={styles.hero} accessible accessibilityRole="alert" accessibilityLabel={`${outcome.title}. ${detail}`} onTouchStart={stop}>
        <StatusIcon kind={BADGE[outcome.tone]} icon={ICON[result]} />
        <Text variant="heading" align="center">{outcome.title}</Text>
        {!admitted && <Text color={colors.muted} align="center" style={styles.detail}>{detail}</Text>}
      </View>

      {admitted ? (
        <Card style={styles.card}>
          <FactRow icon="user"><Text variant="body" weight="medium">{name || 'Guest'}</Text></FactRow>
          {code ? <FactRow icon="ticket"><Text variant="body" weight="medium">{code}</Text></FactRow> : null}
          {seat ? <FactRow icon="seat"><Text variant="body" weight="medium">{seat}</Text></FactRow> : null}
          {a?.tier && !seat ? <FactRow icon="ticket"><Text variant="body" weight="medium">{a.tier}</Text></FactRow> : null}
          <FactRow icon="clock"><Text variant="body" weight="medium">{doorTime(a?.scanned_at || record?.occurredAt)}</Text></FactRow>
        </Card>
      ) : result === 'duplicate' ? (
        <Card style={styles.card}>
          <FactRow icon="user"><Text variant="body" weight="medium">{name || 'Guest'}</Text></FactRow>
          {code ? <FactRow icon="ticket"><Text variant="body" weight="medium">{code}</Text></FactRow> : null}
          {firstAt ? (
            <FactRow icon="check" iconColor={colors.successStrong}>
              <Text variant="body" weight="medium">Checked in at {doorTime(firstAt)}</Text>
              {a?.first_scan && (a.first_scan.device || a.first_scan.staff) ? (
                <Text variant="small" color={colors.muted}>{[a.first_scan.staff, a.first_scan.device].filter(Boolean).join(' at ')}</Text>
              ) : null}
            </FactRow>
          ) : null}
        </Card>
      ) : code ? (
        <Card style={styles.card}>
          <FactRow icon="ticket"><Text variant="body" weight="medium">{code}</Text></FactRow>
          {name ? <FactRow icon="user"><Text variant="body" weight="medium">{name}</Text></FactRow> : null}
        </Card>
      ) : null}

      {result === 'offline_admitted' && (
        <Note icon="offline">Saved on this phone with no signal. It syncs automatically.</Note>
      )}
      {refusedByPhone && <Note icon="offline">Checked on this phone with no signal.</Note>}
      {a?.conflict && <Note icon="alert">Two doors let this ticket in while offline. The organizer can see it on the door list.</Note>}

      {canUndo && (
        <Pressable onPress={undo} disabled={undoing} accessibilityRole="button" style={styles.undo} hitSlop={6}>
          <Icon name="undo" size={16} color={colors.muted} />
          <Text variant="small" color={colors.muted}>{undoing ? 'Reversing…' : 'Scanned by mistake? Undo'}</Text>
        </Pressable>
      )}
    </Screen>
  );
}

function Note({ icon, children }: { icon: IconName; children: string }) {
  return (
    <View style={styles.note}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text variant="small" color={colors.muted} style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  spacer: { height: space.xxl },
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.md },
  detail: { paddingHorizontal: space.xl },
  card: { paddingVertical: space.sm, marginTop: space.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  undo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.sm },
});
