import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { messageFor } from '@/api/client';
import { useSession } from '@/auth/session';
import { signal } from '@/gate/feedback';
import { admits, describeScan } from '@/gate/outcomes';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit } from '@/gate/useDoor';
import { doorTime, eventWhen } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Card, FactRow, Header } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space, tones } from '@/ui/theme';

const AUTO_CONTINUE_MS = 2000;
const UNDO_WINDOW_MS = 60_000;

const ICONS: Record<string, IconName> = { admit: 'tick', refuse: 'close', warn: 'alert', hold: 'clock' };

/**
 * The answer — the mockup's "Check-in Successful", and every other answer in
 * the same frame. The whole screen carries the tone, so it reads at arm's
 * length. An admission returns to the camera on its own after two seconds (a
 * setting); a refusal stays until someone has read it.
 */
export default function Result() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const record = useScanLog((s) => s.records.find((r) => r.clientScanId === id));
  const door = useSession((s) => s.door);
  const autoContinue = useSettings((s) => s.autoContinue);
  const exit = useDoorExit();
  const [held, setHeld] = useState(false);   // the operator touched something: no auto-return
  const [undoing, setUndoing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const result = !record ? 'sending' : record.state === 'done' ? (record.result as string) : record.state;
  const outcome = describeScan(result);
  const tone = tones[outcome.tone];
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
      if (!(await exit(err))) Alert.alert('Could not undo', messageFor(err));
    } finally {
      setUndoing(false);
    }
  }

  const canUndo = admits(result) && Boolean(record?.ticketId) && !undoExpired;
  const name = a?.attendee || null;
  const seat = [a?.seat, a?.table].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={styles.pad}>
        <Header title="" onBack={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={[styles.pad, styles.body]} onTouchStart={stop}>
        <View style={styles.hero} accessible accessibilityRole="alert" accessibilityLabel={`${outcome.title}. ${record?.message || outcome.note}`}>
          <View style={[styles.halo, { backgroundColor: tone.soft }]}>
            <View style={[styles.disc, { backgroundColor: tone.strong }]}>
              <Icon name={ICONS[outcome.tone]} size={46} color={colors.white} strokeWidth={3} />
            </View>
          </View>
          <Text variant="heading" align="center">{outcome.title}</Text>
          {result === 'duplicate' && a?.first_scan?.at && (
            <Text variant="title" align="center" color={tone.fg}>at {doorTime(a.first_scan.at)}</Text>
          )}
        </View>

        {(name || a?.tier || a?.event_title) && (
          <Card style={{ gap: 2 }}>
            {name && (
              <FactRow icon="user">
                <Text variant="label">{name}</Text>
                {a?.holder_is_buyer && <Text variant="caption" color={colors.subtle}>Name on the order</Text>}
              </FactRow>
            )}
            {a?.tier && <FactRow icon="ticket"><Text variant="label" weight="medium">{a.tier}</Text></FactRow>}
            {seat ? <FactRow icon="pin"><Text variant="label" weight="medium">{seat}</Text></FactRow> : null}
            {a?.event_title && <FactRow icon="calendar"><Text variant="label" weight="medium">{a.event_title}</Text></FactRow>}
            {a?.event_starts_at && (
              <FactRow icon="clock">
                <Text variant="label" weight="medium">{eventWhen(a.event_starts_at, a.event_timezone)}</Text>
              </FactRow>
            )}
          </Card>
        )}

        <View style={[styles.verdict, { backgroundColor: tone.soft }]}>
          {admits(result) ? (
            <>
              <View style={styles.verdictRow}>
                <Icon name="tick" size={26} color={tone.fg} strokeWidth={2.6} />
                <Text variant="title" color={tone.fg}>Admitted</Text>
              </View>
              <Text color={colors.text}>Checked in at {doorTime(a?.scanned_at || record?.occurredAt)}</Text>
            </>
          ) : (
            <>
              <Text variant="label" color={tone.fg} align="center">{record?.message || outcome.note}</Text>
              {result === 'duplicate' && a?.first_scan && (a.first_scan.device || a.first_scan.staff) && (
                <Text variant="small" color={colors.muted} align="center">
                  First scanned by {[a.first_scan.staff, a.first_scan.device].filter(Boolean).join(' at ')}
                </Text>
              )}
              {a?.conflict && (
                <Text variant="small" color={colors.muted} align="center">
                  Two doors let this ticket in while offline. The organizer can see it on the door list.
                </Text>
              )}
            </>
          )}
        </View>

        {canUndo && (
          <Pressable onPress={undo} disabled={undoing} accessibilityRole="button" style={styles.undo}>
            <Icon name="undo" size={18} color={colors.muted} />
            <Text variant="small" color={colors.muted}>{undoing ? 'Reversing…' : 'Scanned by mistake? Undo this check-in'}</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.pad, styles.buttons]}>
        <Button label="Scan Next" icon="scan" variant="secondary" style={{ flex: 1 }} onPress={() => router.back()} />
        {record?.ticketId && result !== 'invalid' && result !== 'wrong_event' ? (
          <Button
            label="View Details"
            style={{ flex: 1 }}
            onPress={() => { stop(); router.push({ pathname: '/ticket/[ticketId]', params: { ticketId: record.ticketId! } }); }}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: space.lg },
  body: { gap: space.lg, paddingBottom: space.lg },
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.sm },
  halo: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },
  verdict: { borderRadius: radius.lg, padding: space.lg, alignItems: 'center', gap: space.xs },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  undo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.sm },
  buttons: { flexDirection: 'row', gap: space.md, paddingTop: space.sm, paddingBottom: space.md },
});
