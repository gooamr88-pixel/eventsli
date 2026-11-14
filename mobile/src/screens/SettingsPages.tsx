import { useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { API_URL } from '@/api/client';
import { appConfig } from '@/api/endpoints';
import type { Permissions } from '@/api/types';
import { siteUrl } from '@/auth/pkce';
import { useSession } from '@/auth/session';
import { primeFeedback, signal } from '@/gate/feedback';
import { useMe } from '@/gate/useDoor';
import { eventDate } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Avatar, Card, Header, InfoRow, ListRow, Screen, Section, ToggleRow } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { roleLabel } from './Settings';

const open = (url: string) => { WebBrowser.openBrowserAsync(url).catch(() => undefined); };
const server = () => API_URL.replace(/^https?:\/\//, '').replace(/\/api\/v1$/, '');

/** What this phone may do at this door, in the words of the job. */
const ABILITIES: { key: keyof Permissions | 'scan'; icon: IconName; label: string }[] = [
  { key: 'scan', icon: 'scan', label: 'Scan tickets' },
  { key: 'viewGuests', icon: 'users', label: 'Find guests by name' },
  { key: 'manualCheckIn', icon: 'tick', label: 'Check guests in by hand' },
  { key: 'analytics', icon: 'chart', label: 'See the event’s analytics' },
  { key: 'offlineAdmission', icon: 'offline', label: 'Check in with no signal' },
  { key: 'fullNames', icon: 'user', label: 'See guests’ full names' },
];

/** Settings → My Profile: who this phone is signed in as, at which door, and what it may do there. */
export function ProfilePage() {
  const account = useSession((s) => s.account);
  const door = useSession((s) => s.door);
  const me = useMe();
  const role = roleLabel(me.data?.role, door?.kind, account?.user.accountTypes);
  const name = account?.user.fullName || account?.user.email || door?.label || 'Signed in';
  const perms = me.data?.permissions;

  return (
    <Screen scroll>
      <Header title="My Profile" />
      <View style={styles.center}>
        <Avatar name={account?.user.fullName || null} size={88} tone="solid" />
        <Text variant="title" align="center">{name}</Text>
        <View style={styles.rolePill}><Text variant="caption" weight="semibold" color={colors.accent}>{role}</Text></View>
      </View>

      {account && (
        <Section title="Account">
          <Card style={styles.rows}>
            <InfoRow icon="mail" label="Email" value={account.user.email} />
            <InfoRow icon="briefcase" label="Account" value={account.user.accountTypes.includes('organizer') ? 'Organizer' : 'Eventsli member'} />
            <InfoRow icon="lock" label="Signed in until" value={eventDate(account.expiresAt)} last />
          </Card>
        </Section>
      )}

      {door && (
        <Section title="This door">
          <Card style={styles.rows}>
            <InfoRow icon="calendar" label="Event" value={door.eventTitle ?? '—'} />
            <InfoRow icon="tablet" label="Device" value={door.label} />
            <InfoRow icon="shield" label="Role" value={role} last />
          </Card>
        </Section>
      )}

      {door && perms && (
        <Section title="What you can do here">
          <Card style={styles.rows}>
            {ABILITIES.map((a, i) => {
              const yes = a.key === 'scan' ? true : perms[a.key];
              return (
                <View
                  key={a.key}
                  style={[styles.ability, i < ABILITIES.length - 1 && styles.rule]}
                  accessible
                  accessibilityLabel={`${a.label}: ${yes ? 'yes' : 'no'}`}
                >
                  <Icon name={a.icon} size={20} color={yes ? colors.accent : colors.subtle} />
                  <Text variant="body" color={yes ? colors.text : colors.muted} style={{ flex: 1 }}>{a.label}</Text>
                  <View style={[styles.mark, { backgroundColor: yes ? colors.successHalo : colors.bgSunken }]}>
                    <Icon name={yes ? 'tick' : 'close'} size={14} color={yes ? colors.success : colors.muted} strokeWidth={2.8} />
                  </View>
                </View>
              );
            })}
          </Card>
          <Text variant="caption" color={colors.subtle}>The organizer decides these on eventsli.com, under the event’s Devices page.</Text>
        </Section>
      )}

      {account && (
        <Button label="Manage account on eventsli.com" variant="secondary" icon="external" onPress={() => open(`${siteUrl()}/account`)} />
      )}
    </Screen>
  );
}

/** Settings → App Settings: how the answers sound and feel, a way to try them, and the app's details. */
export function AppSettingsPage() {
  const s = useSettings();

  function test() {
    primeFeedback().finally(() => signal('admit'));
  }

  return (
    <Screen scroll>
      <Header title="App Settings" />

      <Section title="At the door">
        <Card style={styles.rows}>
          <ToggleRow icon="bell" label="Sound" hint="A tone for every answer, even on silent." value={s.sound} onChange={(v) => s.set({ sound: v })} />
          <ToggleRow icon="pulse" label="Vibration" hint="Not felt on iPhone while the camera is open." value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
          <ToggleRow
            icon="scan"
            label="Back to the camera"
            hint="Two seconds after a successful check-in. Other answers always wait."
            value={s.autoContinue}
            onChange={(v) => s.set({ autoContinue: v })}
            last
          />
        </Card>
        <Button
          label="Try the check-in sound"
          variant="secondary"
          icon="play"
          onPress={test}
          disabled={!s.sound && !s.haptics}
          accessibilityHint="Plays the sound and vibration of a successful check-in"
        />
      </Section>

      <Section title="About">
        <Card style={styles.rows}>
          <InfoRow label="Version" value={Application.nativeApplicationVersion ?? '—'} />
          <InfoRow label="Build" value={Application.nativeBuildVersion ?? '—'} />
          <InfoRow label="Server" value={server()} />
          <ListRow icon="shield" label="Privacy Policy" onPress={() => open(`${siteUrl()}/privacy`)} />
          <ListRow icon="fileText" label="Terms of Service" onPress={() => open(`${siteUrl()}/terms`)} last />
        </Card>
      </Section>
    </Screen>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I check a guest in?',
    a: 'Open the event and tap Start Check-in. Hold the guest’s QR code inside the frame. Green means let them in, amber means look closer, red means do not let them in.',
  },
  {
    q: 'What happens with no signal?',
    a: 'With Offline Mode on, the phone keeps the event’s guest list and checks tickets itself. Check-ins are saved on the phone and sync on their own when the signal returns. Do not sign out while check-ins are waiting.',
  },
  {
    q: 'The screen says Already Checked In',
    a: 'This ticket was used before. The screen shows when, and at which door. Do not let a second person in on it; ask the organizer if you are unsure.',
  },
  {
    q: 'The guest has no code, or it will not scan',
    a: 'On the camera screen, tap “No code? Find the guest by name” (when the organizer allows it). Open their ticket, check their ID, and check them in by hand.',
  },
  {
    q: 'I let someone in by mistake',
    a: 'On the answer screen, tap “Scanned by mistake? Undo” within one minute. After that, ask the organizer.',
  },
  {
    q: 'What is “Can’t Confirm Offline”?',
    a: 'The phone does not know this ticket yet, for example one bought minutes ago. The scan is saved and checked as soon as there is a signal. Follow the organizer’s rule for these guests.',
  },
  {
    q: 'The camera is black',
    a: 'Allow camera access for Eventsli Check-in in the phone’s settings, and close other apps that use the camera. Then open the camera screen again.',
  },
];

/** Settings → Help & Support: answers to what happens at a door, and how to reach us. */
export function HelpPage() {
  const config = useQuery({ queryKey: ['app-config'], queryFn: appConfig, staleTime: 3600_000, retry: 0 });
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const contact = config.data?.supportUrl || `${siteUrl()}/contact`;

  return (
    <Screen scroll>
      <Header title="Help & Support" />

      <View style={styles.helpHero}>
        <View style={styles.helpIcon}><Icon name="help" size={30} color={colors.accent} /></View>
        <Text variant="title" align="center">How can we help?</Text>
        <Text variant="small" color={colors.muted} align="center">Quick answers for the door. Tap a question to read the answer.</Text>
      </View>

      <Section title="Common questions">
        <Card style={styles.rows}>
          {FAQ.map((f, i) => {
            const expanded = openIndex === i;
            return (
              <View key={f.q} style={i < FAQ.length - 1 && styles.rule}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setOpenIndex(expanded ? null : i)}
                  style={styles.question}
                >
                  <Text variant="body" weight="semibold" style={{ flex: 1 }}>{f.q}</Text>
                  <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={20} color={colors.muted} />
                </Pressable>
                {expanded && <Text variant="small" color={colors.muted} style={styles.answer}>{f.a}</Text>}
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title="Still stuck?">
        <Card style={styles.rows}>
          <ListRow icon="chat" label="Contact support" onPress={() => open(contact)} />
          <ListRow icon="globe" label="Visit eventsli.com" onPress={() => open(siteUrl())} last />
        </Card>
        <Text variant="caption" color={colors.subtle} align="center">
          Eventsli Check-in {Application.nativeApplicationVersion ?? ''} ({Application.nativeBuildVersion ?? ''}) · {server()}
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  rolePill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.mint },
  rows: { paddingVertical: space.xs },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ability: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50 },
  mark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  helpHero: { alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
  helpIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mint,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.xs,
  },
  question: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, paddingVertical: space.sm },
  answer: { paddingBottom: space.md, paddingRight: space.xl },
});
