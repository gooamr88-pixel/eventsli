import { useNetInfo } from '@react-native-community/netinfo';
import { router, useIsFocused } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { CodeCamera } from '@/gate/CodeCamera';
import { signal } from '@/gate/feedback';
import { describeScan } from '@/gate/outcomes';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useDoorExit, useMe } from '@/gate/useDoor';
import { Icon } from '@/ui/Icon';
import { Header, IconButton } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * Scan Ticket — the mockup's camera screen. One code at a time: read, decide,
 * show the answer full-screen, come back. The screen stays awake, the torch is
 * one tap away, and a phone with no signal keeps scanning — those scans are
 * held and uploaded, never shown as admissions.
 */
export default function Scan() {
  useKeepAwake();
  const focused = useIsFocused();
  const door = useSession((s) => s.door);
  const me = useMe();
  const exit = useDoorExit();
  const net = useNetInfo();
  const records = useScanLog((s) => s.records);
  const [torch, setTorch] = useState(false);
  const busy = useRef(false);
  const held = pendingCount(records);
  const offline = net.isConnected === false;

  async function onCode(data: string) {
    if (!door || busy.current) return;
    busy.current = true;
    try {
      const rec = await useScanLog.getState().submit(data, door.token);
      if (!rec) return;
      const shown = rec.state === 'done' ? (rec.result as string) : 'queued';
      signal(describeScan(shown).tone);
      router.push({ pathname: '/result', params: { id: rec.clientScanId } });
    } catch (err) {
      if (!(await exit(err))) Alert.alert('Could not check that code', 'Scan it again.');
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={styles.screen}>
      {/* Mounted only while this screen is in front: one camera at a time. */}
      {focused ? <CodeCamera onCode={onCode} torch={torch} /> : <View style={styles.screen} />}

      <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
        <View style={styles.pad}>
          <Header
            title="Scan Ticket"
            inverse
            right={(
              <IconButton
                icon="bolt"
                label={torch ? 'Turn the light off' : 'Turn the light on'}
                onPress={() => setTorch((t) => !t)}
                color={torch ? colors.night : colors.white}
                background={torch ? colors.white : 'rgba(255,255,255,0.18)'}
              />
            )}
          />
        </View>
        <View style={styles.badges}>
          {offline && (
            <View style={[styles.badge, { backgroundColor: 'rgba(86,106,109,0.9)' }]}>
              <Icon name="offline" size={16} color={colors.white} />
              <Text variant="small" color={colors.white}>No signal — scans are held</Text>
            </View>
          )}
          {held > 0 && (
            <View style={styles.badge}>
              <Text variant="small" color={colors.white}>{held} waiting to upload</Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.hint}>
          <Icon name="qr" size={20} color={colors.white} />
          <Text color={colors.white}>Align the QR code within the frame</Text>
        </View>
        {me.data?.permissions.manualCheckIn && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/attendees')}
            style={styles.manual}
          >
            <Icon name="search" size={18} color={colors.white} />
            <Text variant="small" weight="semibold" color={colors.white}>Find a guest by name</Text>
          </Pressable>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.camera },
  top: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  pad: { paddingHorizontal: space.lg },
  badges: { alignItems: 'center', gap: space.xs, paddingBottom: space.sm },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: 'rgba(13,91,94,0.9)',
  },
  bottom: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, gap: space.sm },
  hint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.overlay,
  },
  manual: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    paddingVertical: space.sm,
  },
});
