import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { eventBySlug } from '@/api/endpoints';
import type { EventDetail } from '@/api/types';
import { useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { eventSpanText, price } from '@/lib/format';
import { Empty, Failed, Heart, IconButton, Loading } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * The event (the mockup's fifth frame): the cover, the title and the heart,
 * when and where, About, the ticket types, and Select Tickets.
 *
 * Select Tickets goes to the seat map for a reserved event and to the quantity
 * picker for general admission (`admissionType`, which the API sends for
 * exactly this branch). Whatever cannot be bought here says why instead of
 * showing a dead button: a listing sold elsewhere, a teaser not yet on sale, a
 * private event behind its password, an event that is over.
 */
export default function EventScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const { isSaved, flip } = useSaved();
  const [more, setMore] = useState(false);

  const q = useQuery({ queryKey: ['event', slug], queryFn: () => eventBySlug(slug, token), enabled: Boolean(slug) });

  if (q.isLoading) return <View style={styles.root}><Loading /></View>;
  if (q.isError || !q.data) {
    const code = q.error instanceof ApiError ? q.error.code : null;
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.floatingBack}><IconButton icon="back" label="Back" onPress={() => router.back()} /></View>
        {code === 'EVENT_NOT_FOUND' ? (
          <Empty icon="calendar" title="This event is not available" body="It may have ended, or been taken down by its organizer." />
        ) : code === 'EVENT_PRIVATE' ? (
          // The password page is the website's (eventAccess), so the invitation
          // opens there; the app shows the event once it is unlocked.
          <Empty
            icon="lock"
            title="A private event"
            body="Its organizer has it behind a password. Open the invitation to unlock it."
            action="Open invitation"
            onAction={() => { void WebBrowser.openBrowserAsync(`${SITE}/e/${slug}`); }}
          />
        ) : (
          <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
        )}
      </View>
    );
  }

  const e = q.data;
  const where = [e.venue, e.venueAddressFull || e.venueAddress || e.city].filter(Boolean);
  const span = eventSpanText(e.startsAt, e.endsAt, e.timezone);
  const blocker = whyNot(e);

  const openMaps = () => {
    const label = encodeURIComponent([e.venue, e.city].filter(Boolean).join(', '));
    const url = e.venueLocation
      ? Platform.select({
        ios: `maps:0,0?q=${label}&ll=${e.venueLocation.lat},${e.venueLocation.lng}`,
        default: `geo:${e.venueLocation.lat},${e.venueLocation.lng}?q=${e.venueLocation.lat},${e.venueLocation.lng}(${label})`,
      })
      : `https://maps.google.com/?q=${encodeURIComponent(where.join(', '))}`;
    void Linking.openURL(url as string);
  };

  const next = () => {
    if (e.admissionType === 'general') router.push({ pathname: '/event/[slug]/tickets', params: { slug: e.slug } });
    else router.push({ pathname: '/event/[slug]/seats', params: { slug: e.slug } });
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <Cover uri={e.coverUrl} title={e.title} blurred={e.blurredCover} style={styles.hero}>
          <View style={[styles.heroBar, { top: insets.top + space.sm }]}>
            <View style={styles.round}><IconButton icon="back" label="Back" color={colors.white} onPress={() => router.back()} /></View>
            <View style={styles.round}>
              <IconButton icon="share" label="Share event" color={colors.white} onPress={() => { void Share.share({ message: `${e.title} — ${SITE}/e/${e.slug}`, url: `${SITE}/e/${e.slug}` }); }} />
            </View>
          </View>
        </Cover>

        <View style={styles.sheet}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1, gap: 4 }}>
              {e.categoryLabel ? <Text variant="caption" weight="bold" color={colors.accent}>{e.categoryLabel.toUpperCase()}</Text> : null}
              <Text variant="heading" accessibilityRole="header">{e.title}</Text>
              {e.organizer ? <Text variant="small" color={colors.muted}>by {e.organizer.name}</Text> : null}
            </View>
            {!e.isPrivate ? <Heart saved={isSaved(e.id)} onPress={() => flip(e.id)} /> : null}
          </View>

          <Fact icon="calendar" title={span.date} body={span.time} />
          {where.length ? (
            <Pressable accessibilityRole="button" accessibilityHint="Opens the venue in Maps" onPress={openMaps}>
              <Fact icon="pin" title={where[0] as string} body={where.slice(1).join(', ') || undefined} action="Map" />
            </Pressable>
          ) : null}

          {e.description ? (
            <View style={{ gap: space.sm }}>
              <Text variant="title" accessibilityRole="header">About the Event</Text>
              <Text variant="body" color={colors.muted} numberOfLines={more ? undefined : 4}>{e.description}</Text>
              <Pressable accessibilityRole="button" onPress={() => setMore((v) => !v)} hitSlop={8}>
                <Text variant="small" weight="semibold" color={colors.accent}>{more ? 'Show less' : 'Read more'}</Text>
              </Pressable>
            </View>
          ) : null}

          {e.highlights?.length ? (
            <View style={styles.highlights}>
              {e.highlights.map((h) => (
                <View key={h} style={styles.highlight}><Text variant="caption" weight="semibold">{h}</Text></View>
              ))}
            </View>
          ) : null}

          {e.tiers?.length ? (
            <View style={{ gap: space.sm }}>
              <Text variant="title" accessibilityRole="header">Tickets</Text>
              {e.tiers.map((t) => (
                <View key={t.id} style={styles.tier}>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{t.name}</Text>
                    {t.description ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{t.description}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="label" weight="bold">{price(t.priceCents, e.currency)}</Text>
                    {t.soldOut ? <Text variant="caption" color={colors.danger}>Sold out</Text>
                      : t.notYetOnSale ? <Text variant="caption" color={colors.muted}>Not on sale yet</Text>
                        : t.salesEnded ? <Text variant="caption" color={colors.muted}>Sales ended</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        {blocker ? (
          <Text variant="small" color={colors.muted} align="center">{blocker}</Text>
        ) : (
          <Button label="Select Tickets" onPress={next} iconRight="arrow" />
        )}
      </View>
    </View>
  );
}

/** Why there is no Select Tickets, in a sentence — or null when there is one. */
function whyNot(e: EventDetail): string | null {
  if (e.isPast) return 'This event has ended.';
  if (e.comingSoon) return 'Tickets go on sale soon. Save it to hear when.';
  if (e.displayOnly) return 'Tickets for this event are sold elsewhere.';
  if (e.availability?.soldOut) return 'Sold out.';
  if (!e.purchasable) return 'Tickets are not sold in the app for this event.';
  return null;
}

function Fact({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}><Icon name={icon} size={20} color={colors.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="label">{title}</Text>
        {body ? <Text variant="small" color={colors.muted}>{body}</Text> : null}
      </View>
      {action ? <Text variant="small" weight="semibold" color={colors.accent}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  floatingBack: { padding: space.md },
  hero: { height: 300 },
  heroBar: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between' },
  round: { borderRadius: 20, backgroundColor: 'rgba(17,16,24,0.45)' },
  sheet: { marginTop: -24, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.surface, padding: space.xl, gap: space.xl },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  factIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center' },
  highlights: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  highlight: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.sun100 },
  tier: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
