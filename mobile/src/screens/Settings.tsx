import * as Application from 'expo-application';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { API_URL } from '@/api/client';
import { useSession } from '@/auth/session';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Card, Header, Screen } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/**
 * The door's preferences, who is signed in, and the ways out.
 *
 * Mounted twice: as `(door)/settings` from the dashboard and as `(account)/account` from
 * the events screen, so it always belongs to the group it was opened from.
 * Switching event or signing out only changes the session. The guard then
 * removes this screen together with its group and the phone lands where it
 * now belongs, in one move. A Settings outside the groups was left alone at
 * the bottom of the stack when its group went (Expo Router warned it was a
 * modal with nothing under it), and had to navigate on its own afterwards.
 */
export default function Settings() {
  const account = useSession((s) => s.account);
  const door = useSession((s) => s.door);
  const leaveDoor = useSession((s) => s.leaveDoor);
  const signOut = useSession((s) => s.signOut);
  const s = useSettings();
  const held = pendingCount(useScanLog((x) => x.records));

  function guard(action: () => void) {
    if (held > 0) {
      Alert.alert('Scans still waiting', `${held} scan(s) have not uploaded yet. Upload them first so nobody's admission is lost.`);
      return;
    }
    action();
  }

  return (
    <Screen scroll>
      <Header title="Settings" onBack={() => router.back()} />

      <Card style={{ gap: space.sm }}>
        <Toggle label="Sound" hint="A tone for every answer, even on silent." value={s.sound} onChange={(v) => s.set({ sound: v })} />
        <Toggle label="Vibration" hint="Not felt on iPhone while the camera is open." value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
        <Toggle
          label="Back to the camera after a check-in"
          hint="Returns two seconds after a successful scan. Refusals always wait."
          value={s.autoContinue}
          onChange={(v) => s.set({ autoContinue: v })}
        />
      </Card>

      <Card style={{ gap: space.xs }}>
        <Text variant="small" color={colors.muted}>Signed in as</Text>
        <Text variant="label">{account?.user.email ?? (door?.kind === 'pin' ? `Shared device · ${door.label}` : '—')}</Text>
        {door && <Text variant="small" color={colors.muted}>Working: {door.eventTitle ?? 'an event'}</Text>}
      </Card>

      {door && account && (
        <Button label="Switch event" variant="secondary" icon="calendar" onPress={() => guard(() => { void leaveDoor(); })} />
      )}
      {(account || door) && (
        <Button
          label="Sign out"
          variant="danger"
          icon="exit"
          onPress={() => guard(() => Alert.alert('Sign out?', 'This phone stops scanning until someone signs in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
          ]))}
        />
      )}

      <View style={{ alignItems: 'center', gap: 2, marginTop: space.lg }}>
        <Text variant="caption" color={colors.subtle}>
          Eventsli Check-in {Application.nativeApplicationVersion ?? ''} ({Application.nativeBuildVersion ?? ''})
        </Text>
        <Text variant="caption" color={colors.subtle}>{API_URL.replace(/^https?:\/\//, '').replace(/\/api\/v1$/, '')}</Text>
      </View>
    </Screen>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.toggle} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight="medium">{label}</Text>
        <Text variant="small" color={colors.muted}>{hint}</Text>
      </View>
      {/* The whole row is the switch for a screen reader; this is its picture. */}
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.teal400, false: colors.border }}
        thumbColor={colors.white}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
