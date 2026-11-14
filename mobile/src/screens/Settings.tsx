import * as Application from 'expo-application';
import { StyleSheet, View } from 'react-native';

import { useSession } from '@/auth/session';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { useMe } from '@/gate/useDoor';
import { dialog } from '@/ui/Dialog';
import { Avatar, Card, ListRow, Screen, ScreenTitle, Section } from '@/ui/layout';
import { TabBar } from '@/ui/TabBar';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

export type SettingsMode = 'door' | 'account';

/** Who is signed in, as a line under their name. */
export function roleLabel(role: string | undefined, kind: 'staff' | 'pin' | undefined, accountTypes: string[] = []): string {
  if (kind === 'pin') return 'Shared door device';
  if (role === 'owner') return 'Organizer';
  if (role === 'staff') return 'Event Staff';
  return accountTypes.includes('organizer') ? 'Organizer' : 'Event Staff';
}

/** Where the rows lead, given by the route file of the group this is mounted in. */
export type SettingsLinks = { profile: () => void; appSettings: () => void; help: () => void; dataSync?: () => void };

/**
 * Settings, as the mockup draws it: who is signed in, then My Profile, App
 * Settings, Data & Sync (while working a door), Language, Help & Support and
 * Sign Out.
 *
 * Mounted twice: as `(door)/settings` (the Profile tab at a door) and as
 * `(account)/account` (while choosing an event), so it always belongs to the
 * group it was opened from. Signing out and leaving the event only change the
 * session; the guard then removes this screen with its group
 * (src/app/_layout.tsx).
 */
export function SettingsScreen({ mode, links }: { mode: SettingsMode; links: SettingsLinks }) {
  const account = useSession((s) => s.account);
  const door = useSession((s) => s.door);
  const signOut = useSession((s) => s.signOut);
  const leaveDoor = useSession((s) => s.leaveDoor);
  const me = useMe();
  const held = pendingCount(useScanLog((x) => x.records));

  const name = account?.user.fullName || account?.user.email || door?.label || 'Signed in';
  const role = roleLabel(me.data?.role, door?.kind, account?.user.accountTypes);

  function waiting(): boolean {
    if (held === 0) return false;
    dialog.show({
      tone: 'warning',
      icon: 'cloudUpload',
      title: 'Check-ins still waiting',
      message: `${held} check-in${held === 1 ? ' has' : 's have'} not synced yet. Sync first, so nobody's admission is lost.`,
      actions: [
        ...(links.dataSync ? [{ label: 'Open Data & Sync', kind: 'primary' as const, onPress: links.dataSync }] : []),
        { label: links.dataSync ? 'Not now' : 'OK', kind: 'cancel' as const },
      ],
    });
    return true;
  }

  async function askSignOut() {
    if (waiting()) return;
    const yes = await dialog.confirm({
      title: 'Sign out?',
      message: door?.kind === 'pin'
        ? 'This device stops scanning. You will need the device ID and PIN to sign it back in.'
        : 'This phone stops scanning until someone signs in again.',
      confirm: 'Sign out',
      destructive: true,
      icon: 'exit',
    });
    if (yes) await signOut();
  }

  async function askLeave() {
    if (waiting()) return;
    const yes = await dialog.confirm({
      title: 'Switch event?',
      message: `You leave ${door?.eventTitle ?? 'this event'} on this phone and go back to My Events. Its guest list is removed from the phone.`,
      confirm: 'Switch event',
      icon: 'calendar',
    });
    if (yes) await leaveDoor();
  }

  function language() {
    dialog.actions({
      title: 'Language',
      subtitle: 'The language of the app on this phone.',
      options: [{ icon: 'globe', label: 'English', selected: true }],
      footnote: 'More languages are on the way.',
    });
  }

  const version = `${Application.nativeApplicationVersion ?? ''} (${Application.nativeBuildVersion ?? ''})`;

  return (
    <Screen scroll bar={<TabBar active="profile" mode={mode} />}>
      <ScreenTitle>Settings</ScreenTitle>

      <Card style={styles.profile}>
        <Avatar name={account?.user.fullName || null} size={56} tone="solid" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" numberOfLines={1}>{name}</Text>
          <Text variant="small" color={colors.muted}>{role}</Text>
          {account?.user.email && account.user.fullName ? (
            <Text variant="caption" color={colors.subtle} numberOfLines={1}>{account.user.email}</Text>
          ) : null}
        </View>
      </Card>

      {mode === 'door' && door && (
        <View style={styles.door}>
          <View style={styles.doorIcon}><Text variant="label" color={colors.white}>{(door.eventTitle ?? 'E').slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={colors.muted}>Checking in at</Text>
            <Text variant="body" weight="semibold" numberOfLines={1}>{door.eventTitle ?? 'This event'}</Text>
            <Text variant="caption" color={colors.subtle} numberOfLines={1}>{door.label}</Text>
          </View>
        </View>
      )}

      <Section title="Account">
        <Card style={styles.rows}>
          <ListRow icon="user" label="My Profile" onPress={links.profile} />
          <ListRow icon="settings" label="App Settings" onPress={links.appSettings} last={!links.dataSync} />
          {links.dataSync && (
            <ListRow icon="refresh" label="Data & Sync" value={held > 0 ? `${held} waiting` : undefined} onPress={links.dataSync} last />
          )}
        </Card>
      </Section>

      <Section title="Support">
        <Card style={styles.rows}>
          <ListRow icon="globe" label="Language" value="English" onPress={language} />
          <ListRow icon="help" label="Help & Support" onPress={links.help} last />
        </Card>
      </Section>

      <Card style={styles.rows}>
        {mode === 'door' && door?.kind === 'staff' && account && (
          <ListRow icon="calendar" label="Switch Event" onPress={() => { void askLeave(); }} hint="Go back to My Events" />
        )}
        {/* Started, not awaited: the press is over once the dialog is up. */}
        <ListRow icon="exit" label="Sign Out" danger onPress={() => { void askSignOut(); }} last />
      </Card>

      <Text variant="caption" color={colors.subtle} align="center">Eventsli Check-in {version}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rows: { paddingVertical: space.xs },
  door: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.lg, backgroundColor: colors.mint,
  },
  doorIcon: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
});
