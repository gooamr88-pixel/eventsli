import { router } from 'expo-router';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { eventBySlug } from '../api/endpoints';
import type { EventCard as Event } from '../api/types';
import { useSession } from '../auth/session';
import { eventDate, eventDay, eventTime, price } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { Badge, Heart, HeartIcon, type Tone } from './bits';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Pressy } from './motion';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/**
 * Opens an event FAST: the card's own data is left for the event page to
 * draw at once (cover, title, date, place), and the full event starts loading
 * now, during the slide-in, rather than after it.
 */
export const openEvent = (e: Event) => {
  queryClient.setQueryData(['event-card', e.slug], e);
  const token = useSession.getState().account?.token ?? null;
  void queryClient.prefetchQuery({ queryKey: ['event', e.slug], queryFn: () => eventBySlug(e.slug, token) });
  router.push({ pathname: '/event/[slug]', params: { slug: e.slug } });
};

/** The one fact worth a tag, in the order they matter. */
export function tagFor(e: Event): { label: string; tone: Tone } | null {
  if (e.isPrivate) return { label: 'Private', tone: 'dark' };
  if (e.isPast) return { label: 'Past event', tone: 'dark' };
  if (e.comingSoon) return { label: 'Coming soon', tone: 'highlight' };
  if (e.availability?.soldOut) return { label: 'Sold out', tone: 'dark' };
  if (e.availability?.sellingFast) return { label: 'Selling fast', tone: 'accent' };
  return null;
}

/** "From EGP 800", "Free", "Listing" — or nothing when there is no price to say. */
export function priceLine(e: Event): string {
  if (e.displayOnly) return 'Listing';
  if (e.fromPriceCents === null || e.fromPriceCents === undefined || !e.currency) return '';
  return e.fromPriceCents === 0 ? 'Free' : `From ${price(e.fromPriceCents, e.currency)}`;
}

/**
 * The mockup's Trending banner: the photo, a coral "Trending" pill, the name
 * in white bold, "Nov 20, 2026 • Cairo International Stadium", and the white
 * round arrow. Nothing else on it.
 */
export function EventTile({ event, height = 200, badge, style }: {
  event: Event; height?: number; badge?: string; style?: ViewStyle;
  /** Kept for callers; the banner itself carries no heart, as on the mockup. */
  saved?: boolean; onHeart?: () => void;
}) {
  const where = event.venue || event.city;
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${badge ? `${badge}: ` : ''}${event.title}, ${eventDate(event.startsAt, event.timezone)}${where ? `, ${where}` : ''}`}
      onPress={() => openEvent(event)}
      style={[styles.tile, style]}
      scale={0.98}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} scrim style={{ height }}>
        <View style={styles.tileBottom}>
          <View style={{ flex: 1, gap: 6 }}>
            {badge ? <Badge label={badge} tone="accent" /> : null}
            <Text variant="heading" color={colors.white} numberOfLines={2}>{event.title}</Text>
            <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1}>
              {eventDate(event.startsAt, event.timezone)}{where ? ` • ${where}` : ''}
            </Text>
          </View>
          <View style={styles.go}><Icon name="arrow" size={18} color={colors.night} strokeWidth={2.4} /></View>
        </View>
      </Cover>
    </Pressy>
  );
}

/** A photo card for grids (tablets) and the Home carousel: picture, name, date. */
export function EventPoster({ event, saved, onHeart, width, style, distance }: {
  event: Event; saved: boolean; onHeart: () => void; width?: number; style?: ViewStyle;
  /** "2.3 km away" — on Home's Near You row. */
  distance?: string;
}) {
  const tag = tagFor(event);
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDay(event.startsAt, event.timezone)}`}
      onPress={() => openEvent(event)}
      style={[width ? { width } : null, style]}
      scale={0.97}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} style={styles.posterCover} size={width ?? 280}>
        <View style={styles.posterTop}>
          {tag ? <Badge label={tag.label} tone={tag.tone} /> : null}
          <View style={{ flex: 1 }} />
          {!event.isPrivate ? <Heart saved={saved} onPress={onHeart} onDark size={34} /> : null}
        </View>
      </Cover>
      <View style={styles.posterBody}>
        <Text variant="label" weight="bold" numberOfLines={1}>{event.title}</Text>
        <Text variant="small" color={colors.muted} numberOfLines={1}>
          {eventDate(event.startsAt, event.timezone)}{!distance && (event.venue || event.city) ? ` • ${event.venue || event.city}` : ''}
        </Text>
        {distance ? (
          <View style={styles.away}>
            <Icon name="pin" size={13} color={colors.accent} strokeWidth={2.2} />
            <Text variant="caption" weight="bold" color={colors.accent}>{distance}</Text>
          </View>
        ) : null}
      </View>
    </Pressy>
  );
}

/**
 * The mockup's list row (Saved Events): a rounded square photo, the name in
 * bold, the date under it, and the heart on the right. No box around it.
 */
export function EventRow({ event, saved, onHeart, distance }: { event: Event; saved: boolean; onHeart: () => void; distance?: string }) {
  const tag = tagFor(event);
  const where = [distance, event.venue || event.city].filter(Boolean).join(' · ');
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDate(event.startsAt, event.timezone)}${where ? `, ${where}` : ''}`}
      onPress={() => openEvent(event)}
      style={styles.row}
      scale={0.98}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} style={styles.thumb} />
      <View style={styles.rowBody}>
        <Text variant="label" weight="bold" numberOfLines={1}>{event.title}</Text>
        <Text variant="small" color={colors.text} numberOfLines={1}>
          {eventDate(event.startsAt, event.timezone)} • {eventTime(event.startsAt, event.timezone)}
        </Text>
        {tag ? <Text variant="caption" weight="bold" color={tag.tone === 'accent' ? colors.accent : colors.muted}>{tag.label}</Text>
          : where ? <Text variant="caption" color={colors.muted} numberOfLines={1}>{where}</Text> : null}
      </View>
      {!event.isPrivate ? (
        <Pressy accessibilityRole="button" accessibilityLabel={saved ? 'Remove from saved' : 'Save event'} accessibilityState={{ selected: saved }}
          onPress={onHeart} hitSlop={12} scale={0.8} style={styles.save}>
          <HeartIcon saved={saved} size={22} />
        </Pressy>
      ) : null}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.night },
  tileBottom: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  go: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },

  posterCover: { height: 150, borderRadius: 14 },
  posterTop: { flexDirection: 'row', alignItems: 'flex-start', padding: space.sm },
  posterBody: { paddingTop: space.sm, gap: 2 },
  away: { flexDirection: 'row', alignItems: 'center', gap: 3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.sm },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  rowBody: { flex: 1, gap: 3 },
  save: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
