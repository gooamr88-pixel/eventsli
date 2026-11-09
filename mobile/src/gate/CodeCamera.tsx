import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { isRepeatRead } from './queuePolicy';

type Props = {
  /** Called once per distinct code; the same code held in view is not re-sent for 3 s. */
  onCode: (data: string) => void;
  /** False while a result is on screen: the camera stays mounted but ignores codes. */
  paused?: boolean;
  torch?: boolean;
  frameSize?: number;
};

/** Whether the person has asked their phone for less motion, kept current. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduce(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * The camera with the mockup's frame: four teal corners and a moving scan line.
 * Native decoding (ML Kit on Android, AVFoundation on iOS) through expo-camera,
 * QR codes only — nothing else at a door is ours.
 */
export function CodeCamera({ onCode, paused = false, torch = false, frameSize = 260 }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ token: string; at: number } | null>(null);
  const [line] = useState(() => new Animated.Value(0));

  // The moving line says "scanning". With Reduce Motion on it rests in the
  // middle of the frame and says the same thing without moving.
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) {
      line.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(line, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [line, reduceMotion]);

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.ask]}>
        <Text variant="title" color={colors.white} align="center">Camera access needed</Text>
        <Text color={colors.teal100} align="center">
          Eventsli Check-in uses the camera to read ticket codes. Nothing is recorded or stored.
        </Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={requestPermission} />
        ) : (
          <Button label="Open Settings" onPress={() => Linking.openSettings()} />
        )}
      </View>
    );
  }

  function handle(result: BarcodeScanningResult) {
    if (paused || !result?.data) return;
    const now = Date.now();
    if (isRepeatRead(last.current, result.data, now)) return;
    last.current = { token: result.data, at: now };
    onCode(result.data);
  }

  const travel = frameSize - 24;
  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={paused ? undefined : handle}
      />
      <View pointerEvents="none" style={styles.center}>
        <View style={{ width: frameSize, height: frameSize }}>
          <Corner style={{ top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: radius.lg }} />
          <Corner style={{ top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: radius.lg }} />
          <Corner style={{ bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: radius.lg }} />
          <Corner style={{ bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: radius.lg }} />
          {!paused && (
            <Animated.View
              style={[
                styles.line,
                { transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [12, travel] }) }] },
              ]}
            />
          )}
        </View>
      </View>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.camera },
  ask: { justifyContent: 'center', padding: space.xl, gap: space.lg },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: colors.teal200 },
  line: {
    position: 'absolute', left: 10, right: 10, height: 3, borderRadius: 2,
    backgroundColor: '#5eead4',
    shadowColor: '#5eead4', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
});
