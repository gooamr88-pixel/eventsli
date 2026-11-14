import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { analytics } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { useGateStatus, useMe } from '@/gate/useDoor';
import { count, eventDate, eventPhase, eventTime, percent } from '@/lib/format';
import { roleLabel } from '@/screens/Settings';
import { Button } from '@/ui/Button';
import { Ring, ShareBar } from '@/ui/charts';
import { Icon } from '@/ui/Icon';
import { Card, FactRow, InfoRow, PhaseChip, Section } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/** The phone's maps app, searching for the venue. */
function mapsUrl(q: string): string {
  const query = encodeURIComponent(q);
  return Platform.OS === 'ios' ? `https://maps.apple.com/?q=${query}` : `geo:0,0?q=${query}`;
}

/**
 * Event Details, from the dashboard: the cover; when (in the event's own time
 * zone) and where, with the way to the maps app; how check-in is going, by
 * ticket type when this phone may see analytics; the organizer's door
 * settings; and this device.
 */
export default function EventDetails() {
  const insets = useSafeAreaInsets();
  const door = useSession((s) => s.door);
  const me = useMe();
  const status = useGateStatus();
  const event = me.data?.event;
  const perms = me.data?.permissions;
  const settings = me.data?.settings;
  const a = useQuery({
    queryKey: ['analytics', door?.token, 'details'],
    queryFn: () => analytics(door!.token),
    enabled: Boolean(door && perms?.analytics),
    refetchInterval: 30_000,
  });

  const stats = status.data?.stats ?? me.data?.stats ?? null;
  const admitted = stats?.admitted ?? 0;
  const expected = admitted + (stats?.pending ?? 0);
  const phase = event ? eventPhase(event.startsAt, event.endsAt) : null;
  const place = event ? [event.venue, event.address, event.city].filter(Boolean).join(', ') : '';

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
        <View style={[styles.cover, { height: 200 + insets.top }]}>
          {event?.coverUrl ? (
            <Image source={{ uri: event.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessible={false} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.coverEmpty]}>
              <Icon name="calendar" size={48} color={colors.teal300} />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={[styles.back, { top: insets.top + space.sm }]}
          >
            <Icon name="chevronLeft" size={24} color={colors.white} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={{ gap: space.sm }}>
            {event && <PhaseChip startsAt={event.startsAt} endsAt={event.endsAt} />}
            <Text variant="heading" accessibilityRole="header">{event?.title ?? door?.eventTitle ?? 'Event'}</Text>
          </View>

          {event && (
            <Card style={styles.card}>
              <FactRow icon="calendar" iconColor={colors.accent}>
                <Text variant="body" weight="semibold">{eventDate(event.startsAt, event.timezone)}</Text>
                <Text variant="small" color={colors.muted}>
                  {eventTime(event.startsAt, event.timezone)} – {eventTime(event.endsAt, event.timezone)}
                </Text>
                <Text variant="caption" color={colors.subtle}>
                  {event.timezone.replace(/_/g, ' ')}{phase && phase.phase !== 'ended' && phase.phase !== 'live' ? ` · ${phase.label.toLowerCase()}` : ''}
                </Text>
              </FactRow>
              {place ? (
                <FactRow icon="pin" iconColor={colors.accent}>
                  <Text variant="body" weight="semibold">{event.venue || event.city}</Text>
                  {[event.address, event.city].filter(Boolean).length > 0 && (
                    <Text variant="small" color={colors.muted}>{[event.address, event.city].filter(Boolean).join(', ')}</Text>
                  )}
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => Linking.openURL(mapsUrl(place)).catch(() => undefined)}
                    hitSlop={8}
                    style={styles.maps}
                  >
                    <Icon name="map" size={16} color={colors.accent} />
                    <Text variant="small" weight="semibold" color={colors.accent}>Open in Maps</Text>
                  </Pressable>
                </FactRow>
              ) : null}
            </Card>
          )}

          <Section title="Check-in progress">
            <Card style={styles.progress}>
              <Ring value={admitted} total={expected} size={132} stroke={14} label={`${percent(admitted, expected)}%`} sublabel="checked in" />
              <View style={styles.legend}>
                <Legend color={colors.accent} label="Checked in" value={admitted} />
                <Legend color={colors.teal100} label="Remaining" value={stats?.pending ?? 0} />
                <Legend color={colors.borderStrong} label="Total" value={expected} />
                {stats?.void ? <Legend color={colors.dangerHalo} label="Cancelled" value={stats.void} /> : null}
              </View>
            </Card>
          </Section>

          {a.data && a.data.byTier.length > 0 && (
            <Section title="By ticket type">
              <Card style={styles.tiers}>
                {a.data.byTier.map((t) => (
                  <View key={t.tier ?? 'none'} style={styles.tier}>
                    <View style={styles.tierHead}>
                      <Text variant="body" weight="medium" style={{ flex: 1 }}>{t.tier ?? 'Other'}</Text>
                      <Text variant="small" color={colors.muted}>{count(t.admitted)} / {count(t.issued)}</Text>
                    </View>
                    <ShareBar value={t.admitted} total={t.issued} />
                  </View>
                ))}
              </Card>
            </Section>
          )}

          {settings && (
            <Section title="Door settings">
              <Card style={styles.rows}>
                <InfoRow icon="offline" label="Offline check-in" value={settings.offlineAdmission ? 'On' : 'Off'} />
                <InfoRow icon="user" label="Names offline" value={settings.offlineShowNames ? 'Shown' : 'Hidden'} />
                <InfoRow icon="users" label="Door team sees guests" value={settings.doorTeamCanViewGuests ? 'Yes' : 'No'} last />
              </Card>
              <Text variant="caption" color={colors.subtle}>Set by the organizer on eventsli.com.</Text>
            </Section>
          )}

          {me.data && (
            <Section title="This device">
              <Card style={styles.rows}>
                <InfoRow icon="tablet" label="Name" value={me.data.device.label} />
                <InfoRow icon="shield" label="Signed in as" value={roleLabel(me.data.role, door?.kind)} last />
              </Card>
            </Section>
          )}

          {perms?.analytics && <Button label="Analytics" variant="secondary" icon="chart" onPress={() => router.push('/analytics')} />}
          {perms?.viewGuests && <Button label="Find a Guest" variant="secondary" icon="search" onPress={() => router.push('/attendees')} />}
        </View>
      </ScrollView>
    </View>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text variant="small" color={colors.muted} style={{ flex: 1 }}>{label}</Text>
      <Text variant="body" weight="semibold">{count(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  cover: { backgroundColor: colors.teal800 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.teal800 },
  back: {
    position: 'absolute', left: space.md, width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6, 30, 32, 0.45)',
  },
  body: {
    marginTop: -24, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4,
    backgroundColor: colors.bg, paddingHorizontal: space.lg + 4, paddingTop: space.xl, gap: space.lg,
  },
  card: { paddingVertical: space.sm, gap: space.xs },
  maps: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xs },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  legend: { flex: 1, gap: space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  tiers: { gap: space.xs, paddingVertical: space.sm },
  tier: { gap: 6, paddingVertical: space.sm },
  tierHead: { flexDirection: 'row', alignItems: 'center' },
  rows: { paddingVertical: space.xs },
});
