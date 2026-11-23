import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { EventCard as Event } from '../api/types';
import { eventDay, eventTime, price } from '../lib/format';
import { Heart } from './bits';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Text } from './Text';
import { colors, radius, shadow, space } from './theme';

const open = (e: Event) => router.push({ pathname: '/event/[slug]', params: { slug: e.slug } });

/** The tag in the corner: the facts a buyer acts on, in the order they matter. */
function tagFor(e: Event): { label: string; tone: 'accent' | 'dark' | 'highlight' } | null {
  if (e.isPrivate) return { label: 'Private', tone: 'dark' };
  if (e.isPast) return { label: 'Past event', tone: 'dark' };
  if (e.comingSoon) return { label: 'Coming soon', tone: 'highlight' };
  if (e.availability?.soldOut) return { label: 'Sold out', tone: 'dark' };
  if (e.availability?.sellingFast) return { label: 'Selling fast', tone: 'accent' };
  return null;
}

function Tag({ e }: { e: Event }) {
  const tag = tagFor(e);
  if (!tag) return null;
  const bg = tag.tone === 'accent' ? colors.accent : tag.tone === 'highlight' ? colors.highlight : colors.night;
  const fg = tag.tone === 'highlight' ? colors.onHighlight : colors.white;
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text variant="caption" weight="bold" color={fg}>{tag.label}</Text>
    </View>
  );
}

function priceLine(e: Event): string {
  if (e.displayOnly) return 'Listing';
  if (e.fromPriceCents === null || e.fromPriceCents === undefined || !e.currency) return '';
  return e.fromPriceCents === 0 ? 'Free' : `From ${price(e.fromPriceCents, e.currency)}`;
}

/**
 * The big card: the Home "Trending" banner and the Explore grid. Words sit on
 * the cover's dark scrim, as the mockup sets them.
 */
export function EventTile({ event, saved, onHeart, height = 180, wide = false, badge }: {
  event: Event; saved: boolean; onHeart: () => void; height?: number; wide?: boolean;
  /** "Trending" on Home's banner; shown beside the event's own tag, not over it. */
  badge?: string;
}) {
  const where = [event.venue, event.city].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDay(event.startsAt, event.timezone)}${where ? `, ${where}` : ''}`}
      onPress={() => open(event)}
      style={({ pressed }) => [styles.tile, shadow.card, wide && styles.tileWide, pressed && styles.pressed]}
    >
      <Cover uri={event.coverUrl} title={event.title} blurred={event.blurredCover} scrim style={{ height }}>
        <View style={styles.tileTop}>
          {badge ? (
            <View style={[styles.tag, { backgroundColor: colors.accent }]}>
              <Text variant="caption" weight="bold" color={colors.white}>{badge}</Text>
            </View>
          ) : null}
          <Tag e={event} />
          <View style={{ flex: 1 }} />
          {!event.isPrivate ? <Heart saved={saved} onPress={onHeart} onDark /> : null}
        </View>
        <View style={styles.tileBottom}>
          {event.categoryLabel ? (
            <Text variant="caption" weight="bold" color={colors.sun200}>{event.categoryLabel.toUpperCase()}</Text>
          ) : null}
          <Text variant={wide ? 'heading' : 'title'} color={colors.white} numberOfLines={2}>{event.title}</Text>
          <Text variant="caption" color={colors.onDarkMuted} numberOfLines={1}>
            {eventDay(event.startsAt, event.timezone)} • {eventTime(event.startsAt, event.timezone)}{where ? ` • ${where}` : ''}
          </Text>
        </View>
      </Cover>
    </Pressable>
  );
}

/** The list row: Saved Events, search results. */
export function EventRow({ event, saved, onHeart }: { event: Event; saved: boolean; onHeart: () => void }) {
  const cost = priceLine(event);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventDay(event.startsAt, event.timezone)}`}
      onPress={() => open(event)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Cover uri={event.coverUrl} blurred={event.blurredCover} style={styles.thumb} />
      <View style={styles.rowBody}>
        <Text variant="label" weight="bold" numberOfLines={2}>{event.title}</Text>
        <View style={styles.meta}>
          <Icon name="calendar" size={14} color={colors.muted} />
          <Text variant="caption" color={colors.muted}>{eventDay(event.startsAt, event.timezone)}</Text>
        </View>
        {event.city || event.venue ? (
          <View style={styles.meta}>
            <Icon name="pin" size={14} color={colors.muted} />
            <Text variant="caption" color={colors.muted} numberOfLines={1}>{[event.venue, event.city].filter(Boolean).join(', ')}</Text>
          </View>
        ) : null}
        {cost ? <Text variant="small" weight="bold" color={colors.accent}>{cost}</Text> : null}
      </View>
      {!event.isPrivate ? <Heart saved={saved} onPress={onHeart} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.night, flex: 1 },
  tileWide: { flex: 0 },
  tileTop: { flexDirection: 'row', alignItems: 'center', padding: space.md, gap: space.xs },
  tileBottom: { position: 'absolute', left: space.md, right: space.md, bottom: space.md, gap: 2 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm },
  pressed: { opacity: 0.85 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 76, height: 76, borderRadius: radius.md },
  rowBody: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
