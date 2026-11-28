import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, G, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { messageFor } from '@/api/client';
import { categories, notifications, trending } from '@/api/endpoints';
import type { EventCard } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { upcomingQuery } from '@/hooks/useCategoryCovers';
import { useNearMe } from '@/hooks/useNearMe';
import { useSaved } from '@/hooks/useSaved';
import { eventDate } from '@/lib/format';
import { categoriesWithEvents } from '@/lib/home';
import { imageUrl } from '@/lib/images';
import { distanceText } from '@/lib/location';
import { registerForPush } from '@/lib/push';
import { asCard, useRecent } from '@/lib/recent';
import { Empty, Failed } from '@/ui/bits';
import { categoryLook } from '@/ui/categoryLook';
import { openEvent } from '@/ui/EventCard';
import { EventRail } from '@/ui/EventRail';
import { Icon } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { MARK_FRAME, MARK_INITIAL } from '@/ui/brandPaths';
import { Logo, Mark } from '@/ui/Logo';
import { Pressy, Skeleton } from '@/ui/motion';
import { SiteCard } from '@/ui/SiteCard';
import { Text } from '@/ui/Text';
import { colors, fonts, space } from '@/ui/theme';

/** "Good afternoon" by the phone's clock. */
function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return 'Good evening';
  if (hour < 12) return 'Good morning';
  return 'Good afternoon';
}

const NAVY = '#141a3c';
const NAVY_DEEP = '#0d1230';

/**
 * Home — THE OWNER'S OWN DESIGN (2026-11-28, a screenshot sent after "looks
 * like a website"). An app's home, not a web page:
 *
 *   the logo and the round bell, over a soft yellow "E" and a city skyline
 *   "Good afternoon," and the person's name, with a wave
 *   a round search pill and a round filter button
 *   the navy hero slider: the words on the left (a kicker, the name in big
 *     capitals, the date, the venue, a yellow Get Tickets), the artwork on
 *     the right, "1 / 3" in the corner, yellow dots under it
 *   "Explore Categories" behind a yellow bar: pastel tiles, an icon each
 *   the pink "near you" card with its City button
 *   "Never Miss an Event!" — turning on notifications
 *
 * Under that, the events themselves (the site's cards, two across) and what
 * was looked at recently.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const token = useToken();
  const user = useSession((s) => s.account?.user);
  const city = useSession((s) => s.city);
  const { isSaved, flip } = useSaved();
  const { inner, gutter, tablet } = useLayout();
  const recent = useRecent((s) => s.items);
  useEffect(() => { void useRecent.getState().load(); }, []);
  const nearMe = useNearMe();

  const where = city?.city;
  const hot = useQuery({ queryKey: ['trending'], queryFn: trending });
  const cats = useQuery({ queryKey: ['categories'], queryFn: categories, staleTime: 3_600_000 });
  const upcoming = useQuery(upcomingQuery(where, token));
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notifications(token as string, 1).then((r) => Number(r.meta?.unread ?? 0)),
    enabled: Boolean(token),
    staleTime: 30_000,
  });

  const all = useMemo(() => (upcoming.data ?? []).filter((e) => !e.isPast), [upcoming.data]);
  const vip = (hot.data?.events ?? []).filter((e) => !e.isPast).slice(0, 5);
  const shownCats = categoriesWithEvents(cats.data ?? [], all);
  const popular = all.slice(0, 8);
  const cols = tablet ? 3 : 2;
  const cardW = Math.floor((inner - space.md * (cols - 1)) / cols);
  const tileW = Math.floor((inner - space.md * 3) / 4);
  const name = user?.fullName?.trim() || user?.email?.split('@')[0] || '';

  const refresh = () => { void hot.refetch(); void upcoming.refetch(); void cats.refetch(); };
  const toExplore = (params?: Record<string, string>) => router.push({ pathname: '/(tabs)/explore', params });

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space.xxl * 2 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl tintColor={colors.accent} refreshing={hot.isRefetching || upcoming.isRefetching} onRefresh={refresh} />}
      >
        {/* The soft yellow "E" and skyline behind the top. */}
        <TopArt top={insets.top} />

        <Container style={styles.top}>
          <View style={styles.topRow}>
            <Logo height={34} />
            <Pressable accessibilityRole="button" accessibilityLabel={unread.data ? `Notifications, ${unread.data} unread` : 'Notifications'}
              onPress={() => router.push(token ? '/notifications' : '/sign-in')} style={styles.bell} hitSlop={6}>
              <Icon name="bell" size={24} color={colors.text} strokeWidth={1.9} />
              {unread.data || !token ? <View style={styles.bellDot} /> : null}
            </Pressable>
          </View>

          <Animated.View entering={FadeInDown.duration(320)} style={styles.hello}>
            <Text style={styles.helloLine}>{greeting(new Date().getHours())},</Text>
            <Text style={styles.helloName} numberOfLines={1}>{name || 'welcome'} 👋</Text>
          </Animated.View>

          <View style={styles.searchRow}>
            <Pressable accessibilityRole="search" accessibilityLabel="Search events" onPress={() => toExplore({ focus: String(Date.now()) })} style={styles.search}>
              <Icon name="search" size={22} color={colors.text} strokeWidth={1.9} />
              <Text variant="body" color={colors.placeholder} style={{ fontSize: 16 }}>Search events...</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Filters" onPress={() => toExplore()} style={styles.filter}>
              <Icon name="sliders" size={22} color={colors.text} strokeWidth={1.9} />
            </Pressable>
          </View>
        </Container>

        {/* ── The hero slider ── */}
        {hot.isLoading ? (
          <Container style={{ marginTop: space.xl }}><Skeleton height={Math.round(inner * 0.56)} round={26} /></Container>
        ) : vip.length ? (
          <Hero events={vip} width={inner} gutter={gutter} />
        ) : null}

        {/* ── Explore Categories ── */}
        {shownCats.length ? (
          <View style={{ marginTop: space.xl }}>
            <Container><Heading title="Explore Categories" action="See all" onAction={() => toExplore()} /></Container>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.cats, { paddingHorizontal: gutter }]}>
              {shownCats.map((c, i) => {
                const look = categoryLook(c.slug, i);
                return (
                  <Pressy key={c.slug} accessibilityRole="button" accessibilityLabel={c.label} onPress={() => toExplore({ category: c.slug })} scale={0.94} style={{ width: tileW, gap: 8 }}>
                    <View style={[styles.catBox, { height: Math.round(tileW * 0.8), backgroundColor: look.bg }]}>
                      <Icon name={look.icon} size={34} color={look.ink} strokeWidth={2} />
                    </View>
                    <Text variant="small" weight="semibold" align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 14 }}>{c.label}</Text>
                  </Pressy>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* ── Near you ── */}
        <NearYou nearMe={nearMe} isSaved={isSaved} flip={flip} />

        {/* ── Never Miss an Event ── */}
        <Container style={{ marginTop: space.lg }}>
          <Pressy accessibilityRole="button" accessibilityLabel="Never miss an event. Turn on notifications." scale={0.98} style={styles.promo}
            onPress={() => {
              if (!token) { router.push('/sign-in'); return; }
              void registerForPush(token).then((t) => { if (!t) void Linking.openSettings(); });
            }}>
            <View style={styles.promoArt}>
              <View style={{ transform: [{ rotate: '-14deg' }] }}><Mark size={46} /></View>
              <View style={styles.spark}><Icon name="sparkle" size={16} color={colors.highlight} strokeWidth={2.4} /></View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.promoTitle}>Never Miss an Event!</Text>
              <Text variant="small" color={colors.muted}>Get the latest events and offers</Text>
            </View>
            <View style={styles.promoGo}><Icon name="chevronRight" size={20} color={colors.onHighlight} strokeWidth={2.6} /></View>
          </Pressy>
        </Container>

        {/* ── The events ── */}
        <Container style={{ marginTop: space.xxl }}>
          <Heading title={where ? `Popular in ${where}` : 'Popular Events'} action="See all" onAction={() => toExplore()} />
          {upcoming.isError ? (
            <Failed message={messageFor(upcoming.error)} onRetry={() => { void upcoming.refetch(); }} />
          ) : upcoming.isLoading ? (
            <View style={styles.grid}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} width={cardW} height={cardW + 120} round={18} />)}</View>
          ) : popular.length ? (
            <View style={styles.grid}>
              {popular.map((e) => <SiteCard key={e.id} event={e} width={cardW} saved={isSaved(e.id)} onHeart={() => flip(e.id)} onPress={() => openEvent(e)} />)}
            </View>
          ) : (
            <Empty icon="calendar" title={where ? `Nothing on in ${where} yet` : 'Nothing on yet'} body="Try another city." action="Change city" onAction={() => router.push('/city')} />
          )}
        </Container>

        <EventRail title="Recently Viewed" events={recent.length >= 2 ? recent.map(asCard) : []} isSaved={isSaved} flip={flip} width={190}
          action="Clear" onAction={() => useRecent.getState().clear()} />
      </ScrollView>
    </View>
  );
}

/** "▌Explore Categories           See all →" — a yellow bar, the heading, a plain link. */
function Heading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingBar} />
      <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>{title}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10} style={styles.headingAction}>
          <Text variant="label" weight="semibold">{action}</Text>
          <Icon name="arrow" size={18} strokeWidth={2.1} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The navy slider: the words left, the artwork right, "1 / 3", yellow dots. */
function Hero({ events, width, gutter }: { events: EventCard[]; width: number; gutter: number }) {
  const [page, setPage] = useState(0);
  const step = width + gutter;
  return (
    <View style={{ marginTop: space.xl }}>
      <FlatList
        horizontal
        data={events}
        keyExtractor={(e) => e.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: gutter, gap: gutter }}
        onMomentumScrollEnd={(ev) => setPage(Math.min(events.length - 1, Math.max(0, Math.round(ev.nativeEvent.contentOffset.x / step))))}
        renderItem={({ item, index }) => <HeroCard event={item} width={width} index={index} count={events.length} />}
      />
      {events.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {events.map((e, i) => <View key={e.id} style={[styles.dotOff, i === page && styles.dotOn]} />)}
        </View>
      ) : null}
    </View>
  );
}

function HeroCard({ event: e, width, index, count }: { event: EventCard; width: number; index: number; count: number }) {
  const height = Math.round(width * 0.56);
  const art = imageUrl(e.coverUrl, Math.round(width * 0.6));
  const kicker = (e.categoryLabel || e.organizer?.name || '').toUpperCase();
  const buy = !e.displayOnly && e.fromPriceCents !== null && e.fromPriceCents !== undefined;
  return (
    <Pressy accessibilityRole="button" accessibilityLabel={`${e.title}, ${eventDate(e.startsAt, e.timezone)}`} onPress={() => openEvent(e)} scale={0.98}
      style={[styles.hero, { width, height }]}>
      <LinearGradient colors={[NAVY, NAVY_DEEP]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {art && !e.blurredCover ? (
        <View style={styles.heroArt}>
          <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top center" transition={200} />
          <LinearGradient colors={[NAVY, 'rgba(20,26,60,0.55)', 'rgba(20,26,60,0)']} locations={[0, 0.35, 0.7]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
      {/* The brand's yellow sweep across the artwork, as drawn. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={`M${width * 0.74} ${height + 6} C ${width * 0.9} ${height * 0.78}, ${width * 0.97} ${height * 0.58}, ${width + 6} ${height * 0.42}`} stroke={colors.highlight} strokeWidth={9} strokeLinecap="round" fill="none" />
      </Svg>
      <Text style={styles.heroCount}>{index + 1} / {count}</Text>
      <View style={styles.heroText}>
        {kicker ? <Text style={styles.heroKicker} numberOfLines={1}>{kicker}</Text> : null}
        <Text style={styles.heroTitle} numberOfLines={2}>{e.title.toUpperCase()}</Text>
        <View style={styles.heroLine}>
          <Icon name="calendar" size={16} color={colors.white} strokeWidth={2} />
          <Text style={styles.heroMeta} numberOfLines={1}>{eventDate(e.startsAt, e.timezone)}</Text>
        </View>
        {e.venue || e.city ? (
          <View style={styles.heroLine}>
            <Icon name="pin" size={16} color={colors.white} strokeWidth={2} />
            <Text style={styles.heroMeta} numberOfLines={1}>{e.venue || e.city}</Text>
          </View>
        ) : null}
        <View style={styles.heroCta}>
          <Text style={styles.heroCtaText}>{buy ? 'Get Tickets' : 'View Event'}</Text>
          <Icon name="arrow" size={16} color={colors.onHighlight} strokeWidth={2.4} />
        </View>
      </View>
    </Pressy>
  );
}

/**
 * The pink "near you" card: asking, refused, or nothing in range — with the
 * City button. Once location is on and there are events, a row of them.
 */
function NearYou({ nearMe, isSaved, flip }: { nearMe: ReturnType<typeof useNearMe>; isSaved: (id: string) => boolean; flip: (id: string) => void }) {
  const { status, busy, enable, near } = nearMe;
  if (status === 'checking') return null;
  const answer = near.data;
  if (status === 'granted' && answer?.events.length) {
    return <EventRail title="Near You" header={answer.nearest ? `Around ${answer.nearest.city}` : undefined} events={answer.events} isSaved={isSaved} flip={flip} width={190} distanceOf={(e) => distanceText(e.distanceKm)} />;
  }
  const [title, body, action, onPress, icon] = status === 'ask'
    ? ['Events near you', 'See what is on around you.', busy ? 'Finding…' : 'Turn on', () => { void enable(); }, 'locate' as const]
    : status === 'denied'
      ? ['Location is off', 'Turn it on in Settings, or pick a city.', 'City', () => router.push('/city'), 'pin' as const]
      : ['Nothing near you yet', `No events within ${answer?.radiusKm ?? 100} km right now.`, 'City', () => router.push('/city'), 'pin' as const];
  return (
    <Container style={{ marginTop: space.xl }}>
      <View style={styles.near}>
        <Skyline color={colors.coral200} style={styles.nearSkyline} />
        <View style={styles.nearIcon}><Icon name="locate" size={24} color={colors.accent} strokeWidth={2.2} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold">{title}</Text>
          <Text variant="small" color={colors.muted}>{body}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={styles.nearBtn}>
          <Icon name={icon} size={17} color={colors.accent} fill={icon === 'pin' ? colors.accent : undefined} strokeWidth={1.8} />
          <Text variant="label" weight="semibold">{action}</Text>
        </Pressable>
      </View>
    </Container>
  );
}

/**
 * The top-right decoration of the owner's design: a warm yellow glow, the
 * logo's "E" big and soft in it, and a gold skyline along its foot — all one
 * drawing that fades into the white page ABOVE the search bar. (The first
 * try was a pale block with hard edges running behind the search, 2026-11-28:
 * "very terrible".)
 */
function TopArt({ top }: { top: number }) {
  const { width } = useLayout();
  const H = top + 200;
  const W = width;
  // The logo mark, 190 tall, its right side running off the screen.
  const markH = 190;
  const scale = markH / 141;
  const mx = W - 119 * scale * 0.78;
  const my = top - 6;
  return (
    <View style={[styles.topArt, { height: H }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={W} height={H}>
        <Defs>
          <RadialGradient id="glow" cx={W * 0.86} cy={top + 40} rx={W * 0.62} ry={170} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.sun200} stopOpacity="0.95" />
            <Stop offset="0.55" stopColor={colors.sun100} stopOpacity="0.6" />
            <Stop offset="1" stopColor={colors.white} stopOpacity="0" />
          </RadialGradient>
          <SvgGradient id="eFrame" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.sun300} stopOpacity="0.6" />
            <Stop offset="1" stopColor={colors.sun200} stopOpacity="0.15" />
          </SvgGradient>
          <SvgGradient id="eLetter" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.sun400} stopOpacity="0.55" />
            <Stop offset="1" stopColor={colors.sun300} stopOpacity="0.15" />
          </SvgGradient>
          <SvgGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.white} stopOpacity="0" />
            <Stop offset="1" stopColor={colors.white} stopOpacity="1" />
          </SvgGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#glow)" />
        <G transform={`translate(${mx} ${my}) scale(${scale}) translate(0 121)`}>
          <Path d={MARK_FRAME} fill="url(#eFrame)" />
          <Path d={MARK_INITIAL} fill="url(#eLetter)" />
        </G>
        <G transform={`translate(${W * 0.6} ${top + 104}) scale(${(W * 0.4) / 200})`}>
          <Path d={SKYLINE} fill={colors.sun300} opacity={0.32} />
        </G>
        {/* Melt everything into the page before the search bar. */}
        <Rect x={0} y={H - 70} width={W} height={70} fill="url(#fade)" />
      </Svg>
    </View>
  );
}

const SKYLINE = 'M0 60V44h8v-6h6v6h6V30h10v14h6V36h8v-8h4v8h6v24ZM58 60V22h4V12h2v10h4v38ZM72 60V34h10v-6h8v6h6v26ZM100 60V40h6V26h10v14h6V18h2l4-12 4 12h2v42ZM136 60V30h12v-8h6v8h8v30ZM166 60V38h6V14h2l3-10 3 10h2v24h6v6h12v16Z';

function Skyline({ color, style }: { color: string; style?: object }) {
  return (
    <Svg viewBox="0 0 200 60" preserveAspectRatio="xMaxYMax meet" style={style}>
      <Path
        fill={color}
        d="M0 60V44h8v-6h6v6h6V30h10v14h6V36h8v-8h4v8h6v24ZM58 60V22h4V12h2v10h4v38ZM72 60V34h10v-6h8v6h6v26ZM100 60V40h6V26h10v14h6V18h2l4-12 4 12h2v42ZM136 60V30h12v-8h6v8h8v30ZM166 60V38h6V14h2l3-10 3 10h2v24h6v6h12v16Z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topArt: { position: 'absolute', top: 0, left: 0, right: 0 },

  top: { paddingTop: space.md, gap: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bell: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#111018', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  bellDot: { position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.coral500, borderWidth: 1.5, borderColor: colors.white },
  hello: { marginTop: space.sm },
  helloLine: { fontFamily: fonts.regular, fontSize: 24, lineHeight: 30, color: colors.text },
  helloName: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.text, letterSpacing: -0.3 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, paddingHorizontal: space.lg, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f7f7fa' },
  filter: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f7f7fa', borderWidth: 1, borderColor: colors.border },

  hero: { borderRadius: 26, overflow: 'hidden', backgroundColor: NAVY },
  heroArt: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '58%' },
  heroCount: { position: 'absolute', top: 16, right: 18, fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  heroText: { flex: 1, width: '62%', justifyContent: 'center', paddingLeft: 20, paddingVertical: 16, gap: 5 },
  heroKicker: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.6, color: 'rgba(255,255,255,0.85)' },
  heroTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 26, color: colors.white, letterSpacing: -0.2, marginBottom: 4 },
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroMeta: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.white },
  heroCta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 8, paddingHorizontal: 16, minHeight: 38, borderRadius: 999, backgroundColor: colors.highlight },
  heroCtaText: { fontFamily: fonts.bold, fontSize: 14, color: colors.onHighlight },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: space.md },
  dotOff: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#e2e2e8' },
  dotOn: { width: 24, backgroundColor: colors.highlight },

  heading: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  headingBar: { width: 5, height: 26, borderRadius: 3, backgroundColor: colors.highlight },
  headingAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  cats: { gap: space.md },
  catBox: { borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  near: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.coral50 },
  nearSkyline: { position: 'absolute', right: 0, bottom: 0, width: 170, height: 46, opacity: 0.55 },
  nearIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  nearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 40, borderRadius: 14, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.white },

  promo: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingLeft: space.sm, paddingRight: space.lg, borderRadius: 26, backgroundColor: colors.white, shadowColor: '#111018', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  promoArt: { width: 76, height: 60, alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', right: 4, top: 0 },
  promoTitle: { fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: colors.text },
  promoGo: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
