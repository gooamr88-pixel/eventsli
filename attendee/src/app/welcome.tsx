import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { trending } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Text } from '@/ui/Text';
import { colors, fonts, space } from '@/ui/theme';

/**
 * The mockup's second frame: a night-time crowd under stage light across the
 * top, fading into black; "Your City. Your Experiences.", Get Started and
 * Sign In beneath.
 *
 * The photo is a REAL Eventsli event — the first Trending cover — never a
 * stock crowd, which would be somebody else's event (2026-11-28). With no
 * signal yet, or no cover, the drawn stage light stands in, in the brand's
 * coral and sunshine on near-black.
 *
 * Get Started marks the welcome as seen and the guard sends the phone Home.
 * Sign In leaves it unseen: signing in marks it, and both guards drop together.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const hot = useQuery({ queryKey: ['trending'], queryFn: trending });
  const photo = hot.data?.events.find((e) => e.coverUrl && !e.blurredCover && !e.isPrivate)?.coverUrl ?? null;
  const photoH = Math.round(height * 0.62);
  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.night, '#2a0c1c', '#5c1020']} style={StyleSheet.absoluteFill} />
      {photo ? (
        <View style={[styles.photo, { height: photoH }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Cover uri={photo} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0 }} size={600} />
          <LinearGradient colors={['rgba(17,16,24,0)', 'rgba(17,16,24,0.55)', colors.night]} locations={[0.45, 0.75, 1]} style={StyleSheet.absoluteFill} />
        </View>
      ) : (
        <StageLight />
      )}
      {photo ? <View style={[styles.fill, { top: photoH }]} /> : null}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <Text style={styles.headline} color={colors.white} accessibilityRole="header">
          Your City.{'\n'}Your Experiences.
        </Text>
        <Text variant="body" color={colors.white} style={{ fontSize: 17, lineHeight: 25 }}>
          Discover amazing events,{'\n'}concerts, and more.
        </Text>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <View style={[styles.dot, { backgroundColor: colors.white }]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
        <Button label="Get Started" variant="highlight" onPress={() => { void useSession.getState().finishOnboarding(); }} />
        <Button label="Sign In" variant="onDark" onPress={() => router.push('/sign-in')} />
      </View>
    </View>
  );
}

/** Beams from above and a crowd's raised hands in silhouette. Decorative. */
function StageLight() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <Path d="M120 0 L40 520 L200 520 Z" fill={colors.coral500} opacity={0.18} />
        <Path d="M280 0 L200 520 L360 520 Z" fill={colors.highlight} opacity={0.14} />
        <Path d="M200 0 L120 520 L280 520 Z" fill={colors.white} opacity={0.06} />
        <Circle cx={120} cy={0} r={40} fill={colors.coral500} opacity={0.5} />
        <Circle cx={280} cy={0} r={40} fill={colors.highlight} opacity={0.45} />
        <Path
          d="M0 560 Q20 500 34 470 L40 440 L46 470 Q60 520 80 540 Q96 470 104 430 L110 400 L118 432 Q126 500 150 530 Q170 480 178 455 L184 430 L190 456 Q204 520 226 540 Q244 470 252 440 L258 410 L265 442 Q276 510 300 530 Q318 480 326 452 L332 425 L338 455 Q352 520 372 540 Q386 500 392 480 L400 470 L400 800 L0 800 Z"
          fill="#07060b"
          opacity={0.92}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.night },
  bottom: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.xl, gap: space.lg },
  headline: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, fontStyle: 'italic' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: space.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
});
