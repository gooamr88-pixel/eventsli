import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { messageFor } from '@/api/client';
import { ticket as ticketCall } from '@/api/endpoints';
import type { TicketDetail as Ticket } from '@/api/types';
import { useSession } from '@/auth/session';
import { signal } from '@/gate/feedback';
import { describeScan } from '@/gate/outcomes';
import { useScanLog } from '@/gate/scanLog';
import { useDoorExit, useMe } from '@/gate/useDoor';
import { doorTime, eventDate, ticketCode } from '@/lib/format';
import { Button } from '@/ui/Button';
import { dialog } from '@/ui/Dialog';
import { Avatar, Card, Empty, Header, InfoRow, Pill, Screen, Section } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, space, type Tone } from '@/ui/theme';

const METHOD: Record<string, string> = { scan: 'Scanned', manual: 'Checked in by hand', offline: 'Scanned offline' };

function standing(t: Ticket): { tone: Tone; label: string } {
  if (t.status === 'void') return { tone: 'refuse', label: 'Cancelled' };
  if (!t.orderPaid) return { tone: 'refuse', label: 'Not paid' };
  if (t.status === 'scanned') return { tone: 'admit', label: `Checked in · ${doorTime(t.scannedAt)}` };
  return { tone: 'hold', label: 'Not checked in yet' };
}

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
      if (!(await exit(err))) dialog.alert('Could not check in', messageFor(err), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCheckIn() {
    const yes = await dialog.confirm({
      title: 'Check this guest in?',
      message: `${t?.holder || 'This guest'}${t?.tier ? ` · ${t.tier}` : ''}. No code was scanned, so check their name against an ID first.`,
      confirm: 'Check in',
      icon: 'user',
    });
    if (yes) await checkIn();
  }

  const canCheckIn = Boolean(t && t.status === 'valid' && t.orderPaid && me.data?.permissions.manualCheckIn);

  return (
    <Screen
      scroll
      footer={canCheckIn ? <Button label="Check in by hand" icon="tick" busy={busy} onPress={() => { void confirmCheckIn(); }} /> : undefined}
    >
      <Header title="Ticket" />
      {!t ? (
        q.isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.xxl }} /> : (
          <Empty icon="ticket" title="Ticket not found" body={q.error ? messageFor(q.error) : 'It is not a ticket for this event.'} />
        )
      ) : (
        <>
          <Card style={styles.hero}>
            <Avatar name={t.holder} size={64} />
            <Text variant="title" align="center">{t.holder || 'Name not given'}</Text>
            <Text variant="small" color={colors.muted} align="center">
              {[ticketCode(t.ticketId), t.tier].filter(Boolean).join(' • ')}
            </Text>
            <Pill tone={standing(t).tone} label={standing(t).label} />
            {t.holderIsBuyer && <Text variant="caption" color={colors.subtle}>Name from the order</Text>}
            {t.transferred && !t.holder && <Text variant="caption" color={colors.subtle}>Transferred: ask the guest for their code</Text>}
          </Card>

          <Section title="Details">
            <Card style={styles.rows}>
              <InfoRow icon="ticket" label="Ticket type" value={t.tier || '—'} />
              {t.seat ? <InfoRow icon="seat" label="Seat" value={t.seat} /> : null}
              {t.table ? <InfoRow icon="grid" label="Table" value={t.table} /> : null}
              <InfoRow
                icon="receipt"
                label="Order"
                value={t.orderPaid ? 'Paid' : 'Not paid'}
                valueColor={t.orderPaid ? colors.success : colors.danger}
              />
              {t.transferred ? <InfoRow icon="share" label="Transferred" value="Yes" /> : null}
              <InfoRow icon="qr" label="Ticket code" value={ticketCode(t.ticketId)} last />
            </Card>
          </Section>

          <Section title="At the door">
            <Card>
              {t.history.length === 0 ? (
                <Text variant="small" color={colors.muted}>Not scanned yet.</Text>
              ) : t.history.map((h, i) => {
                const tone = describeScan(h.result).tone;
                const dot = tone === 'admit' ? colors.successStrong : tone === 'warn' ? colors.warningStrong : tone === 'refuse' ? colors.dangerStrong : colors.hold;
                const last = i === t.history.length - 1;
                return (
                  <View key={`${h.at}-${i}`} style={styles.step}>
                    <View style={styles.rail}>
                      <View style={[styles.dot, { backgroundColor: dot }]} />
                      {!last && <View style={styles.line} />}
                    </View>
                    <View style={[styles.stepBody, !last && { paddingBottom: space.lg }]}>
                      <Text variant="body" weight="semibold">
                        {describeScan(h.result).title}{h.conflict ? ' · two doors' : ''}
                      </Text>
                      <Text variant="small" color={colors.muted}>
                        {[`${eventDate(h.at)} ${doorTime(h.at)}`, METHOD[h.method] || null].filter(Boolean).join(' · ')}
                      </Text>
                      {(h.staff || h.device) ? (
                        <Text variant="caption" color={colors.subtle}>{[h.staff, h.device].filter(Boolean).join(' at ')}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  rows: { paddingVertical: space.xs },
  step: { flexDirection: 'row', gap: space.md },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 4 },
  stepBody: { flex: 1, gap: 2 },
});
