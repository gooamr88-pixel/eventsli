import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { isAuthError, messageFor } from '@/api/client';
import { assignments, openDoor } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession } from '@/auth/session';
import { count, eventDate, eventPhase, eventTime, percent } from '@/lib/format';
import { Button } from '@/ui/Button';
import { ShareBar } from '@/ui/charts';
import { dialog, Sheet } from '@/ui/Dialog';
import { Icon } from '@/ui/Icon';
import { Avatar, Empty, FactRow, PhaseChip, Screen, ScreenTitle } from '@/ui/layout';
import { Segmented } from '@/ui/Segmented';
import { TabBar } from '@/ui/TabBar';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

type Scope = 'assigned' | 'all';

/** After a sheet closes, iOS needs a moment before it can present the next pop-up. */
const AFTER_SHEET_MS = 350;

/**
 * My Events, as the mockup draws it. "Assigned to me" is the doors this
 * person can work now or soon (ongoing, then upcoming); "All Events" adds the
 * last 30 days, read-only. Tapping an event shows its preview — when, where,
 * how check-in is going — with the way in.
 */
export default function Events() {
  const account = useSession((s) => s.account);
  const setDoor = useSession((s) => s.setDoor);
  const signOut = useSession((s) => s.signOut);
  const [scope, setScope] = useState<Scope>('assigned');
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [preview, setPreview] = useState<EventCard | null>(null);

  const query = useQuery({
    queryKey: ['assignments', account?.user.id],
    queryFn: () => assignments(account!.token),
    enabled: Boolean(account),
  });

  // The account session ended on the server (expired, signed out from the
  // web): back to sign-in rather than an error that cannot be fixed here.
  useEffect(() => {
    if (query.error && isAuthError(query.error)) signOut();
  }, [query.error, signOut]);

  const groups = query.data ?? { upcoming: [], ongoing: [], past: [] };
  const assignedCount = groups.ongoing.length + groups.upcoming.length;
  const allCount = assignedCount + groups.past.length;

  const list = useMemo(() => {
    const g = query.data ?? { upcoming: [], ongoing: [], past: [] };
    const rows = scope === 'assigned' ? [...g.ongoing, ...g.upcoming] : [...g.ongoing, ...g.upcoming, ...g.past];
    const q = search.trim().toLowerCase();
    return q ? rows.filter((e) => `${e.title} ${e.city ?? ''} ${e.venue ?? ''}`.toLowerCase().includes(q)) : rows;
  }, [query.data, scope, search]);

  async function open(event: EventCard) {
    if (!account || opening) return;
    setOpening(event.id);
    try {
      const door = await openDoor(account.token, event.id);
      // The session moves the phone to the dashboard (see src/app/_layout.tsx).
      await setDoor({ ...door, event: { id: event.id, title: event.title } }, 'staff');
    } catch (err) {
      if (isAuthError(err)) {
        await signOut();
        return;
      }
      setPreview(null);
      setTimeout(() => dialog.alert('Could not open this event', messageFor(err), { tone: 'danger', icon: 'calendar' }), AFTER_SHEET_MS);
    } finally {
      setOpening(null);
    }
  }

  const firstName = (account?.user.fullName || '').trim().split(/\s+/)[0];

  return (
    <Screen bar={<TabBar active="events" mode="account" />}>
      <ScreenTitle
        right={(
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.navigate('/account')} hitSlop={8}>
            <Avatar name={account?.user.fullName || null} size={40} />
          </Pressable>
        )}
      >
        My Events
      </ScreenTitle>
      {firstName ? <Text variant="small" color={colors.muted} style={styles.hello}>Hi {firstName}, pick an event to start checking guests in.</Text> : null}
      <Segmented
        options={[
          { value: 'assigned' as const, label: query.data ? `Assigned to me (${assignedCount})` : 'Assigned to me' },
          { value: 'all' as const, label: query.data ? `All Events (${allCount})` : 'All Events' },
        ]}
        value={scope}
        onChange={setScope}
      />
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search events..."
          placeholderTextColor={colors.placeholder}
          style={styles.searchInput}
          accessibilityLabel="Search events"
          returnKeyType="search"
        />
        {search ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => setSearch('')} hitSlop={10}>
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={list}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingBottom: space.lg }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { query.refetch(); }} tintColor={colors.accent} />}
        ListEmptyComponent={query.isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} /> : (
          <Empty
            icon="calendar"
            title={query.error ? 'Could not load your events' : search ? 'No events match' : 'No events yet'}
            body={query.error
              ? messageFor(query.error)
              : search ? `Nothing matches “${search.trim()}”. Try another word, or All Events.`
              : 'Events you organize, and events you are on the door team for, appear here.'}
            action={query.error ? <Button label="Try again" variant="secondary" onPress={() => query.refetch()} /> : undefined}
          />
        )}
        renderItem={({ item, index }) => (
          <EventRow event={item} first={index === 0} onPress={() => setPreview(item)} />
        )}
      />

      <Sheet visible={Boolean(preview)} onClose={() => (opening ? undefined : setPreview(null))}>
        {preview && <EventPreview event={preview} busy={opening === preview.id} onOpen={() => open(preview)} onClose={() => setPreview(null)} />}
      </Sheet>
    </Screen>
  );
}

function EventRow({ event, first, onPress }: { event: EventCard; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Shows the event"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowRule, pressed && { opacity: 0.6 }]}
    >
      <Cover event={event} style={styles.thumb} />
      <View style={styles.info}>
        <Text variant="label" numberOfLines={1}>{event.title}</Text>
        <View style={styles.meta}>
          <Icon name="calendar" size={15} color={colors.muted} />
          <Text variant="small" color={colors.muted} numberOfLines={1}>{eventDate(event.startsAt, event.timezone)}</Text>
        </View>
        {(event.city || event.venue) && (
          <View style={styles.meta}>
            <Icon name="pin" size={15} color={colors.muted} />
            <Text variant="small" color={colors.muted} numberOfLines={1}>{[event.city, event.venue].filter(Boolean)[0]}</Text>
          </View>
        )}
        <PhaseChip startsAt={event.startsAt} endsAt={event.endsAt} />
      </View>
      <Icon name="chevronRight" size={20} color={colors.muted} />
    </Pressable>
  );
}

function Cover({ event, style }: { event: EventCard; style: object }) {
  return event.coverUrl ? (
    <Image source={{ uri: event.coverUrl }} style={style} contentFit="cover" transition={150} accessible={false} />
  ) : (
    <View style={[style, styles.thumbEmpty]}>
      <Text variant="title" color={colors.white}>{event.title.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** The sheet over My Events: the event at a glance, and the way in that fits its moment. */
function EventPreview({ event, busy, onOpen, onClose }: { event: EventCard; busy: boolean; onOpen: () => void; onClose: () => void }) {
  const { phase } = eventPhase(event.startsAt, event.endsAt);
  const share = percent(event.stats.admitted, event.stats.issued);
  const finished = !event.scannable || phase === 'ended';
  const early = !finished && phase === 'upcoming';

  return (
    <View style={styles.preview}>
      <Cover event={event} style={styles.previewCover} />
      <PhaseChip startsAt={event.startsAt} endsAt={event.endsAt} />
      <Text variant="heading" accessibilityRole="header">{event.title}</Text>

      <View>
        <FactRow icon="calendar">
          <Text variant="body" weight="medium">{eventDate(event.startsAt, event.timezone)}</Text>
          <Text variant="small" color={colors.muted}>{eventTime(event.startsAt, event.timezone)} – {eventTime(event.endsAt, event.timezone)}</Text>
        </FactRow>
        {(event.venue || event.city) && (
          <FactRow icon="pin">
            <Text variant="body" weight="medium">{event.venue || event.city}</Text>
            {event.venue && event.city ? <Text variant="small" color={colors.muted}>{event.city}</Text> : null}
          </FactRow>
        )}
        <FactRow icon={event.as === 'organizer' ? 'crown' : 'users'}>
          <Text variant="body" weight="medium">{event.as === 'organizer' ? 'You organize this event' : 'You are on the door team'}</Text>
        </FactRow>
      </View>

      <View style={styles.progress} accessible accessibilityLabel={`${event.stats.admitted} of ${event.stats.issued} checked in, ${share} percent`}>
        <View style={styles.progressHead}>
          <Text variant="small" weight="semibold">Checked in</Text>
          <Text variant="small" color={colors.muted}>{count(event.stats.admitted)} of {count(event.stats.issued)} · {share}%</Text>
        </View>
        <ShareBar value={event.stats.admitted} total={event.stats.issued} />
      </View>

      {finished ? (
        <>
          <Note icon="clock" text="This event has finished. It can no longer be scanned." />
          <Button label="Close" variant="secondary" onPress={onClose} />
        </>
      ) : early ? (
        <>
          <Note icon="alert" warn text="Doors are not open yet. Anyone you check in now is admitted for real." />
          <Button label="Open Anyway" variant="secondary" icon="scan" busy={busy} onPress={onOpen} />
        </>
      ) : (
        <Button label="Start Check-in" icon="scan" busy={busy} onPress={onOpen} />
      )}
    </View>
  );
}

function Note({ icon, text, warn = false }: { icon: 'clock' | 'alert'; text: string; warn?: boolean }) {
  return (
    <View style={[styles.note, { backgroundColor: warn ? colors.warningHalo : colors.bgSunken }]}>
      <Icon name={icon} size={18} color={warn ? colors.warning : colors.muted} />
      <Text variant="small" color={warn ? colors.warning : colors.muted} style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hello: { marginTop: -space.sm },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    minHeight: 46, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  thumb: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.mint },
  thumbEmpty: { backgroundColor: colors.teal500, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { gap: space.md },
  previewCover: { width: '100%', height: 150, borderRadius: radius.lg, backgroundColor: colors.mint },
  progress: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between' },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
});
