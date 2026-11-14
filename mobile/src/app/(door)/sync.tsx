import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSession } from '@/auth/session';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useDoorExit } from '@/gate/useDoor';
import { count } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Header, Screen, StatusIcon } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/** A few at a time, so the bar moves; the background sync sends 100. */
const STEP = 5;

/**
 * Syncing Data… — the mockup's progress screen. Sends this phone's saved
 * check-ins a few at a time and shows how far it has got. Cancel stops after
 * the batch in flight; whatever is left still syncs in the background every
 * 15 seconds. Every scan keeps its id, so sending one twice is a no-op.
 */
export default function Sync() {
  const door = useSession((s) => s.door);
  const exit = useDoorExit();
  const records = useScanLog((s) => s.records);
  const pending = pendingCount(records);
  const [total] = useState(() => Math.max(pendingCount(useScanLog.getState().records), 0));
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!door) return undefined;
    cancelled.current = false;
    let alive = true;
    (async () => {
      let stalls = 0;
      while (alive && !cancelled.current && pendingCount(useScanLog.getState().records) > 0) {
        try {
          const res = await useScanLog.getState().sync(door.token, { limit: STEP });
          if (res === null) {
            // Another upload is running (the background one), or this one failed.
            stalls += 1;
            if (stalls > 20) { setFailed(true); return; }
            await new Promise((r) => setTimeout(r, 400));
          } else {
            stalls = 0;
          }
        } catch (err) {
          exit(err);
          return;
        }
      }
      if (alive && !cancelled.current) setTimeout(() => { if (router.canGoBack()) router.back(); }, 900);
    })();
    return () => { alive = false; };
  }, [door, exit]);

  const done = Math.max(0, total - pending);
  const share = total > 0 ? done / total : 1;
  const finished = pending === 0;

  return (
    <Screen
      waves="both"
      footer={finished ? (
        <Button label="Done" onPress={() => router.back()} />
      ) : (
        <Button label="Cancel" variant="secondary" onPress={() => { cancelled.current = true; router.back(); }} />
      )}
    >
      <Header onBack={() => { cancelled.current = true; router.back(); }} />
      <View style={styles.hero}>
        <StatusIcon kind="info" icon="cloudUpload" />
        <Text variant="heading" align="center">{finished ? 'All Synced' : failed ? 'Sync Paused' : 'Syncing Data…'}</Text>
        <Text color={colors.muted} align="center">
          {finished
            ? 'Every check-in on this phone is on Eventsli.'
            : failed
              ? 'The connection dropped. Check-ins stay on this phone and sync automatically.'
              : `Uploading ${count(total)} check-in${total === 1 ? '' : 's'}\nto Eventsli.`}
        </Text>
      </View>
      <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
        </View>
        <Text variant="body" weight="medium" color={colors.muted} align="center">
          {count(done)} of {count(total)} ({Math.round(share * 100)}%)
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.lg },
  progress: { gap: space.lg, marginTop: space.xl, paddingHorizontal: space.sm },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
});
