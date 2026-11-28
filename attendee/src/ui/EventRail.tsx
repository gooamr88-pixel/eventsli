import { FlatList, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { EventCard } from '../api/types';
import { Section } from './bits';
import { EventPoster } from './EventCard';
import { Container, useLayout } from './layout';
import { Skeleton } from './motion';
import { Text } from './Text';
import { colors, space } from './theme';

const W = 200;

/**
 * A titled row of event posters to swipe — Home's "This Weekend", "Free
 * Events", an event's "Similar Events". Shows the shape of what is coming
 * while it loads, and nothing at all when there is nothing to show (an empty
 * shelf with a title is worse than no shelf).
 */
export function EventRail({ title, events, loading = false, action, onAction, isSaved, flip, width = W, distanceOf, header }: {
  title: string;
  events: EventCard[] | undefined;
  loading?: boolean;
  action?: string;
  onAction?: () => void;
  isSaved: (id: string) => boolean;
  flip: (id: string) => void;
  width?: number;
  /** "2.3 km away" per event (Near You). */
  distanceOf?: (e: EventCard) => string | undefined;
  /** A line under the title: "Around Nasr City, Cairo". */
  header?: string;
}) {
  const { gutter } = useLayout();
  if (!loading && !events?.length) return null;
  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ marginTop: space.xl }}>
      <Container>
        <Section title={title} action={action} onAction={onAction} style={header ? { marginBottom: 2 } : undefined} />
        {header ? <Text variant="small" color={colors.muted} style={{ marginBottom: space.md }}>{header}</Text> : null}
      </Container>
      {loading && !events?.length ? (
        <View style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: gutter }}>
          {[0, 1].map((i) => (
            <View key={i} style={{ width, gap: 8 }}>
              <Skeleton height={Math.round(width * 1.25)} round={14} />
              <Skeleton height={14} width="80%" />
              <Skeleton height={12} width="55%" />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={events}
          keyExtractor={(e) => e.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}
          snapToInterval={width + space.md}
          decelerationRate="fast"
          renderItem={({ item }) => <EventPoster event={item} saved={isSaved(item.id)} onHeart={() => flip(item.id)} width={width} distance={distanceOf?.(item)} />}
        />
      )}
    </Animated.View>
  );
}
