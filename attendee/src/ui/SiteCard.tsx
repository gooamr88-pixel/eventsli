import { Image } from 'expo-image';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import type { EventCard as Event } from '../api/types';
import { dateBlock, eventDay, listedTime, money } from '../lib/format';
import { imageUrl } from '../lib/images';
import { Heart } from './bits';
import { Icon, type IconName } from './Icon';
import { Pressy } from './motion';
import { Text } from './Text';
import { colors, fonts, space } from './theme';

/**
 * THE WEBSITE'S EVENT CARDS, in the app (2026-11-28, owner: "as website").
 *
 * Ported from frontend/src/app/components/EventCard.jsx and its CSS
 * (.es-evcard, .es-lp-datebadge, .es-evcard__sale), at the phone-rail sizes
 * the site uses below 48rem — so a person who knows eventsli.com knows these.
 *
 *   SiteCard   the grid / rail card: the flyer WHOLE on a blurred copy of
 *              itself, the date badge, the sale tag, the heart; the name in
 *              Urbanist; the day and place with coral icons; a hairline; the
 *              price and a round coral arrow.
 *   ListCard   the /events list card: the flyer on the left, the name, the
 *              day, the address, and "Info only" + Details or the price.
 */

type Kind = 'on-sale' | 'info' | 'sold-out' | 'soon' | 'fast' | 'past' | 'private';

/** The site's saleTag(): which events can actually be bought here, at a glance. */
export function saleTag(e: Event): { kind: Kind; label: string } | null {
  if (e.isPast) return { kind: 'past', label: 'Past event' };
  if (e.isPrivate) return { kind: 'private', label: 'Private event' };
  if (e.comingSoon) return { kind: 'soon', label: 'Coming soon' };
  if (e.displayOnly) return { kind: 'info', label: 'Info only' };
  if (e.availability?.soldOut) return { kind: 'sold-out', label: 'Sold out' };
  if (e.fromPriceCents === null || e.fromPriceCents === undefined) return null;
  if (e.availability?.sellingFast) return { kind: 'fast', label: 'Selling fast' };
  return { kind: 'on-sale', label: 'Tickets on sale' };
}

/** The site's priceBlock(): "From / $100", "Tickets / Free", "Listing / Details". */
export function priceBlock(e: Event): { label: string; value: string } | null {
  if (e.isPrivate || e.comingSoon || e.isPast) return null;
  if (e.displayOnly) return { label: 'Listing', value: 'Details' };
  if (e.availability?.soldOut) return { label: 'Tickets', value: 'Sold out' };
  if (e.fromPriceCents === null || e.fromPriceCents === undefined || !e.currency) return null;
  if (e.fromPriceCents === 0) return { label: 'Tickets', value: 'Free' };
  return { label: 'From', value: money(e.fromPriceCents, e.currency) };
}

const TAG_ICON: Partial<Record<Kind, IconName>> = { 'on-sale': 'ticket', soon: 'bell', fast: 'trend', past: 'clock', private: 'lock' };

/** The flyer, whole, over a blurred and darkened copy of itself (the site's phone rail). */
export function PosterArt({ uri, blurred, size, style, children }: {
  uri: string | null | undefined; blurred?: boolean; size: number; style?: ViewStyle; children?: React.ReactNode;
}) {
  const src = imageUrl(uri, size);
  return (
    <View style={[styles.art, style]}>
      {src ? (
        <>
          <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={blurred ? 30 : 18} transition={150} />
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
          {!blurred ? <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} recyclingKey={src} /> : null}
        </>
      ) : null}
      {children}
    </View>
  );
}

/** "04 / DEC" in a white square, top-left of the flyer. */
export function DateBadge({ iso, tz, big = false }: { iso: string; tz: string | null | undefined; big?: boolean }) {
  const d = dateBlock(iso, tz);
  return (
    <View style={[styles.badge, big && styles.badgeBig]}>
      <Text style={[styles.badgeDay, big && styles.badgeDayBig]}>{d.day.padStart(2, '0')}</Text>
      <Text style={[styles.badgeMonth, big && styles.badgeMonthBig]}>{d.month}</Text>
    </View>
  );
}

export function SaleTag({ e, style }: { e: Event; style?: ViewStyle }) {
  const tag = saleTag(e);
  if (!tag) return null;
  const icon = TAG_ICON[tag.kind];
  const tone = TONE[tag.kind];
  return (
    <View style={[styles.sale, { backgroundColor: tone.bg }, tone.border ? styles.saleBorder : null, style]}>
      {icon ? <Icon name={icon} size={12} color={tone.fg} strokeWidth={2.4} /> : null}
      <Text style={[styles.saleText, { color: tone.fg }]} numberOfLines={1}>{tag.label}</Text>
    </View>
  );
}

const TONE: Record<Kind, { bg: string; fg: string; border?: boolean }> = {
  'on-sale': { bg: colors.highlight, fg: colors.onHighlight },
  info: { bg: colors.white, fg: colors.text, border: true },
  'sold-out': { bg: colors.night, fg: colors.white },
  soon: { bg: colors.accent, fg: colors.white },
  fast: { bg: colors.accent, fg: colors.white },
  past: { bg: '#e4e4e8', fg: colors.text },
  private: { bg: colors.night, fg: colors.white },
};

/** The grid / rail card (.es-evcard at the phone-rail sizes). */
export function SiteCard({ event: e, saved, onHeart, onPress, width, style, distance }: {
  event: Event; saved: boolean; onHeart: () => void; onPress: () => void; width?: number; style?: ViewStyle; distance?: string;
}) {
  const price = priceBlock(e);
  const place = e.isPrivate ? (e.organizer?.name ? `By ${e.organizer.name}` : '') : [e.venue, e.city].filter(Boolean).join(', ');
  const time = listedTime(e.startsAt, e.timezone);
  const artSize = width ? width - 20 : 170;
  return (
    <Pressy accessibilityRole="button" accessibilityLabel={`${e.title}, ${eventDay(e.startsAt, e.timezone)}${place ? `, ${place}` : ''}`}
      onPress={onPress} scale={0.97} style={[styles.card, width ? { width } : null, style]}>
      <PosterArt uri={e.coverUrl} blurred={e.blurredCover} size={artSize} style={styles.cardArt}>
        {!e.comingSoon ? <View style={styles.badgeAt}><DateBadge iso={e.startsAt} tz={e.timezone} /></View> : null}
        {!e.isPrivate ? <View style={styles.heartAt}><Heart saved={saved} onPress={onHeart} size={30} /></View> : null}
        <SaleTag e={e} style={styles.saleAt} />
      </PosterArt>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{e.title}</Text>
        <View style={styles.meta}>
          {!e.comingSoon ? (
            <View style={styles.line}>
              <Icon name="clock" size={13} color={colors.accent} strokeWidth={2.2} />
              <Text style={styles.lineText} numberOfLines={1}>{[eventDay(e.startsAt, e.timezone), time].filter(Boolean).join(' · ')}</Text>
            </View>
          ) : null}
          {distance || place ? (
            <View style={styles.line}>
              <Icon name="pin" size={13} color={colors.accent} strokeWidth={2.2} />
              <Text style={styles.lineText} numberOfLines={1}>{distance || place}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.foot}>
          {price ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.priceLabel}>{price.label}</Text>
              <Text style={styles.priceValue} numberOfLines={1}>{price.value}</Text>
            </View>
          ) : <View style={{ flex: 1 }} />}
          <View style={styles.go}><Icon name="arrow" size={15} color={colors.white} strokeWidth={2.4} /></View>
        </View>
      </View>
    </Pressy>
  );
}

/** The /events list card: flyer left, words right, the action at the foot. */
export function ListCard({ event: e, saved, onHeart, onPress, distance }: {
  event: Event; saved: boolean; onHeart: () => void; onPress: () => void; distance?: string;
}) {
  const price = priceBlock(e);
  const tag = saleTag(e);
  const place = e.isPrivate ? (e.organizer?.name ? `By ${e.organizer.name}` : '') : e.venueAddress || [e.venue, e.city].filter(Boolean).join(', ');
  const time = listedTime(e.startsAt, e.timezone);
  const buyable = price && price.label !== 'Listing' && price.value !== 'Sold out';
  return (
    <Pressy accessibilityRole="button" accessibilityLabel={`${e.title}, ${eventDay(e.startsAt, e.timezone)}${place ? `, ${place}` : ''}`}
      onPress={onPress} scale={0.98} style={styles.list}>
      <PosterArt uri={e.coverUrl} blurred={e.blurredCover} size={110} style={styles.listArt} />
      <View style={styles.listBody}>
        <View style={styles.listHead}>
          <Text style={styles.listTitle} numberOfLines={2}>{e.title}</Text>
          {!e.isPrivate ? <Heart saved={saved} onPress={onHeart} size={30} /> : null}
        </View>
        {!e.comingSoon ? (
          <View style={styles.line}>
            <Icon name="calendar" size={14} color={colors.muted} strokeWidth={2} />
            <Text style={styles.listLine} numberOfLines={1}>{[eventDay(e.startsAt, e.timezone), time].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
        {distance || place ? (
          <View style={styles.line}>
            <Icon name="pin" size={14} color={colors.muted} strokeWidth={2} />
            <Text style={styles.listLine} numberOfLines={1}>{distance || place}</Text>
          </View>
        ) : null}
        <View style={styles.listFoot}>
          {buyable ? (
            <View style={styles.listBuy}><Text style={styles.listBuyText}>Tickets {price.label === 'From' ? `From ${price.value}` : price.value}</Text></View>
          ) : (
            <>
              {tag ? <View style={styles.listInfo}><Text style={styles.listInfoText}>{tag.label === 'Info only' ? 'Info only' : tag.label}</Text></View> : null}
              <View style={styles.listBuy}><Text style={styles.listBuyText}>Details</Text></View>
            </>
          )}
        </View>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  art: { overflow: 'hidden', backgroundColor: colors.bgSunken },
  dim: { backgroundColor: 'rgba(17,16,24,0.28)' },

  card: { padding: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  cardArt: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  badgeAt: { position: 'absolute', left: 6, top: 6 },
  heartAt: { position: 'absolute', right: 6, top: 6 },
  saleAt: { position: 'absolute', left: 6, bottom: 6, maxWidth: '90%' },

  badge: { minWidth: 36, alignItems: 'center', paddingHorizontal: 5, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.white, shadowColor: '#111018', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  badgeBig: { minWidth: 48, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 },
  badgeDay: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 16, color: colors.text },
  badgeDayBig: { fontSize: 18, lineHeight: 20 },
  badgeMonth: { fontFamily: fonts.semibold, fontSize: 9, lineHeight: 11, letterSpacing: 0.8, color: colors.accent, marginTop: 1 },
  badgeMonthBig: { fontSize: 10, lineHeight: 12 },

  sale: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, shadowColor: '#111018', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  saleBorder: { borderWidth: 1, borderColor: '#d9d9de' },
  saleText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 13, letterSpacing: 0.2 },

  body: { paddingTop: 8, paddingHorizontal: 2 },
  title: { fontFamily: fonts.display, fontSize: 15, lineHeight: 19, minHeight: 38, color: colors.text, letterSpacing: -0.1 },
  meta: { gap: 3, marginTop: 4, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lineText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  priceLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 13, color: colors.muted },
  priceValue: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, color: colors.text },
  go: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },

  list: { flexDirection: 'row', gap: space.lg, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  listArt: { width: 110, height: 128, borderRadius: 12 },
  listBody: { flex: 1, gap: 5 },
  listHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  listTitle: { flex: 1, fontFamily: fonts.display, fontSize: 17, lineHeight: 21, color: colors.text },
  listLine: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  listFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 'auto', paddingTop: 4 },
  listInfo: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.bgSunken },
  listInfoText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  listBuy: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.accent },
  listBuyText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
