import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ApiError, messageFor } from '@/api/client';
import { organizerPage } from '@/api/endpoints';
import { useSaved } from '@/hooks/useSaved';
import { Chip, Empty, Failed, Header, IconButton, Segmented } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { EventPoster, EventRow } from '@/ui/EventCard';
import { Container, Grid, useLayout } from '@/ui/layout';
import { RowSkeleton, Skeleton } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { colors, radius, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';

/**
 * An organizer's page (GET /public/organizers/:slug, 2026-11-18): who they
 * are, how to reach them, and everything they have on — reached from "by …"
 * and the Organizer card on an event. Only what the organizer chose to
 * publish is shown; never their account email.
 */
export default function OrganizerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isSaved, flip } = useSaved();
  const { tablet } = useLayout();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const q = useQuery({ queryKey: ['organizer', slug], queryFn: () => organizerPage(slug), enabled: Boolean(slug) });

  if (q.isLoading) {
    return (
      <View style={styles.root}>
        <Header title="Organizer" />
        <Container style={{ gap: space.md, paddingTop: space.lg }}>
          <Skeleton height={220} round={radius.xl} />
          <RowSkeleton /><RowSkeleton />
        </Container>
      </View>
    );
  }
  if (q.isError || !q.data) {
    const missing = q.error instanceof ApiError && q.error.code === 'NOT_FOUND';
    return (
      <View style={styles.root}>
        <Header title="Organizer" />
        {missing ? <Empty icon="users" title="Page not found" body="This organizer has no public page." />
          : <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />}
      </View>
    );
  }

  const { organizer: o, stats, upcoming, past } = q.data;
  const initials = o.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const since = o.memberSince ? new Date(o.memberSince).getFullYear() : null;
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <View style={styles.root}>
      <Header
        title={o.name}
        right={<IconButton icon="share" label="Share organizer" variant="soft" size={20} onPress={() => { void Share.share({ message: `${o.name} on Eventsli — ${SITE}/o/${o.slug}` }); }} />}
      />
      <ScrollView contentContainerStyle={{ paddingVertical: space.lg }}>
        <Container style={{ gap: space.xl }}>
          <Animated.View entering={FadeInDown.duration(260)} style={[styles.card, shadow.card]}>
            <View style={styles.banner} />
            {o.logoUrl ? <Image source={{ uri: o.logoUrl }} style={styles.logo} contentFit="cover" accessible={false} />
              : <View style={[styles.logo, styles.initials]}><Text variant="display" color={colors.onHighlight}>{initials}</Text></View>}
            <View style={styles.cardBody}>
              <Text variant="heading" align="center" accessibilityRole="header">{o.name}</Text>
              <Text variant="small" color={colors.muted} align="center">
                {[o.country, since ? `On Eventsli since ${since}` : null].filter(Boolean).join(' · ')}
              </Text>
              {o.description ? <Text variant="body" color={colors.text} align="center" style={{ marginTop: space.sm }}>{o.description}</Text> : null}

              <View style={styles.stats}>
                <View style={styles.stat}><Text variant="heading">{stats.upcoming}</Text><Text variant="caption" color={colors.muted}>Upcoming</Text></View>
                <View style={styles.statRule} />
                <View style={styles.stat}><Text variant="heading">{stats.past}</Text><Text variant="caption" color={colors.muted}>Past events</Text></View>
              </View>

              <View style={styles.contact}>
                {o.contact.website ? <Button label="Website" icon="globe" size="sm" variant="secondary" onPress={() => { void WebBrowser.openBrowserAsync(o.contact.website!); }} style={{ flex: 1 }} /> : null}
                {o.contact.email ? <Button label="Email" icon="mail" size="sm" variant="secondary" onPress={() => { void Linking.openURL(`mailto:${o.contact.email}`); }} style={{ flex: 1 }} /> : null}
                {o.contact.phone ? <Button label="Call" icon="chat" size="sm" variant="secondary" onPress={() => { void Linking.openURL(`tel:${o.contact.phone}`); }} style={{ flex: 1 }} /> : null}
              </View>
              {o.social.length ? (
                <View style={styles.social}>
                  {o.social.map((s) => <Chip key={s.key} label={s.label} icon="link" active={false} onPress={() => { void WebBrowser.openBrowserAsync(s.url); }} />)}
                </View>
              ) : null}
            </View>
          </Animated.View>

          <View style={{ gap: space.md }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[{ value: 'upcoming', label: `Upcoming (${stats.upcoming})` }, { value: 'past', label: `Past (${stats.past})` }]}
            />
            {shown.length === 0 ? (
              <Empty icon="calendar" title={tab === 'upcoming' ? 'Nothing on right now' : 'No past events yet'} body={tab === 'upcoming' ? 'Check back soon for their next event.' : undefined} />
            ) : tablet ? (
              <Grid min={240} gap={space.lg}>
                {shown.map((e) => <EventPoster key={e.id} event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />)}
              </Grid>
            ) : shown.map((e) => <EventRow key={e.id} event={e} saved={isSaved(e.id)} onHeart={() => flip(e.id)} />)}
          </View>
        </Container>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  card: { borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', alignItems: 'center' },
  banner: { alignSelf: 'stretch', height: 84, backgroundColor: colors.night },
  logo: { width: 96, height: 96, borderRadius: 48, marginTop: -48, borderWidth: 4, borderColor: colors.surface },
  initials: { backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  cardBody: { alignSelf: 'stretch', padding: space.xl, paddingTop: space.md, gap: space.xs },
  stats: { flexDirection: 'row', marginTop: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statRule: { width: 1, backgroundColor: colors.border },
  contact: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  social: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', marginTop: space.md },
});
