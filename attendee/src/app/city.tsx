import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { messageFor } from '@/api/client';
import { cities, eventsNear } from '@/api/endpoints';
import { approximatePosition } from '@/lib/location';
import { useSession } from '@/auth/session';
import { Failed, Header } from '@/ui/bits';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { haptic, RowSkeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, space } from '@/ui/theme';

/**
 * The city picker behind Home's "Cairo ▾". Only cities that have something on
 * (/public/cities) — a list of every city in the world would mostly lead to
 * empty pages — with a search box for when that list is long.
 */
export default function CityPicker() {
  const current = useSession((s) => s.city);
  const list = useQuery({ queryKey: ['cities'], queryFn: cities, staleTime: 600_000 });
  const [text, setText] = useState('');

  const choose = (c: { city: string; country: string } | null) => {
    haptic.select();
    void useSession.getState().setCity(c);
    router.back();
  };

  // "Use my current location": the nearest city that has something on.
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  async function locateMe() {
    setLocNote(null);
    setLocating(true);
    try {
      const p = await approximatePosition();
      if (p === 'denied') { setLocNote('Location is off for Eventsli. Turn it on in Settings.'); return; }
      if (!p) { setLocNote('We could not find where you are just now. Try again.'); return; }
      const answer = await eventsNear(p.lat, p.lng);
      // Only a city actually near: on a phone in Cairo the "nearest" city with
      // events can be Toronto, 9,000 km off (seen on production, 2026-11-24).
      const place = answer.nearest ?? answer.places[0];
      if (!place || place.distanceKm > Math.max(answer.radiusKm, 150)) {
        setLocNote('No events near you yet. Choose a city below, or Everywhere.');
        return;
      }
      choose({ city: place.city, country: place.country });
    } catch {
      setLocNote('We could not find where you are just now. Try again.');
    } finally {
      setLocating(false);
    }
  }

  const needle = text.trim().toLowerCase();
  const matches = (list.data ?? []).filter((c) => !needle || c.city.toLowerCase().includes(needle) || c.country.toLowerCase().includes(needle));

  return (
    <View style={styles.root}>
      <Header title="Choose a city" backIcon="close" />
      <Container style={{ paddingVertical: space.md }}>
        <View style={styles.search}>
          <Icon name="search" size={20} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Search cities"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            accessibilityLabel="Search cities"
            autoCorrect={false}
            maxFontSizeMultiplier={1.4}
          />
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ busy: locating }} onPress={() => { void locateMe(); }} style={({ pressed }) => [styles.mine, pressed && { opacity: 0.7 }]}>
          <View style={[styles.icon, { backgroundColor: colors.accent }]}><Icon name="locate" size={20} color={colors.white} strokeWidth={2.2} /></View>
          <View style={{ flex: 1 }}>
            <Text variant="label" weight="bold" color={colors.accent}>{locating ? 'Finding you…' : 'Use my current location'}</Text>
            <Text variant="caption" color={colors.muted}>The nearest city with events</Text>
          </View>
        </Pressable>
        {locNote ? <Text variant="small" color={colors.warning}>{locNote}</Text> : null}
      </Container>
      {list.isLoading ? (
        <Container style={{ gap: space.sm }}>{[0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}</Container>
      ) : list.isError ? (
        <Failed message={messageFor(list.error)} onRetry={() => { void list.refetch(); }} />
      ) : (
        <FlatList
          data={needle ? matches : [null, ...matches]}
          keyExtractor={(c) => (c ? `${c.city}|${c.country}` : 'everywhere')}
          contentContainerStyle={{ paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const selected = item ? current?.city === item.city && current?.country === item.country : !current;
            return (
              <Container>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => choose(item ? { city: item.city, country: item.country } : null)}
                  style={({ pressed }) => [styles.row, selected && styles.rowOn, pressed && { backgroundColor: colors.bgSunken }]}
                >
                  <View style={[styles.icon, selected && { backgroundColor: colors.accent }]}>
                    <Icon name={item ? 'pin' : 'globe'} size={20} color={selected ? colors.white : colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="label" weight="semibold">{item ? item.city : 'Everywhere'}</Text>
                    <Text variant="caption" color={colors.muted}>
                      {item ? `${item.country} · ${item.events} event${item.events === 1 ? '' : 's'}` : 'Every city on Eventsli'}
                    </Text>
                  </View>
                  {selected ? <Icon name="check" size={20} color={colors.accent} strokeWidth={2.4} /> : null}
                </Pressable>
              </Container>
            );
          }}
          ListEmptyComponent={<Text variant="body" color={colors.muted} align="center" style={{ padding: space.xl }}>No city matches “{text.trim()}”.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50,
    paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.lg, marginBottom: space.xs },
  mine: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, marginTop: space.sm },
  rowOn: { backgroundColor: colors.coral50 },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center' },
});
