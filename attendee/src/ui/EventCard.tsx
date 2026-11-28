import { router } from 'expo-router';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { eventBySlug } from '../api/endpoints';
import type { EventCard as Event } from '../api/types';
import { useSession } from '../auth/session';
import { eventDate, price } from '../lib/format';
import { queryClient } from '../lib/queryClient';
import { Badge, type Tone } from './bits';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Pressy } from './motion';
import { ListCard, SiteCard } from './SiteCard';
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

/** What a card says about the price: "From $100", "Free" — never the bare "Listing". */
export function cardPrice(e: Event): string {
  const p = priceLine(e);
  return p === 'Listing' ? '' : p;
}

/**
 * The event card — the WEBSITE's card (2026-11-28, owner: "as website"):
 * see ui/SiteCard.tsx. Kept under this name so every list in the app follows.
 */
export function EventPoster({ event, saved, onHeart, width, style, distance }: {
  event: Event; saved: boolean; onHeart: () => void; width?: number; style?: ViewStyle;
  /** "2.3 km away" — on Home's Near You row. */
  distance?: string;
}) {
  return <SiteCard event={event} saved={saved} onHeart={onHeart} onPress={() => openEvent(event)} width={width} style={style} distance={distance} />;
}

/**
 * An event as a row — the website's /events list card (ui/SiteCard.tsx).
 * The 'big' prop is kept for callers; the list card is one size.
 */
export function EventRow({ event, saved, onHeart, distance }: { event: Event; saved: boolean; onHeart: () => void; distance?: string; big?: boolean }) {
  return <ListCard event={event} saved={saved} onHeart={onHeart} onPress={() => openEvent(event)} distance={distance} />;
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.night },
  tileBottom: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  go: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
