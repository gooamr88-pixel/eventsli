import { useNetInfo } from '@react-native-community/netinfo';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { RecentScan } from '@/api/types';
import { useSession } from '@/auth/session';
import { useOfflineList } from '@/gate/offlineList';
import { describeScan, lockedNote } from '@/gate/outcomes';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useDoorExit, useGateStatus, useMe, useRecent } from '@/gate/useDoor';
import { count, doorTime, eventDate, percent, ticketCode } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { ShareBar } from '@/ui/charts';
import { dialog, type SheetOption } from '@/ui/Dialog';
import { Icon, type IconName } from '@/ui/Icon';
import { Avatar, Card, ListRow, Section, ToggleRow } from '@/ui/layout';
import { TabBar } from '@/ui/TabBar';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

const HERO = 260;
const RECENT = 5;

/**
 * The event, as the mockup draws it: its cover with the title, date and city
 * and whether check-in is live; the counts (Total, Checked In, Remaining,
 * refreshed every 10 s) with how far along the door is; Start Check-in; quick
 * ways to the guest list, analytics and logs; the latest check-ins; and the
 * event's details, its guest list for offline check-in, and Offline Mode.
 * Back leaves the event.
 */
export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const door = useSession((s) => s.door);
  const leaveDoor = useSession((s) => s.leaveDoor);
  const signOut = useSession((s) => s.signOut);
  const exit = useDoorExit();
  const me = useMe();
  const status = useGateStatus();
  const recent = useRecent('all', RECENT);
  const net = useNetInfo();
  const records = useScanLog((s) => s.records);
  const list = useOfflineList();
  const offlineMode = useSettings((s) => s.offlineMode);
  const [downloading, setDownloading] = useState(false);
  const held = pendingCount(records);
  const conflicts = records.filter((r) => r.answer?.conflict).length;

  const event = me.data?.event;
  const stats = status.data?.stats ?? me.data?.stats ?? null;
  const gate = status.data?.gate ?? me.data?.gate ?? null;
  const admitted = stats?.admitted ?? 0;
  const remaining = stats?.pending ?? 0;
  const total = admitted + remaining;
  const share = percent(admitted, total);
  const offline = net.isConnected === false || (status.isError && !status.isFetching);
  const perms = me.data?.permissions;
  const title = event?.title ?? door?.eventTitle ?? 'Event';
  const pin = door?.kind === 'pin';

  function waiting(): boolean {
    if (held === 0) return false;
    dialog.show({
      tone: 'warning',
      icon: 'cloudUpload',
      title: 'Check-ins still waiting',
      message: `${held} check-in${held === 1 ? ' has' : 's have'} not synced yet. Stay until they do, so nobody's admission is lost.`,
      actions: [
        ...(offline ? [] : [{ label: 'Sync now', kind: 'primary' as const, onPress: () => router.push('/sync') }]),
        { label: offline ? 'OK' : 'Not now', kind: 'cancel' as const },
      ],
    });
    return true;
  }

  async function leave() {
    if (waiting()) return;
    if (pin) {
      const yes = await dialog.confirm({
        title: 'Sign this device out?',
        message: 'It stops scanning. You will need the device ID and PIN to sign it back in.',
        confirm: 'Sign out',
        destructive: true,
        icon: 'exit',
      });
      if (yes) await signOut();
      return;
    }
    const yes = await dialog.confirm({
      title: 'Leave this event?',
      message: `You go back to My Events. ${title}'s guest list is removed from this phone.`,
      confirm: 'Leave event',
      icon: 'exit',
    });
    if (yes) await leaveDoor();
  }

  function more() {
    const options: SheetOption[] = [
      { icon: 'info', label: 'Event Details', onPress: () => router.push('/event') },
    ];
    if (perms?.viewGuests) options.push({ icon: 'users', label: 'Find a Guest', hint: 'Search the guest list by name or ticket', onPress: () => router.push('/attendees') });
    if (perms?.analytics) options.push({ icon: 'chart', label: 'Analytics', hint: 'Arrivals, pace and ticket types', onPress: () => router.push('/analytics') });
    options.push({ icon: 'logs', label: 'Check-in Logs', onPress: () => router.push('/logs') });
    options.push({ icon: 'refresh', label: 'Data & Sync', hint: held > 0 ? `${held} waiting to sync` : 'The guest list on this phone', onPress: () => router.push('/settings/data-sync') });
    options.push({ icon: 'exit', label: pin ? 'Sign This Device Out' : 'Leave This Event', danger: true, onPress: () => { void leave(); } });
    dialog.actions({ title, subtitle: event ? eventDate(event.startsAt, event.timezone) : undefined, options });
  }

  async function download() {
    if (!door || downloading) return;
    if (!offlineMode) {
      dialog.show({
        icon: 'offline',
        title: 'Offline Mode is off',
        message: 'Turn on Offline Mode to keep the guest list on this phone, so tickets can be checked with no signal.',
        actions: [
          { label: 'Turn on Offline Mode', kind: 'primary', onPress: () => { void setOffline(true); } },
          { label: 'Not now', kind: 'cancel' },
        ],
      });
      return;
    }
    setDownloading(true);
    try {
      const ready = await useOfflineList.getState().pull(door.token);
      const s = useOfflineList.getState();
      if (s.off) dialog.alert('Not available', 'The organizer has switched offline check-in off for this event.', { tone: 'warning', icon: 'ban' });
      else if (ready) dialog.alert('Guest list downloaded', `${count(s.count)} tickets are on this phone, ready for check-in with no signal.`, { tone: 'success', icon: 'download', button: 'Great' });
      else dialog.alert('Could not download', s.lastError ?? 'Try again when there is a signal.', { tone: 'danger', icon: 'offline' });
    } catch (err) {
      exit(err);
    } finally {
      setDownloading(false);
    }
  }

  async function setOffline(on: boolean) {
    await useSettings.getState().set({ offlineMode: on });
    if (!on) await useOfflineList.getState().wipe().catch(() => undefined);
    else if (door) useOfflineList.getState().pull(door.token).catch(exit);
  }

  const listValue = !offlineMode ? 'Off'
    : list.off ? 'Off for this event'
    : list.complete ? `${count(list.count)} · ${doorTime(list.syncedAt)}`
    : list.pulling || downloading ? 'Downloading…' : 'Not yet';

  const tiles: { icon: IconName; label: string; onPress: () => void }[] = [];
  if (perms?.viewGuests) tiles.push({ icon: 'users', label: 'Find Guest', onPress: () => router.push('/attendees') });
  if (perms?.analytics) tiles.push({ icon: 'chart', label: 'Analytics', onPress: () => router.push('/analytics') });
  tiles.push({ icon: 'logs', label: 'Logs', onPress: () => router.push('/logs') });
  tiles.push({ icon: 'info', label: 'Details', onPress: () => router.push('/event') });

  const updated = status.dataUpdatedAt ? doorTime(new Date(status.dataUpdatedAt).toISOString()) : '';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xl }}
        refreshControl={(
          <RefreshControl
            refreshing={status.isRefetching}
            onRefresh={() => { status.refetch(); me.refetch(); recent.refetch(); }}
            tintColor={colors.accent}
          />
        )}
      >
        <View style={[styles.hero, { height: HERO + insets.top }]}>
          {event?.coverUrl ? (
            <Image source={{ uri: event.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessible={false} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.teal800 }]} />
          )}
          <Svg style={StyleSheet.absoluteFill} accessible={false}>
            <Defs>
              <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#061e20" stopOpacity="0.55" />
                <Stop offset="0.45" stopColor="#061e20" stopOpacity="0.15" />
                <Stop offset="1" stopColor="#061e20" stopOpacity="0.85" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#shade)" />
          </Svg>
          <View style={[styles.heroBar, { paddingTop: insets.top + space.xs }]}>
            <HeroButton icon="chevronLeft" label={pin ? 'Sign this device out' : 'Leave this event'} onPress={() => { void leave(); }} />
            <HeroButton icon="more" label="More" onPress={more} />
          </View>
          <View style={styles.heroText}>
            <View style={[styles.liveChip, offline && styles.liveChipOff]} accessibilityLabel={offline ? `Offline, updated ${updated}` : 'Live check-in'}>
              <View style={[styles.liveDot, { backgroundColor: offline ? colors.offline : '#4ade80' }]} />
              <Text variant="caption" weight="semibold" color={colors.white}>
                {offline ? `Offline${updated ? ` · updated ${updated}` : ''}` : 'Live Check-in'}
              </Text>
            </View>
            <Text style={styles.heroTitle} numberOfLines={2} accessibilityRole="header">{title}</Text>
            {event && (
              <View style={styles.heroMeta}>
                <Icon name="calendar" size={16} color={colors.white} />
                <Text variant="small" color={colors.white}>{eventDate(event.startsAt, event.timezone)}</Text>
                {(event.city || event.venue) && (
                  <>
                    <Icon name="pin" size={16} color={colors.white} />
                    <Text variant="small" color={colors.white} numberOfLines={1} style={{ flexShrink: 1 }}>{event.city || event.venue}</Text>
                  </>
                )}
              </View>
            )}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.statsCard}>
            <View style={styles.stats} accessible accessibilityLabel={`${total} total, ${admitted} checked in, ${remaining} remaining, ${share} percent`}>
              <Stat label="Total" value={total} />
              <View style={styles.statRule} />
              <Stat label="Checked In" value={admitted} accent />
              <View style={styles.statRule} />
              <Stat label="Remaining" value={remaining} />
            </View>
            <View style={styles.progress}>
              <ShareBar value={admitted} total={total} />
              <Text variant="caption" color={colors.muted}>{share}% of guests checked in</Text>
            </View>
          </View>

          {gate?.locked && !gate.override ? (
            <Notice icon="ban" tone="danger" text={lockedNote(gate.reason) ?? 'Scanning is switched off for this event.'} />
          ) : conflicts > 0 ? (
            <Notice icon="alert" tone="warning" text={`${conflicts} guest${conflicts === 1 ? '' : 's'} let in at two doors offline`} onPress={() => router.push('/settings/data-sync')} />
          ) : held > 0 ? (
            <Notice icon="cloudUpload" tone="info" text={`${held} check-in${held === 1 ? '' : 's'} waiting to sync`} onPress={() => router.push(offline ? '/offline' : '/sync')} />
          ) : offline ? (
            <Notice icon="offline" tone="warning" text="Offline — check-ins are saved on this phone" onPress={() => router.push('/offline')} />
          ) : null}

          <Button label="Start Check-in" icon="scan" size="lg" onPress={() => router.push('/scan')} />

          <View style={styles.tiles}>
            {tiles.map((t) => (
              <Pressable
                key={t.label}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                onPress={t.onPress}
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.tileIcon}><Icon name={t.icon} size={22} color={colors.accent} /></View>
                <Text variant="caption" weight="semibold" numberOfLines={1}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <Section title="Recent Check-ins" action={{ label: 'View All', onPress: () => router.push('/logs') }}>
            <Card style={styles.recent}>
              {recent.isLoading ? (
                <ActivityIndicator color={colors.accent} style={{ paddingVertical: space.lg }} />
              ) : (recent.data ?? []).length === 0 ? (
                <View style={styles.recentEmpty}>
                  <Icon name="scan" size={22} color={colors.subtle} />
                  <Text variant="small" color={colors.muted} style={{ flex: 1 }}>No check-ins yet. They appear here as guests arrive.</Text>
                </View>
              ) : (recent.data ?? []).slice(0, RECENT).map((r, i) => <RecentRow key={r.id} scan={r} last={i === Math.min(RECENT, recent.data!.length) - 1} />)}
            </Card>
          </Section>

          <Card style={styles.rows}>
            <ListRow icon="info" label="Event Details" onPress={() => router.push('/event')} />
            <ListRow icon="download" label="Download Guest List" value={listValue} onPress={download} hint="Keeps the event's tickets on this phone for check-in with no signal" />
            <ToggleRow
              icon="offline"
              label="Offline Mode"
              value={offlineMode && !list.off}
              disabled={list.off}
              onChange={setOffline}
              hint={list.off ? 'Switched off by the organizer' : 'Check tickets on this phone with no signal'}
              last
            />
          </Card>
        </View>
      </ScrollView>
      <TabBar active="events" mode="door" />
    </View>
  );
}

function RecentRow({ scan, last }: { scan: RecentScan; last: boolean }) {
  const o = describeScan(scan.result);
  const dot = o.tone === 'admit' ? colors.successStrong : o.tone === 'refuse' ? colors.dangerGlyph : o.tone === 'warn' ? colors.warningGlyph : colors.hold;
  const name = scan.holder || scan.tier || 'Guest';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${o.title}, ${doorTime(scan.at)}`}
      disabled={!scan.ticketId}
      onPress={() => scan.ticketId && router.push({ pathname: '/ticket/[ticketId]', params: { ticketId: scan.ticketId } })}
      style={({ pressed }) => [styles.recentRow, !last && styles.recentRule, pressed && { opacity: 0.6 }]}
    >
      <Avatar name={scan.holder} size={38} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" weight="semibold" numberOfLines={1}>{name}</Text>
        <Text variant="caption" color={colors.muted} numberOfLines={1}>
          {[ticketCode(scan.ticketId), scan.result === 'admitted' ? null : o.title].filter(Boolean).join(' • ')}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="caption" color={colors.muted}>{doorTime(scan.at)}</Text>
        <View style={[styles.recentDot, { backgroundColor: dot }]} />
      </View>
    </Pressable>
  );
}

function HeroButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.heroButton}>
      <Icon name={icon} size={24} color={colors.white} strokeWidth={2.2} />
    </Pressable>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text variant="small" color={accent ? colors.accent : colors.muted} weight={accent ? 'semibold' : 'regular'}>{label}</Text>
      <Text style={styles.statValue} color={accent ? colors.accent : colors.text}>{count(value)}</Text>
    </View>
  );
}

const NOTICE = {
  danger: { bg: colors.dangerHalo, fg: colors.danger },
  warning: { bg: colors.warningHalo, fg: colors.warning },
  info: { bg: colors.mint, fg: colors.accent },
} as const;

function Notice({ icon, tone, text, onPress }: { icon: IconName; tone: keyof typeof NOTICE; text: string; onPress?: () => void }) {
  const t = NOTICE[tone];
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.notice, { backgroundColor: t.bg }]}
    >
      <Icon name={icon} size={20} color={t.fg} />
      <Text variant="small" weight="semibold" color={t.fg} style={{ flex: 1 }}>{text}</Text>
      {onPress && <Icon name="chevronRight" size={18} color={t.fg} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { justifyContent: 'space-between', backgroundColor: colors.teal900 },
  heroBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md },
  heroButton: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(6, 30, 32, 0.35)',
  },
  heroText: { paddingHorizontal: space.xl, paddingBottom: 56, gap: space.sm },
  heroTitle: { fontFamily: 'DMSans_700Bold', fontSize: 27, lineHeight: 33, color: colors.white },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  liveChipOff: { backgroundColor: 'rgba(146, 64, 14, 0.85)' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  body: { paddingHorizontal: space.lg + 4, gap: space.lg, marginTop: -40 },
  statsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingTop: space.lg, paddingBottom: space.md, gap: space.md, ...shadow.raised,
  },
  stats: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontFamily: 'DMSans_700Bold', fontSize: 24, lineHeight: 30 },
  statRule: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border },
  progress: { paddingHorizontal: space.lg, gap: 6 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    minHeight: 48, borderRadius: radius.md,
  },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: space.md, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tileIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  recent: { paddingVertical: space.xs },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm + 2 },
  recentRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  recentDot: { width: 10, height: 10, borderRadius: 5 },
  recentEmpty: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rows: { paddingVertical: space.xs },
});
