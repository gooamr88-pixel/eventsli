import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ApiError, messageFor } from '@/api/client';
import { pinLogin } from '@/api/endpoints';
import { useSession } from '@/auth/session';
import { CodeCamera } from '@/gate/CodeCamera';
import { pairingDeviceId } from '@/gate/qrToken';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Header, Screen } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A shared door tablet — no personal account, the organizer's device ID and a
 * PIN. The ID is 36 characters, so it is scanned from the pairing code on the
 * organizer's Devices page rather than typed. The code never holds the PIN.
 */
export default function DevicePin() {
  const params = useLocalSearchParams<{ device?: string }>();
  const setDoor = useSession((s) => s.setDoor);
  const [deviceId, setDeviceId] = useState(typeof params.device === 'string' ? params.device : '');
  const [pin, setPin] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const id = deviceId.trim().toLowerCase();
    if (!UUID.test(id)) {
      setError('Scan the pairing code, or type the device ID exactly as the organizer shows it.');
      return;
    }
    if (pin.length < 4) {
      setError('Enter the device PIN.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const door = await pinLogin(id, pin);
      // The session moves the tablet to the dashboard (see src/app/_layout.tsx).
      await setDoor(door, 'pin');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401
        ? 'That device ID or PIN is not right. After 10 wrong PINs the device waits 15 minutes.'
        : messageFor(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  if (scanning) {
    return (
      <View style={styles.camera}>
        <CodeCamera
          onCode={(data) => {
            const id = pairingDeviceId(data);
            if (id) {
              setDeviceId(id);
              setScanning(false);
              setError(null);
            } else {
              setError('That is not a pairing code. Open Scanning devices on the website and choose Pair a phone.');
              setScanning(false);
            }
          }}
        />
        <View style={styles.cameraBar}>
          <Text color={colors.white} align="center">Point at the pairing code on the organizer’s screen</Text>
          <Button label="Cancel" variant="secondary" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll>
        <Header title="Shared door device" />
        <Text color={colors.muted}>
          For a tablet or phone the whole door team shares. The organizer registers it under
          Scanning devices on the website and gives you its PIN.
        </Text>

        <Card style={{ gap: space.md }}>
          <Button label={deviceId ? 'Scan a different pairing code' : 'Scan pairing code'} icon="qr" variant="secondary" onPress={() => setScanning(true)} />
          <Field
            label="Device ID"
            icon="tablet"
            value={deviceId}
            onChangeText={setDeviceId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="PIN"
            icon="lock"
            secret
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={12}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {error && <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text>}
          <Button label="Start scanning" onPress={submit} busy={busy} />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, backgroundColor: colors.camera },
  cameraBar: {
    position: 'absolute', left: space.lg, right: space.lg, bottom: space.xxl, gap: space.md,
    padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.overlay,
  },
});
