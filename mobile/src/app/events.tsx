import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { isAuthError, messageFor } from '@/api/client';
import { assignments, openDoor } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession } from '@/auth/session';
import { eventDate, eventWhen, hoursUntil } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Empty, Header, IconButton, Screen } from '@/ui/layout';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

type Tab = 'upcoming' | 'ongoing' | 'past';

/**
 * Select Event — the mockup's second screen. The events this person may work:
 * their own (as the organizer) and the ones they are on the door team for.
 * Ongoing first when anything is ongoing, because that is the door that is open.
 */
export default function Events() {
  const account = useSession((s) => s.account);
  const setDoor = useSession((s) => s.setDoor);
  const signOut = useSession((s) => s.signOut);
  const [tab, setTab] = useState<Tab | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

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

  const groups = useMemo(() => query.data ?? { upcoming: [], ongoing: [], past: [] }, [query.data]);
  const active: Tab = tab ?? (groups.ongoing.length ? 'ongoing' : groups.upcoming.length ? 'upcoming' : 'ongoing');
  const list = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const rows = groups[active];
    return q ? rows.filter((e) => `${e.title} ${e.city ?? ''} ${e.venue ?? ''}`.toLowerCase().includes(q)) : rows;
  }, [groups, active, search]);
  const chosen = list.find((e) => e.id === selected) ?? null;

  async function open(event: EventCard) {
    if (!account) return;
    setOpening(true);
    try {
      const door = await openDoor(account.token, event.id);
      await setDoor({ ...door, event: { id: event.id, title: event.title } }, 'staff');
      router.replace('/dashboard');
    } catch (err) {
      if (isAuthError(err)) {
        await signOut();
        return;
      }
      Alert.alert('Could not open this door', messageFor(err));
    } finally {
      setOpening(false);
    }
  }

  function proceed() {
    if (!chosen) return;
    const hours = hoursUntil(chosen.startsAt);
    if (hours > 6) {
      Alert.alert(
        'Doors are not open yet',
        `${chosen.title} starts ${eventWhen(chosen.startsAt, chosen.timezone)}. Anyone you scan now is admitted for real.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Open anyway', onPress: () => open(chosen) }],
      );
      return;
    }
    open(chosen);
  }

  const tabs = [
    { value: 'upcoming' as const, label: `Upcoming (${groups.upcoming.length})` },
    { value: 'ongoing' as const, label: `Ongoing (${groups.ongoing.length})` },
    { value: 'past' as const, label: `Past (${groups.past.length})` },
  ];

  return (
    <Screen
      footer={(
        <Button
          label={chosen && !chosen.scannable ? 'Finished — view only' : 'Continue'}
          iconRight={chosen?.scannable ? 'arrow' : undefined}
          disabled={!chosen || !chosen.scannable}
          busy={opening}
          onPress={proceed}
        />
      )}
    >
      <Header
        title="Select Event"
        onBack={null}
        right={<IconButton icon={search === null ? 'search' : 'close'} label="Search events" onPress={() => setSearch(search === null ? '' : null)} />}
      />
      {search !== null && (
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            autoFocus
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or city"
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
            accessibilityLabel="Search events"
          />
        </View>
      )}
      <Segmented options={tabs} value={active} onChange={(v) => { setTab(v); setSelected(null); }} />

      <FlatList
        data={list}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ gap: space.md, paddingBottom: space.lg }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { query.refetch(); }} tintColor={colors.accent} />}
        ListEmptyComponent={query.isLoading ? undefined : (
          <Empty
            icon="calendar"
            title={query.error ? 'Could not load your events' : `No ${active} events`}
            body={query.error
              ? messageFor(query.error)
              : 'Events you organize, and events you are on the door team for, appear here.'}
            action={query.error ? <Button label="Try again" variant="secondary" onPress={() => query.refetch()} /> : undefined}
          />
        )}
        renderItem={({ item }) => (
          <EventRow event={item} selected={item.id === selected} onPress={() => setSelected(item.id)} />
        )}
      />
      <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" style={styles.account}>
        <Icon name="user" size={16} color={colors.muted} />
        <Text variant="small" color={colors.muted} numberOfLines={1}>{account?.user.email}</Text>
      </Pressable>
    </Screen>
  );
}

function EventRow({ event, selected, onPress }: { event: EventCard; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${event.title}, ${eventDate(event.startsAt, event.timezone)}${event.city ? `, ${event.city}` : ''}`}
      style={[styles.row, selected && styles.rowOn]}
    >
      {event.coverUrl ? (
        <Image source={{ uri: event.coverUrl }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, styles.coverEmpty]}><Icon name="ticket" size={26} color={colors.accent} /></View>
      )}
      <View style={styles.rowText}>
        <Text variant="label" numberOfLines={2}>{event.title}</Text>
        <View style={styles.meta}>
          <Icon name="calendar" size={15} color={colors.muted} />
          <Text variant="small" color={colors.muted}>{eventDate(event.startsAt, event.timezone)}</Text>
        </View>
        {(event.city || event.venue) && (
          <View style={styles.meta}>
            <Icon name="pin" size={15} color={colors.muted} />
            <Text variant="small" color={colors.muted} numberOfLines={1}>{event.city || event.venue}</Text>
          </View>
        )}
        {!event.scannable && (
          <Text variant="caption" color={colors.subtle}>
            {event.stats.admitted.toLocaleString()} of {event.stats.issued.toLocaleString()} checked in
          </Text>
        )}
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md,
    minHeight: 46, borderRadius: radius.md, backgroundColor: colors.bgSunken,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rowOn: { borderColor: colors.teal300, backgroundColor: colors.teal50 },
  cover: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.teal100 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  radio: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  account: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: space.xs },
});
