import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { eventBySlug, notifyWhenOnSale, seatMap } from '@/api/endpoints';
import type { EventDetail, Tier } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useSaved } from '@/hooks/useSaved';
import { countdownParts, useNow } from '@/lib/countdown';
import { eventSpanText, price } from '@/lib/format';
import { buildModel } from '@/seating/model';
import { SeatMapView } from '@/seating/SeatMapView';
import { Badge, Card, Empty, Failed, Header, Heart, IconButton, Section } from '@/ui/bits';
import { BottomBar } from '@/ui/BottomBar';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { priceLine, tagFor } from '@/ui/EventCard';
import { Field } from '@/ui/Field';
import { Icon, type IconName } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * The event (the mockup's fifth frame): the cover, the title and the heart,
 * when and where, a countdown, About, the ticket types, the room's seat map,
 * the extras, how to get there, who is putting it on, and Select Tickets.
 *
 * Select Tickets goes to the seat map for a reserved event and to the quantity
 * picker for general admission (`admissionType`, which the API sends for
 * exactly this branch). Whatever cannot be bought here says why instead of
 * showing a dead button: a listing sold elsewhere, a teaser not yet on sale
 * (with Notify me), a private event behind its password, an event that is over.
 *
 * On a wide screen the page is two columns: the story on the left, and the
 * tickets with their button on the right where the eye lands.
 */
export default function EventScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const { isSaved, flip } = useSaved();
  const { wide, tablet } = useLayout();
  const [more, setMore] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);

  const q = useQuery({ queryKey: ['event', slug], queryFn: () => eventBySlug(slug, token), enabled: Boolean(slug) });
  const e = q.data;
  const reserved = Boolean(e && e.admissionType !== 'general' && !e.comingSoon && !e.displayOnly && !e.isPast);
  const map = useQuery({ queryKey: ['seat-map', slug], queryFn: () => seatMap(slug, token), enabled: reserved, staleTime: 30_000 });
  const model = useMemo(() => (map.data ? buildModel(map.data) : null), [map.data]);

  if (q.isLoading) return <EventSkeleton />;
  if (q.isError || !e) {
    const code = q.error instanceof ApiError ? q.error.code : null;
    return (
      <View style={styles.root}>
        <Header />
        {code === 'EVENT_NOT_FOUND' ? (
          <Empty icon="calendar" title="This event is not available" body="It may have ended, or been taken down by its organizer." action="Explore events" onAction={() => router.replace('/(tabs)/explore')} />
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

  const blocker = whyNot(e);
  const cost = priceLine(e);
  const tag = tagFor(e);
  const share = () => { void Share.share({ message: `${e.title} — ${SITE}/e/${e.slug}`, url: `${SITE}/e/${e.slug}` }); };
  const next = () => {
    haptic.commit();
    if (e.admissionType === 'general') router.push({ pathname: '/event/[slug]/tickets', params: { slug: e.slug } });
    else router.push({ pathname: '/event/[slug]/seats', params: { slug: e.slug } });
  };

  const action = e.comingSoon ? (
    <Button label="Notify me when on sale" icon="bell" onPress={() => setNotifyOpen(true)} />
  ) : blocker ? (
    <View style={styles.blocker}><Icon name="info" size={18} color={colors.muted} /><Text variant="small" color={colors.muted} style={{ flex: 1 }}>{blocker}</Text></View>
  ) : (
    <Button label={e.admissionType === 'general' ? 'Select Tickets' : 'Choose Seats'} onPress={next} iconRight="arrow" />
  );

  const story = (
    <View style={{ gap: space.xl }}>
      <Animated.View entering={FadeInDown.duration(280)} style={{ gap: space.sm }}>
        <View style={styles.tags}>
          {e.categoryLabel ? <Badge label={e.categoryLabel} tone="muted" /> : null}
          {tag ? <Badge label={tag.label} tone={tag.tone} /> : null}
        </View>
        <View style={styles.titleRow}>
          <Text variant={tablet ? 'display' : 'heading'} accessibilityRole="header" style={{ flex: 1 }}>{e.title}</Text>
          {!e.isPrivate ? <Heart saved={isSaved(e.id)} onPress={() => flip(e.id)} size={44} /> : null}
        </View>
        {e.organizer ? (
          <Pressable
            accessibilityRole={e.organizerProfile ? 'link' : undefined}
            disabled={!e.organizerProfile}
            onPress={() => e.organizerProfile && router.push({ pathname: '/organizer/[slug]', params: { slug: e.organizerProfile.slug } })}
            style={styles.by}
          >
            <Text variant="small" color={colors.muted}>by </Text>
            <Text variant="small" weight="semibold" color={e.organizerProfile ? colors.accent : colors.text}>{e.organizer.name}</Text>
          </Pressable>
        ) : null}
      </Animated.View>

      <Facts e={e} />
      {!e.isPast && !e.comingSoon ? <Countdown startsAt={e.startsAt} /> : null}

      {e.description ? (
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">About the Event</Text>
          <Text variant="body" color={colors.muted} numberOfLines={more ? undefined : 5}>{e.description}</Text>
          {e.description.length > 220 ? (
            <Pressable accessibilityRole="button" onPress={() => setMore((v) => !v)} hitSlop={8} style={styles.more}>
              <Text variant="small" weight="semibold" color={colors.accent}>{more ? 'Show less' : 'Read more'}</Text>
              <Icon name={more ? 'chevronUp' : 'chevronDown'} size={16} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {e.highlights?.length ? (
        <View style={styles.highlights}>
          {e.highlights.map((h) => (
            <View key={h} style={styles.highlight}><Icon name="sparkle" size={14} color={colors.onHighlight} /><Text variant="caption" weight="semibold">{h}</Text></View>
          ))}
        </View>
      ) : null}

      {reserved ? (
        <View>
          <Section title="Seating map" action="Open" onAction={next} />
          <Pressable accessibilityRole="button" accessibilityLabel="Open the seating map" onPress={next} style={[styles.mapCard, shadow.card]}>
            {model ? (
              <SeatMapView model={model} currency={e.currency ?? 'USD'} interactive={false} style={styles.mapPreview} />
            ) : map.isLoading ? <Skeleton height={210} round={0} /> : (
              <View style={[styles.mapPreview, styles.mapNone]}><Icon name="seat" size={28} color={colors.muted} /></View>
            )}
            <View style={styles.mapFoot}>
              <Icon name="map" size={18} color={colors.accent} />
              <Text variant="small" weight="semibold" style={{ flex: 1 }}>Pick your exact seats on the map</Text>
              <Icon name="chevronRight" size={18} color={colors.subtle} />
            </View>
          </Pressable>
        </View>
      ) : null}

      {e.addons?.length ? (
        <View>
          <Section title="Make it special" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
            {e.addons.map((a) => (
              <View key={a.id} style={[styles.addon, shadow.card]}>
                {a.imageUrl ? <Image source={{ uri: a.imageUrl }} style={styles.addonImage} contentFit="cover" accessible={false} />
                  : <View style={[styles.addonImage, styles.addonIcon]}><Icon name="sparkle" size={24} color={colors.accent} /></View>}
                <View style={{ padding: space.md, gap: 2 }}>
                  <Text variant="small" weight="bold" numberOfLines={1}>{a.name}</Text>
                  <Text variant="caption" weight="semibold" color={colors.accent}>{price(a.priceCents, e.currency)}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Text variant="caption" color={colors.muted} style={{ marginTop: space.sm }}>Add these to your order at checkout.</Text>
        </View>
      ) : null}

      <Venue e={e} />
      {e.organizerProfile ? <Organizer e={e} /> : null}
    </View>
  );

  const tickets = e.tiers?.length ? <Tickets e={e} /> : null;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: wide ? space.xxl : 140 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <Cover uri={e.coverUrl} title={e.title} blurred={e.blurredCover} scrim style={{ height: wide ? 420 : tablet ? 380 : 320 }} />
        <View style={styles.sheet}>
          <Container style={wide ? styles.columns : undefined}>
            <View style={wide ? styles.mainCol : undefined}>
              {story}
              {!wide && tickets ? <View style={{ marginTop: space.xl }}>{tickets}</View> : null}
            </View>
            {wide ? (
              <View style={styles.sideCol}>
                <Card style={[styles.buyCard, shadow.raised]}>
                  {cost ? <Text variant="small" color={colors.muted}>{cost.startsWith('From') ? 'Tickets from' : 'Tickets'}</Text> : null}
                  {cost ? <Text variant="display">{cost.replace(/^From /, '')}</Text> : null}
                  {tickets}
                  {action}
                </Card>
              </View>
            ) : null}
          </Container>
        </View>
      </ScrollView>

      <Header transparent right={(
        <>
          <IconButton icon="share" label="Share event" variant="glass" size={20} onPress={share} />
        </>
      )} />

      {!wide ? (
        <BottomBar>
          <View style={styles.barRow}>
            {cost && !blocker && !e.comingSoon ? (
              <View style={{ gap: 0 }}>
                <Text variant="caption" color={colors.muted}>{cost.startsWith('From') ? 'From' : 'Price'}</Text>
                <Text variant="title">{cost.replace(/^From /, '')}</Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }}>{action}</View>
          </View>
        </BottomBar>
      ) : null}

      <NotifySheet visible={notifyOpen} onClose={() => setNotifyOpen(false)} slug={e.slug} title={e.title} />
    </View>
  );
}

/** Why there is no Select Tickets, in a sentence — or null when there is one. */
function whyNot(e: EventDetail): string | null {
  if (e.isPast) return 'This event has ended.';
  if (e.comingSoon) return 'Tickets go on sale soon.';
  if (e.displayOnly) return 'Tickets for this event are sold elsewhere.';
  if (e.availability?.soldOut) return 'Sold out. Save it to hear if tickets come back.';
  if (!e.purchasable) return 'Tickets are not sold in the app for this event.';
  return null;
}

function Facts({ e }: { e: EventDetail }) {
  const span = eventSpanText(e.startsAt, e.endsAt, e.timezone);
  const where = [e.venue, e.venueAddressFull || e.venueAddress || e.city].filter(Boolean) as string[];
  return (
    <Card style={styles.facts}>
      <Fact icon="calendar" title={span.date} body={span.time} />
      {where.length ? (
        <>
          <View style={styles.factRule} />
          <Pressable accessibilityRole="button" accessibilityHint="Opens the venue in Maps" onPress={() => openMaps(e)}>
            <Fact icon="pin" title={where[0]} body={where.slice(1).join(', ') || undefined} action="Map" />
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

function Fact({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}><Icon name={icon} size={20} color={colors.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight="semibold">{title}</Text>
        {body ? <Text variant="small" color={colors.muted}>{body}</Text> : null}
      </View>
      {action ? <View style={styles.factAction}><Text variant="caption" weight="bold" color={colors.accent}>{action}</Text></View> : null}
    </View>
  );
}

/** Days · Hours · Mins · Secs until the doors, or "Happening now". */
function Countdown({ startsAt }: { startsAt: string }) {
  const now = useNow(1000);
  const parts = countdownParts(Date.parse(startsAt) - now);
  if (!parts) {
    return (
      <View style={styles.live}><View style={styles.liveDot} /><Text variant="small" weight="bold" color={colors.accent}>Happening now</Text></View>
    );
  }
  const cells: [number, string][] = [[parts.days, 'Days'], [parts.hours, 'Hours'], [parts.minutes, 'Mins'], [parts.seconds, 'Secs']];
  return (
    <View
      style={styles.countdown}
      accessible
      accessibilityLabel={`Starts in ${parts.days} days, ${parts.hours} hours and ${parts.minutes} minutes`}
    >
      {cells.map(([n, label]) => (
        <View key={label} style={styles.cell}>
          <Text variant="heading" color={colors.white} style={styles.cellNum}>{String(n).padStart(2, '0')}</Text>
          <Text variant="caption" color={colors.onDarkMuted}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function tierNote(t: Tier): { text: string; color: string } | null {
  if (t.soldOut) return { text: 'Sold out', color: colors.danger };
  if (t.notYetOnSale) return { text: 'Not on sale yet', color: colors.muted };
  if (t.salesEnded) return { text: 'Sales ended', color: colors.muted };
  if (t.remaining !== null && t.remaining <= 10) return { text: `Only ${t.remaining} left`, color: colors.warning };
  return null;
}

function Tickets({ e }: { e: EventDetail }) {
  const tiers = e.tiers.filter((t) => !t.hidden);
  if (!tiers.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="title" accessibilityRole="header">Tickets</Text>
      {tiers.map((t) => {
        const note = tierNote(t);
        const off = t.soldOut || t.salesEnded;
        return (
          <View key={t.id} style={[styles.tier, off && styles.tierOff]}>
            <View style={styles.tierStripe} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight="bold">{t.name}</Text>
              {t.description ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{t.description}</Text> : null}
              {note ? <Text variant="caption" weight="semibold" color={note.color}>{note.text}</Text> : null}
            </View>
            <Text variant="label" weight="bold" style={off && { textDecorationLine: 'line-through', color: colors.subtle }}>{price(t.priceCents, e.currency)}</Text>
          </View>
        );
      })}
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

/**
 * "Getting there": the address, the organizer's directions, Maps, and Share
 * (the system sheet covers copying it, sending it to a friend, or a ride app)
 * — no extra native module, so this runs on the development build as it is.
 */
function Venue({ e }: { e: EventDetail }) {
  const address = e.venueAddressFull || e.venueAddress || [e.city, e.country].filter(Boolean).join(', ');
  if (!e.venue && !address) return null;
  const shareAddress = () => { void Share.share({ message: [e.venue, address].filter(Boolean).join(', ') }); };
  return (
    <View>
      <Section title="Getting there" />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={styles.venueArt} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {[0, 1, 2, 3, 4].map((i) => <View key={`h${i}`} style={[styles.street, { top: 18 + i * 30 }]} />)}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <View key={`v${i}`} style={[styles.avenue, { left: 30 + i * 60 }]} />)}
          <View style={styles.pin}><Icon name="pin" size={22} color={colors.white} strokeWidth={2.2} /></View>
        </View>
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ gap: 2 }}>
            {e.venue ? <Text variant="label" weight="bold">{e.venue}</Text> : null}
            {address ? <Text variant="small" color={colors.muted}>{address}</Text> : null}
            {e.venueDirections ? <Text variant="small" color={colors.text} style={{ marginTop: space.xs }}>{e.venueDirections}</Text> : null}
          </View>
          <View style={styles.venueButtons}>
            <Button label="Directions" icon="map" size="sm" onPress={() => openMaps(e)} style={{ flex: 1 }} />
            <Button label="Share address" icon="share" size="sm" variant="secondary" onPress={shareAddress} style={{ flex: 1 }} />
          </View>
        </View>
      </Card>
    </View>
  );
}

function Organizer({ e }: { e: EventDetail }) {
  const o = e.organizerProfile!;
  const initials = o.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View>
      <Section title="Organizer" />
      <Pressable accessibilityRole="button" accessibilityLabel={`${o.name}, organizer. View their events`} onPress={() => router.push({ pathname: '/organizer/[slug]', params: { slug: o.slug } })}
        style={({ pressed }) => [styles.organizer, pressed && { backgroundColor: colors.bgSunken }]}>
        {o.logoUrl ? <Image source={{ uri: o.logoUrl }} style={styles.orgLogo} contentFit="cover" accessible={false} />
          : <View style={[styles.orgLogo, styles.orgInitials]}><Text variant="label" weight="bold" color={colors.onHighlight}>{initials}</Text></View>}
        <View style={{ flex: 1 }}>
          <Text variant="label" weight="bold" numberOfLines={1}>{o.name}</Text>
          <Text variant="caption" color={colors.muted}>See all their events</Text>
        </View>
        {o.contact.website ? <IconButton icon="globe" label="Website" variant="soft" size={18} onPress={() => { void WebBrowser.openBrowserAsync(o.contact.website!); }} /> : null}
        {o.contact.email ? <IconButton icon="mail" label="Email the organizer" variant="soft" size={18} onPress={() => { void Linking.openURL(`mailto:${o.contact.email}`); }} /> : null}
      </Pressable>
    </View>
  );
}

/** "Notify me" on a coming-soon event: one email, once, when sales open. */
function NotifySheet({ visible, onClose, slug, title }: { visible: boolean; onClose: () => void; slug: string; title: string }) {
  const token = useToken();
  const accountEmail = useSession((s) => s.account?.user.email ?? '');
  const [email, setEmail] = useState(accountEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
    <Sheet
      visible={visible}
      onClose={() => { onClose(); setDone(false); }}
      title={done ? 'You are on the list' : 'Notify me'}
      subtitle={title}
      footer={done ? <Button label="Done" onPress={() => { onClose(); setDone(false); }} /> : <Button label="Notify me" icon="bell" busy={busy} onPress={() => { void submit(); }} />}
    >
      {done ? (
        <View style={styles.done}>
          <View style={styles.doneIcon}><Icon name="check" size={28} color={colors.white} strokeWidth={2.6} /></View>
          <Text variant="body" color={colors.muted} align="center">We will email {email.trim()} once, the moment tickets go on sale.</Text>
        </View>
      ) : (
        <>
          <Text variant="body" color={colors.muted}>Tickets are not on sale yet. Leave your email and we will send one message when they are.</Text>
          <Field label="Email" icon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={error} />
        </>
      )}
    </Sheet>
  );
}

function EventSkeleton() {
  return (
    <View style={styles.root}>
      <Skeleton height={320} round={0} />
      <Container style={{ gap: space.md, paddingTop: space.xl }}>
        <Skeleton height={14} width="30%" />
        <Skeleton height={30} width="85%" />
        <Skeleton height={16} width="40%" />
        <Skeleton height={120} round={radius.lg} style={{ marginTop: space.md }} />
        <Skeleton height={80} round={radius.lg} />
      </Container>
      <Header transparent />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sheet: { marginTop: -28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.bg, paddingTop: space.xl },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl },
  mainCol: { flex: 1, minWidth: 0 },
  sideCol: { width: 380 },
  buyCard: { gap: space.md, padding: space.xl, borderRadius: radius.xl },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  by: { flexDirection: 'row', alignSelf: 'flex-start', minHeight: 28, alignItems: 'center' },
  facts: { padding: space.md, gap: space.md },
  factRule: { height: 1, backgroundColor: colors.border, marginLeft: 56 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  factIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center' },
  factAction: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.coral50 },
  countdown: { flexDirection: 'row', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.night },
  cell: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  cellNum: { fontVariant: ['tabular-nums'] },
  live: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.coral50 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral500 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  highlights: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.sun100 },
  mapCard: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  mapPreview: { height: 210, borderRadius: 0 },
  mapNone: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSunken },
  mapFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  addon: { width: 150, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  addonImage: { width: '100%', height: 90 },
  addonIcon: { backgroundColor: colors.coral50, alignItems: 'center', justifyContent: 'center' },
  tier: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  tierOff: { opacity: 0.7 },
  tierStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.coral500 },
  venueArt: { height: 130, backgroundColor: '#eef0e8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  street: { position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: '#ffffff' },
  avenue: { position: 'absolute', top: 0, bottom: 0, width: 8, backgroundColor: '#ffffff' },
  pin: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.white, ...shadow.raised },
  venueButtons: { flexDirection: 'row', gap: space.sm },
  organizer: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  orgLogo: { width: 52, height: 52, borderRadius: 26 },
  orgInitials: { backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  blocker: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 54, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.bgSunken },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  done: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.successStrong, alignItems: 'center', justifyContent: 'center' },
});
