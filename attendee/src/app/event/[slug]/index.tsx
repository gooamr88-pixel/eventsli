import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown, useAnimatedScrollHandler, useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { eventBySlug, listEvents, notifyWhenOnSale, seatMap } from '@/api/endpoints';
import type { EventCard as EventCardType, EventDetail, Tier } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { countdownParts, useNow } from '@/lib/countdown';
import { eventDate, eventTime, listedTime, price } from '@/lib/format';
import { imageUrl } from '@/lib/images';
import { splitAbout } from '@/lib/about';
import { useRecent } from '@/lib/recent';
import { buildModel } from '@/seating/model';
import { SeatMapView } from '@/seating/SeatMapView';
import { Empty, Failed, Header, Heart, IconButton, Section } from '@/ui/bits';
import { BottomBar } from '@/ui/BottomBar';
import { Button } from '@/ui/Button';
import { priceLine } from '@/ui/EventCard';
import { EventRail } from '@/ui/EventRail';
import { Field } from '@/ui/Field';
import { Icon, type IconName } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { Sheet } from '@/ui/Sheet';
import { PosterArt, priceBlock, SaleTag } from '@/ui/SiteCard';
import { Text } from '@/ui/Text';
import { colors, fonts, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * The event — the mockup's fifth frame at the top (the photo, the name and
 * the heart, the date and the place, About with Read More, the gallery
 * strip, Select Tickets), and under it everything else a buyer wants before
 * paying, each part shown only when the organizer filled it in:
 *
 *   a countdown · the ticket prices · the seat map · the lineup · extras ·
 *   getting there · the organizer · sponsors · good to know · similar events
 *
 * The photo drifts slower than the page as it scrolls (parallax; off with
 * Reduce Motion). The card that was tapped is drawn at once while the full
 * event loads (EventCard.openEvent), and the seat map starts downloading
 * here so the next screen opens ready.
 */
export default function EventScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const { isSaved, flip } = useSaved();
  const { tablet, width } = useLayout();
  const qc = useQueryClient();
  const [more, setMore] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['event', slug],
    queryFn: () => eventBySlug(slug, token),
    enabled: Boolean(slug),
    staleTime: 60_000,
    placeholderData: () => qc.getQueryData<EventCardType>(['event-card', slug]) as EventDetail | undefined,
  });
  const preview = q.isPlaceholderData;
  const e = q.data;
  const reserved = Boolean(e && !preview && e.admissionType !== 'general' && e.purchasable && !e.isPast && !e.comingSoon);
  const map = useQuery({ queryKey: ['seat-map', slug], queryFn: () => seatMap(slug, token), enabled: reserved, staleTime: 30_000 });
  const model = useMemo(() => (map.data ? buildModel(map.data) : null), [map.data]);
  const similar = useQuery({
    queryKey: ['events', 'similar', e?.category ?? null],
    enabled: Boolean(e?.category && !preview),
    queryFn: () => listEvents({ category: e!.category!, limit: 11 }, token).then((r) => r.data),
  });

  // Remember it for Home's "Recently Viewed" once the real event is here.
  useEffect(() => { if (e && !preview) useRecent.getState().add(e); }, [e, preview]);

  const heroH = tablet ? 400 : 330;
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((ev) => { scrollY.set(ev.contentOffset.y); });

  if (q.isLoading) {
    return (
      <View style={styles.root}>
        <Skeleton height={heroH} round={0} />
        <Container style={{ gap: space.md, paddingTop: space.xl }}>
          <Skeleton height={28} width="75%" />
          <Skeleton height={16} width="45%" />
          <Skeleton height={44} style={{ marginTop: space.md }} />
        </Container>
        <Header transparent />
      </View>
    );
  }
  if (q.isError || !e) {
    const code = q.error instanceof ApiError ? q.error.code : null;
    return (
      <View style={styles.root}>
        <Header />
        {code === 'EVENT_NOT_FOUND' ? (
          <Empty icon="calendar" title="This event is not available" body="It may have ended, or been taken down by its organizer." action="Explore events" onAction={() => router.replace('/(tabs)/explore')} />
        ) : code === 'EVENT_PRIVATE' ? (
          <Empty icon="lock" title="A private event" body="Its organizer has it behind a password. Open the invitation to unlock it." action="Open invitation"
            onAction={() => { void WebBrowser.openBrowserAsync(`${SITE}/e/${slug}`); }} />
        ) : (
          <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />
        )}
      </View>
    );
  }

  const blocker = preview ? null : whyNot(e);
  const next = () => {
    haptic.commit();
    if (e.admissionType === 'general') router.push({ pathname: '/event/[slug]/tickets', params: { slug: e.slug } });
    else router.push({ pathname: '/event/[slug]/seats', params: { slug: e.slug } });
  };
  const share = () => { void Share.share({ message: `${e.title} — ${SITE}/e/${e.slug}`, url: `${SITE}/e/${e.slug}` }); };
  const tiers = (e.tiers ?? []).filter((t) => !t.hidden);
  const photos = (e.gallery ?? []).filter((m) => m.kind !== 'video' && m.url);
  const cost = priceLine(e);
  const about = splitAbout(e.description);
  // The page carries ticket types, not the listing's from-price: the lowest on sale.
  const lowest = tiers.filter((t) => t.onSale && !t.soldOut).reduce<number | null>((m, t) => (m === null || t.priceCents < m ? t.priceCents : m), null);
  const fromPrice = priceBlock({ ...e, fromPriceCents: e.fromPriceCents ?? lowest });
  const others = (similar.data ?? []).filter((x) => x.id !== e.id).slice(0, 10);

  return (
    <View style={styles.root}>
      <Header right={<IconButton icon="share" label="Share event" size={22} onPress={share} />} />
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {/* ── AS THE WEBSITE (2026-11-28): the flyer whole in a rounded card ── */}
        <Container style={{ paddingTop: space.xs }}>
          <View style={styles.posterWrap}>
            <PosterArt uri={e.coverUrl} blurred={e.blurredCover} size={width} style={styles.poster}>
              {!e.isPrivate ? <View style={styles.posterHeart}><Heart saved={isSaved(e.id)} onPress={() => flip(e.id)} size={40} /></View> : null}
              <SaleTag e={e} style={styles.posterTag} />
            </PosterArt>
          </View>
        </Container>

        <View>
          <Container style={tablet ? [styles.body, styles.bodyTablet] : styles.body}>
            {/* The name, the organizer's own line in coral, and the story — one soft panel, as on the site. */}
            <Animated.View entering={FadeInDown.duration(300)} style={styles.panel}>
              <Text variant={tablet ? 'display' : 'heading'} accessibilityRole="header">{e.title}</Text>
              {about.tagline ? <Text style={styles.tagline}>{about.tagline}</Text>
                : e.categoryLabel ? <Text style={styles.tagline}>{e.categoryLabel}</Text> : null}
              {preview ? (
                <View style={{ gap: space.sm }}>
                  <Skeleton height={14} />
                  <Skeleton height={14} width="80%" />
                </View>
              ) : about.body ? (
                <View style={{ gap: space.xs }}>
                  <Text variant="body" color={colors.text} style={styles.story} numberOfLines={more ? undefined : 4}>{about.body}</Text>
                  {about.body.length > 160 ? (
                    <Pressable accessibilityRole="button" onPress={() => setMore((v) => !v)} hitSlop={8} style={styles.more}>
                      <Text variant="label" weight="bold" color={colors.accent}>{more ? 'See less' : 'See more'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </Animated.View>

            {/* The site's details list: when, where, who, what it costs. */}
            <View style={styles.panel}>
              <Detail icon="clock" text={`Event starts at ${eventDate(e.startsAt, e.timezone)}${listedTime(e.startsAt, e.timezone) ? `, ${listedTime(e.startsAt, e.timezone)}` : ''}`} />
              {e.endsAt ? <Detail icon="clock" text={`Ends at ${eventDate(e.endsAt, e.timezone)}${listedTime(e.endsAt, e.timezone) ? `, ${listedTime(e.endsAt, e.timezone)}` : ''}`} /> : null}
              {e.venue || e.city ? <Detail icon="pin" text={e.venue || e.city || ''} onPress={() => openMaps(e)} /> : null}
              {e.venueAddressFull && e.venueAddressFull !== e.venue ? <Detail icon="building" text={e.venueAddressFull} onPress={() => openMaps(e)} /> : null}
              {e.organizer ? (
                <Detail icon="tag" text="Presented by " link={e.organizer.name}
                  onPress={e.organizerProfile ? () => router.push({ pathname: '/organizer/[slug]', params: { slug: e.organizerProfile!.slug } }) : undefined} />
              ) : null}
              {cost ? <Detail icon="ticket" text={cost === 'Listing' ? 'Tickets are sold by the organizer' : cost} /> : null}
            </View>

            {photos.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                {photos.map((m, i) => (
                  <Pressable key={m.id} accessibilityRole="imagebutton" accessibilityLabel={m.caption || `Photo ${i + 1} of ${photos.length}`} onPress={() => setViewer(i)}>
                    <Image source={{ uri: imageUrl(m.url, 120) ?? undefined }} style={styles.thumb} contentFit="cover" transition={150} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* ── More, under the mockup's part ── */}
            {!e.isPast && !e.comingSoon ? <Countdown startsAt={e.startsAt} /> : null}

            {tiers.length ? (
              <Block title="Tickets">
                {tiers.map((t, i) => <TierRow key={t.id} t={t} currency={e.currency} last={i === tiers.length - 1} />)}
              </Block>
            ) : null}

            {reserved ? (
              <Block title="Seating Map" action="Choose seats" onAction={next}>
                <Pressable accessibilityRole="button" accessibilityLabel="Open the seating map" onPress={next} style={styles.mapCard}>
                  {model ? <SeatMapView model={model} currency={e.currency ?? 'USD'} interactive={false} style={styles.mapPreview} />
                    : <Skeleton height={200} round={16} />}
                </Pressable>
              </Block>
            ) : null}

            {e.schedule?.length ? (
              <Block title="Lineup">
                {e.schedule.map((s, i) => (
                  <View key={s.id} style={[styles.slot, i < e.schedule!.length - 1 && styles.hair]}>
                    <Text variant="small" weight="bold" color={colors.accent} style={styles.slotTime}>{s.startsAt ? eventTime(s.startsAt, e.timezone) : '—'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text variant="label" weight="bold">{s.title}</Text>
                      {s.description || s.location ? <Text variant="small" color={colors.muted} numberOfLines={2}>{[s.location, s.description].filter(Boolean).join(' · ')}</Text> : null}
                    </View>
                  </View>
                ))}
              </Block>
            ) : null}

            {e.addons?.length ? (
              <Block title="Extras">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
                  {e.addons.map((a) => (
                    <View key={a.id} style={styles.addon}>
                      {a.imageUrl ? <Image source={{ uri: imageUrl(a.imageUrl, 150) ?? undefined }} style={styles.addonImage} contentFit="cover" />
                        : <View style={[styles.addonImage, styles.addonIcon]}><Icon name="sparkle" size={26} color={colors.accent} /></View>}
                      <Text variant="small" weight="bold" numberOfLines={1}>{a.name}</Text>
                      <Text variant="small" color={colors.muted}>{price(a.priceCents, e.currency)}</Text>
                    </View>
                  ))}
                </ScrollView>
              </Block>
            ) : null}

            <Venue e={e} />

            {e.organizerProfile ? <Organizer e={e} /> : null}

            {e.sponsors?.length ? (
              <Block title="Sponsors">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
                  {e.sponsors.map((sp) => (
                    <Pressable key={sp.id} disabled={!sp.linkUrl} onPress={() => sp.linkUrl && WebBrowser.openBrowserAsync(sp.linkUrl)} style={styles.sponsor} accessibilityLabel={sp.name}>
                      {sp.logoUrl ? <Image source={{ uri: imageUrl(sp.logoUrl, 120) ?? undefined }} style={styles.sponsorLogo} contentFit="contain" />
                        : <Text variant="small" weight="bold" align="center" numberOfLines={2}>{sp.name}</Text>}
                    </Pressable>
                  ))}
                </ScrollView>
              </Block>
            ) : null}

            {e.policies?.length ? (
              <Block title="Good to Know">
                {e.policies.map((p, i) => <Policy key={p.id} title={p.title} body={p.body} last={i === e.policies!.length - 1} />)}
              </Block>
            ) : null}
          </Container>

          <EventRail title="Similar Events" events={others} loading={similar.isLoading && Boolean(e.category)} isSaved={isSaved} flip={flip} />
        </View>
      </Animated.ScrollView>

      <BottomBar>
        {preview ? <Skeleton height={52} round={14} />
          : e.comingSoon ? <Button label="Notify Me" icon="bell" onPress={() => setNotifyOpen(true)} />
            : blocker ? <View style={styles.blocker}><Text variant="small" weight="semibold" color={colors.muted} align="center">{blocker}</Text></View>
              // As the website: FROM and the price on the left, the coral pill on the right.
              : (
                <View style={styles.barRow}>
                  {fromPrice ? (
                    <View>
                      <Text style={styles.fromLabel}>{fromPrice.label.toUpperCase()}</Text>
                      <Text style={styles.fromValue}>{fromPrice.value}</Text>
                    </View>
                  ) : null}
                  <Button label={e.admissionType === 'general' ? 'Get your tickets' : 'Choose your seats'} iconRight="arrow" onPress={next} style={styles.pill} />
                </View>
              )}
      </BottomBar>

      <Gallery photos={photos} index={viewer} onClose={() => setViewer(null)} />
      <NotifySheet visible={notifyOpen} onClose={() => setNotifyOpen(false)} slug={e.slug} title={e.title} />
    </View>
  );
}

/** One line of the website's details list: an icon, the words, and maybe a coral link. */
function Detail({ icon, text, link, onPress }: { icon: IconName; text: string; link?: string; onPress?: () => void }) {
  const body = (
    <View style={styles.detail}>
      <Icon name={icon} size={20} color={colors.muted} />
      <Text variant="body" color={colors.text} style={{ flex: 1 }}>
        {text}{link ? <Text variant="body" weight="semibold" color={colors.accent} style={styles.link}>{link}</Text> : null}
      </Text>
    </View>
  );
  return onPress ? <Pressable accessibilityRole={link ? 'link' : 'button'} onPress={onPress}>{body}</Pressable> : body;
}

function whyNot(e: EventDetail): string | null {
  if (e.isPast) return 'This event has ended.';
  if (e.displayOnly) return 'Tickets for this event are sold elsewhere.';
  if (e.availability?.soldOut) return 'Sold out';
  if (!e.purchasable) return 'Tickets are not sold in the app for this event.';
  return null;
}

/** A titled section of the page, appearing as it scrolls into the app. */
function Block({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      <Section title={title} action={action} onAction={onAction} />
      {children}
    </Animated.View>
  );
}

/** Days · Hours · Mins · Secs until the doors, or "Happening now". */
function Countdown({ startsAt }: { startsAt: string }) {
  const now = useNow(1000);
  const parts = countdownParts(Date.parse(startsAt) - now);
  if (!parts) {
    return <View style={styles.live}><View style={styles.liveDot} /><Text variant="small" weight="bold" color={colors.accent}>Happening now</Text></View>;
  }
  const cells: [number, string][] = [[parts.days, 'Days'], [parts.hours, 'Hours'], [parts.minutes, 'Mins'], [parts.seconds, 'Secs']];
  return (
    <View style={styles.countdown} accessible accessibilityLabel={`Starts in ${parts.days} days, ${parts.hours} hours and ${parts.minutes} minutes`}>
      {cells.map(([n, label]) => (
        <View key={label} style={styles.cell}>
          <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }}>{String(n).padStart(2, '0')}</Text>
          <Text variant="caption" color={colors.muted}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function TierRow({ t, currency, last }: { t: Tier; currency: string | undefined; last: boolean }) {
  const off = t.soldOut || t.salesEnded;
  const note = t.soldOut ? 'Sold out' : t.notYetOnSale ? 'Not on sale yet' : t.salesEnded ? 'Sales ended'
    : t.remaining !== null && t.remaining <= 10 ? `Only ${t.remaining} left` : null;
  return (
    <View style={[styles.tier, !last && styles.hair]}>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight="bold" color={off ? colors.subtle : colors.text}>{t.name}</Text>
        {t.description ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{t.description}</Text> : null}
        {note ? <Text variant="caption" weight="semibold" color={t.soldOut ? colors.accent : colors.warning}>{note}</Text> : null}
      </View>
      <Text variant="label" weight="bold" color={off ? colors.subtle : colors.text}>{price(t.priceCents, currency)}</Text>
    </View>
  );
}

function openMaps(e: EventDetail) {
  const where = [e.venue, e.venueAddressFull || e.venueAddress || e.city].filter(Boolean).join(', ');
  const label = encodeURIComponent([e.venue, e.city].filter(Boolean).join(', '));
  const url = e.venueLocation
    ? Platform.select({
      ios: `maps:0,0?q=${label}&ll=${e.venueLocation.lat},${e.venueLocation.lng}`,
      android: `geo:${e.venueLocation.lat},${e.venueLocation.lng}?q=${e.venueLocation.lat},${e.venueLocation.lng}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${e.venueLocation.lat},${e.venueLocation.lng}`,
    })
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
  void Linking.openURL(url as string);
}

/** "Getting there": a drawn street map with the pin, the address, Directions and Share. */
function Venue({ e }: { e: EventDetail }) {
  const address = e.venueAddressFull || e.venueAddress || [e.city, e.country].filter(Boolean).join(', ');
  if (!e.venue && !address) return null;
  return (
    <Block title="Getting There">
      <Pressable accessibilityRole="button" accessibilityLabel="Open the venue in Maps" onPress={() => openMaps(e)} style={styles.venueArt}>
        {[0, 1, 2, 3, 4].map((i) => <View key={`h${i}`} style={[styles.street, { top: 16 + i * 30 }]} />)}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <View key={`v${i}`} style={[styles.avenue, { left: 24 + i * 62 }]} />)}
        <View style={styles.park} />
        <View style={[styles.pin, shadow.raised]}><Icon name="pin" size={22} color={colors.white} strokeWidth={2.2} /></View>
      </Pressable>
      <View style={{ gap: 2, marginTop: space.md }}>
        {e.venue ? <Text variant="label" weight="bold">{e.venue}</Text> : null}
        {address ? <Text variant="small" color={colors.muted}>{address}</Text> : null}
        {e.venueDirections ? <Text variant="small" style={{ marginTop: space.xs }}>{e.venueDirections}</Text> : null}
      </View>
      <View style={styles.venueButtons}>
        <Button label="Directions" icon="map" size="sm" onPress={() => openMaps(e)} style={{ flex: 1 }} />
        <Button label="Share" icon="share" size="sm" variant="soft" onPress={() => { void Share.share({ message: [e.venue, address].filter(Boolean).join(', ') }); }} style={{ flex: 1 }} />
      </View>
    </Block>
  );
}

function Organizer({ e }: { e: EventDetail }) {
  const o = e.organizerProfile!;
  const initials = o.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Block title="Organizer">
      <Pressable accessibilityRole="button" accessibilityLabel={`${o.name}. See their events`} onPress={() => router.push({ pathname: '/organizer/[slug]', params: { slug: o.slug } })}
        style={({ pressed }) => [styles.organizer, pressed && { opacity: 0.7 }]}>
        {o.logoUrl ? <Image source={{ uri: imageUrl(o.logoUrl, 52) ?? undefined }} style={styles.orgLogo} contentFit="cover" />
          : <View style={[styles.orgLogo, styles.orgInitials]}><Text variant="label" weight="bold" color={colors.onHighlight}>{initials}</Text></View>}
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="bold" numberOfLines={1}>{o.name}</Text>
          <Text variant="small" color={colors.muted}>See all their events</Text>
        </View>
        <Icon name="chevronRight" size={20} color={colors.subtle} />
      </Pressable>
    </Block>
  );
}

function Policy({ title, body, last }: { title: string; body: string; last: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={[styles.policy, !last && styles.hair]}>
      <View style={styles.policyHead}>
        <Text variant="label" weight="semibold" style={{ flex: 1 }}>{title}</Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} color={colors.subtle} />
      </View>
      {open ? <Text variant="small" color={colors.muted}>{body}</Text> : null}
    </Pressable>
  );
}

/** The gallery, full screen, swiped through. */
function Gallery({ photos, index, onClose }: { photos: NonNullable<EventDetail['gallery']>; index: number | null; onClose: () => void }) {
  const { width, height } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={index !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {index !== null ? (
          <FlatList
            horizontal
            pagingEnabled
            data={photos}
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(m) => m.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: 'center' }}>
                <Image source={{ uri: imageUrl(item.url, width) ?? undefined }} style={{ width, height: height * 0.75 }} contentFit="contain" />
                {item.caption ? <Text variant="small" color={colors.white} align="center" style={{ padding: space.lg }}>{item.caption}</Text> : null}
              </View>
            )}
          />
        ) : null}
        <View style={[styles.viewerClose, { top: insets.top + space.sm }]}>
          <IconButton icon="close" label="Close photos" variant="glass" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function NotifySheet({ visible, onClose, slug, title }: { visible: boolean; onClose: () => void; slug: string; title: string }) {
  const token = useToken();
  const accountEmail = useSession((s) => s.account?.user.email ?? '');
  const [email, setEmail] = useState(accountEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const close = () => { onClose(); setDone(false); };

  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    setError(null);
    try {
      await notifyWhenOnSale(slug, email.trim(), token);
      haptic.success();
      setDone(true);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={close} title={done ? 'You are on the list' : 'Notify Me'} subtitle={title}
      footer={done ? <Button label="Done" onPress={close} /> : <Button label="Notify Me" busy={busy} onPress={() => { void submit(); }} />}>
      {done ? (
        <Text variant="body" color={colors.muted}>We will email {email.trim()} once, the moment tickets go on sale.</Text>
      ) : (
        <>
          <Text variant="body" color={colors.muted}>Tickets are not on sale yet. We will send one email when they are.</Text>
          <Field label="Email" icon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error} />
        </>
      )}
    </Sheet>
  );
}

const hairline = StyleSheet.hairlineWidth * 2;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  posterWrap: { padding: 10, borderRadius: 28, backgroundColor: colors.bgSunken },
  poster: { width: '100%', aspectRatio: 4 / 5, borderRadius: 20 },
  posterHeart: { position: 'absolute', right: 12, top: 12 },
  posterTag: { position: 'absolute', left: 12, bottom: 12 },
  panel: { gap: space.md, padding: space.lg, borderRadius: 22, backgroundColor: '#f8f7f8' },
  tagline: { fontFamily: fonts.display, fontSize: 19, lineHeight: 24, color: colors.accent },
  story: { fontSize: 16, lineHeight: 25 },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  link: { textDecorationLine: 'underline' },
  fromLabel: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, color: colors.accent },
  fromValue: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: colors.text },
  pill: { flex: 1, borderRadius: 999 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  sheet: { marginTop: -24, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.bg },
  body: { paddingTop: space.xl, gap: space.xl },
  bodyTablet: { maxWidth: 760 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  facts: { flexDirection: 'row', gap: space.lg },
  fact: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  countdown: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1, alignItems: 'center', paddingVertical: space.md, borderRadius: 14, backgroundColor: colors.bgSunken },
  live: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.coral50 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  thumb: { width: 64, height: 48, borderRadius: 8 },
  hair: { borderBottomWidth: hairline, borderBottomColor: colors.border },
  tier: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  mapCard: { borderRadius: 16, overflow: 'hidden', borderWidth: hairline, borderColor: colors.border },
  mapPreview: { height: 200, borderRadius: 0 },
  slot: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  slotTime: { width: 72 },
  addon: { width: 130, gap: 4 },
  addonImage: { width: 130, height: 90, borderRadius: 12 },
  addonIcon: { backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center' },
  venueArt: { height: 150, borderRadius: 16, backgroundColor: '#eef0ea', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  street: { position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: '#ffffff' },
  avenue: { position: 'absolute', top: 0, bottom: 0, width: 8, backgroundColor: '#ffffff' },
  park: { position: 'absolute', left: 40, top: 54, width: 80, height: 46, borderRadius: 8, backgroundColor: '#d4e8cf' },
  pin: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.white },
  venueButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  organizer: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  orgLogo: { width: 52, height: 52, borderRadius: 26 },
  orgInitials: { backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  sponsor: { width: 110, height: 64, borderRadius: 12, backgroundColor: colors.bgSunken, alignItems: 'center', justifyContent: 'center', padding: space.sm },
  sponsorLogo: { width: 90, height: 44 },
  policy: { gap: space.sm, paddingVertical: space.md },
  policyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  blocker: { minHeight: 52, borderRadius: 14, backgroundColor: colors.bgSunken, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -space.xs },
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerClose: { position: 'absolute', right: space.lg },
});
