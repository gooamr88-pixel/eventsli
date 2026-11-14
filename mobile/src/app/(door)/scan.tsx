import { useNetInfo } from '@react-native-community/netinfo';
import { router, useIsFocused } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { CodeCamera } from '@/gate/CodeCamera';
import { signal } from '@/gate/feedback';
import { useOfflineList } from '@/gate/offlineList';
import { describeScan, screenResult } from '@/gate/outcomes';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useDoorExit, useMe } from '@/gate/useDoor';
import { measureScan } from '@/lib/monitoring';
import { dialog } from '@/ui/Dialog';
import { Icon, type IconName } from '@/ui/Icon';
import { Header } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * Check-in — the mockup's camera screen. One code at a time: read, decide,
 * show the answer full screen, come back. The screen stays awake; the torch
 * and the other camera are one tap away. With no signal it keeps going: the
 * phone checks tickets from its list, or holds them to sync.
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
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const busy = useRef(false);
  const held = pendingCount(records);
  const offline = net.isConnected === false;
  const listReady = useOfflineList((s) => s.complete && !s.off);

  async function onCode(data: string) {
    if (!door || busy.current) return;
    busy.current = true;
    try {
      const rec = await measureScan(
        () => useScanLog.getState().submit(data, door.token, { offline }),
        (r) => (r ? `${r.method}:${screenResult(r)}` : 'ignored'),
      );
      if (!rec) return;
      signal(describeScan(screenResult(rec)).tone);
      router.push({ pathname: '/result', params: { id: rec.clientScanId } });
    } catch (err) {
      if (!(await exit(err))) {
        dialog.alert('Could not check that code', 'Something went wrong reading it. Scan it again.', { tone: 'warning', icon: 'qr', button: 'Scan again' });
      }
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={styles.screen}>
      {/* Mounted only while this screen is in front: one camera at a time. */}
      {focused ? <CodeCamera onCode={onCode} torch={torch} facing={facing} /> : <View style={styles.screen} />}

      <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
        <View style={styles.pad}>
          <Header title="Check-in" inverse />
          <View style={styles.tools}>
            <RoundButton
              icon="bolt"
              label={torch ? 'Turn the light off' : 'Turn the light on'}
              on={torch}
              onPress={() => setTorch((t) => !t)}
            />
            <RoundButton
              icon="cameraFlip"
              label={facing === 'back' ? 'Use the front camera' : 'Use the back camera'}
              onPress={() => { setTorch(false); setFacing((f) => (f === 'back' ? 'front' : 'back')); }}
            />
          </View>
          {(offline || held > 0) && (
            <View style={styles.badges}>
              {offline && (
                <View style={[styles.badge, { backgroundColor: 'rgba(245,158,11,0.92)' }]}>
                  <Icon name="offline" size={15} color={colors.white} />
                  <Text variant="caption" weight="semibold" color={colors.white}>
                    {listReady ? 'Offline — checking on this phone' : 'Offline — check-ins are saved'}
                  </Text>
                </View>
              )}
              {held > 0 && (
                <View style={styles.badge}>
                  <Text variant="caption" weight="semibold" color={colors.white}>{held} waiting to sync</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
        {TEST_ENTRY && <TestCodeEntry onCode={onCode} />}
        <Text color={colors.white} align="center" style={styles.hint}>{'Scan guest QR code\nto check in'}</Text>
        {me.data?.permissions.manualCheckIn && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/attendees')} style={styles.manual} hitSlop={6}>
            <Icon name="search" size={16} color={colors.teal100} />
            <Text variant="small" weight="semibold" color={colors.teal100}>No code? Find the guest by name</Text>
          </Pressable>
        )}
      </SafeAreaView>
    </View>
  );
}

function RoundButton({ icon, label, onPress, on = false }: { icon: IconName; label: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={8}
      style={[styles.round, on && { backgroundColor: colors.white }]}
    >
      <Icon name={icon} size={22} color={on ? colors.night : colors.white} />
    </Pressable>
  );
}

/**
 * Automated tests cannot hold a ticket up to a camera, so development builds
 * (and any build made with EXPO_PUBLIC_E2E=1) get a field to type a code
 * into. It takes the same path as a code the camera read; the Maestro flows in
 * mobile/maestro use it. Never in a preview or store build: __DEV__ is false
 * there and EXPO_PUBLIC_E2E is not set.
 */
const TEST_ENTRY = __DEV__ || process.env.EXPO_PUBLIC_E2E === '1';

function TestCodeEntry({ onCode }: { onCode: (data: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <TextInput
      testID="e2e-code"
      accessibilityLabel="Test code (test builds only)"
      placeholder="Test builds: type or paste a code"
      placeholderTextColor={colors.teal200}
      value={code}
      onChangeText={setCode}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="go"
      onSubmitEditing={() => { const c = code.trim(); setCode(''); if (c) onCode(c); }}
      style={styles.testEntry}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.camera },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  pad: { paddingHorizontal: space.lg, gap: space.sm },
  tools: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs },
  round: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  badges: { alignItems: 'center', gap: space.xs },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: 'rgba(13,91,94,0.92)',
  },
  bottom: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl, gap: space.md, alignItems: 'center' },
  hint: { fontSize: 16, lineHeight: 23 },
  manual: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.sm },
  testEntry: {
    alignSelf: 'stretch', minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, color: colors.white,
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
});
