import { router } from 'expo-router';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import type { EventCard as Event } from '../api/types';
import { dateBlock, eventDay, eventTime, price } from '../lib/format';
import { Badge, Heart, type Tone } from './bits';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Pressy } from './motion';
import { Text } from './Text';
import { colors, radius, shadow, space } from './theme';

export const openEvent = (e: Pick<Event, 'slug'>) => router.push({ pathname: '/event/[slug]', params: { slug: e.slug } });

/** The tag in the corner: the facts a buyer acts on, in the order they matter. */
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

const placeOf = (e: Event) => [e.venue, e.city].filter(Boolean).join(' · ');

/**
 * The banner: Home's "Trending" and the top of a city. Words sit on the
 * cover's dark scrim, as the mockup sets them, with the round arrow in the
 * corner that says "open".
 */
export function EventTile({ event, saved, onHeart, height = 210, badge, style }: {
  event: Event; saved: boolean; onHeart: () => void; height?: number;
  /** "Trending" on Home's banner; shown beside the event's own tag, not over it. */
  badge?: string;
  style?: ViewStyle;
}) {
  const where = placeOf(event);
  const tag = tagFor(event);
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDay(event.startsAt, event.timezone)}${where ? `, ${where}` : ''}`}
      onPress={() => openEvent(event)}
      style={[styles.tile, shadow.raised, style]}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} scrim style={{ height }}>
        <View style={styles.tileTop}>
          {badge ? <Badge label={badge} tone="accent" icon="trend" /> : null}
          {tag ? <Badge label={tag.label} tone={tag.tone} /> : null}
          <View style={{ flex: 1 }} />
          {!event.isPrivate ? <Heart saved={saved} onPress={onHeart} onDark /> : null}
        </View>
        <View style={styles.tileBottom}>
          <View style={{ flex: 1, gap: 4 }}>
            {event.categoryLabel ? <Text variant="overline" color={colors.sun200}>{event.categoryLabel.toUpperCase()}</Text> : null}
            <Text variant="heading" color={colors.white} numberOfLines={2}>{event.title}</Text>
            <Text variant="caption" color={colors.onDarkMuted} numberOfLines={1}>
              {eventDay(event.startsAt, event.timezone)} • {eventTime(event.startsAt, event.timezone)}{where ? ` • ${where}` : ''}
            </Text>
          </View>
          <View style={styles.go}><Icon name="arrow" size={18} color={colors.night} strokeWidth={2.2} /></View>
        </View>
      </Cover>
    </Pressy>
  );
}

/**
 * The poster card: carousels on Home, the result grid in Explore and on a
 * tablet. The cover on top with the date stamped on it, then the title,
 * where, and the price — the four things a person scanning a grid decides on.
 */
export function EventPoster({ event, saved, onHeart, width, style }: {
  event: Event; saved: boolean; onHeart: () => void; width?: number; style?: ViewStyle;
}) {
  const { month, day } = dateBlock(event.startsAt, event.timezone);
  const tag = tagFor(event);
  const cost = priceLine(event);
  const where = placeOf(event);
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDay(event.startsAt, event.timezone)}${where ? `, ${where}` : ''}${cost ? `, ${cost}` : ''}`}
      onPress={() => openEvent(event)}
      style={[styles.poster, shadow.card, width ? { width } : null, style]}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} style={styles.posterCover}>
        <View style={styles.posterTop}>
          <View style={styles.stamp}>
            <Text variant="caption" weight="bold" color={colors.accent} style={styles.stampMonth}>{month}</Text>
            <Text variant="title" style={styles.stampDay}>{day}</Text>
          </View>
          <View style={{ flex: 1 }} />
          {!event.isPrivate ? <Heart saved={saved} onPress={onHeart} onDark size={34} /> : null}
        </View>
        {tag ? <View style={styles.posterTag}><Badge label={tag.label} tone={tag.tone} /></View> : null}
      </Cover>
      <View style={styles.posterBody}>
        {event.categoryLabel ? <Text variant="overline" color={colors.accent} numberOfLines={1}>{event.categoryLabel.toUpperCase()}</Text> : null}
        <Text variant="label" weight="bold" numberOfLines={2} style={styles.posterTitle}>{event.title}</Text>
        {where ? (
          <View style={styles.meta}>
            <Icon name="pin" size={13} color={colors.muted} />
            <Text variant="caption" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>{where}</Text>
          </View>
        ) : null}
        <View style={styles.posterFoot}>
          <Text variant="caption" color={colors.muted}>{eventTime(event.startsAt, event.timezone)}</Text>
          {cost ? <Text variant="small" weight="bold" color={colors.text}>{cost}</Text> : null}
        </View>
      </View>
    </Pressy>
  );
}

/** The list row: Saved Events, Upcoming on Home, search results on a phone. */
export function EventRow({ event, saved, onHeart, distance }: { event: Event; saved: boolean; onHeart: () => void; distance?: string }) {
  const cost = priceLine(event);
  const tag = tagFor(event);
  return (
    <Pressy
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDay(event.startsAt, event.timezone)}${cost ? `, ${cost}` : ''}`}
      onPress={() => openEvent(event)}
      style={[styles.row, shadow.card]}
      scale={0.98}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} style={styles.thumb} />
      <View style={styles.rowBody}>
        {tag ? <Badge label={tag.label} tone={tag.tone} /> : null}
        <Text variant="label" weight="bold" numberOfLines={2}>{event.title}</Text>
        <View style={styles.meta}>
          <Icon name="calendar" size={13} color={colors.muted} />
          <Text variant="caption" color={colors.muted}>{eventDay(event.startsAt, event.timezone)} · {eventTime(event.startsAt, event.timezone)}</Text>
        </View>
        {event.city || event.venue ? (
          <View style={styles.meta}>
            <Icon name="pin" size={13} color={colors.muted} />
            <Text variant="caption" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>{distance ? `${distance} · ` : ''}{placeOf(event)}</Text>
          </View>
        ) : null}
        {cost ? <Text variant="small" weight="bold" color={colors.accent}>{cost}</Text> : null}
      </View>
      {!event.isPrivate ? <Heart saved={saved} onPress={onHeart} size={36} /> : null}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.night },
  tileTop: { flexDirection: 'row', alignItems: 'center', padding: space.md, gap: space.xs },
  tileBottom: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  go: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },

  poster: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  posterCover: { height: 150 },
  posterTop: { flexDirection: 'row', alignItems: 'flex-start', padding: space.sm },
  posterTag: { position: 'absolute', left: space.sm, bottom: space.sm },
  stamp: { minWidth: 46, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.md, backgroundColor: colors.white, alignItems: 'center' },
  stampMonth: { fontSize: 10, lineHeight: 12, letterSpacing: 0.6 },
  stampDay: { fontSize: 18, lineHeight: 21 },
  posterBody: { padding: space.md, gap: 4, flex: 1 },
  posterTitle: { minHeight: 44 },
  posterFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 4 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 88, height: 88, borderRadius: radius.md },
  rowBody: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
