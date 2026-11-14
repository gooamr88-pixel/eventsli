import { useNetInfo } from '@react-native-community/netinfo';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useOfflineList } from '@/gate/offlineList';
import { pendingCount, useScanLog } from '@/gate/scanLog';
import { count } from '@/lib/format';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Card, Header, Screen, StatusIcon } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * You're Offline — the mockup's interstitial, shown when the signal drops on
 * the dashboard or the camera (src/app/(door)/_layout.tsx). Check-ins carry
 * on: the phone checks them from its list, or saves them to sync. When the
 * signal is back with check-ins waiting, it offers to sync them now.
 */
export default function Offline() {
  const net = useNetInfo();
  const records = useScanLog((s) => s.records);
  const listReady = useOfflineList((s) => s.complete && !s.off);
  const pending = pendingCount(records);
  const online = net.isConnected === true;

  function continueScanning() {
    if (router.canGoBack()) router.back();
    else router.replace('/scan');
  }

  return (
    <Screen
      waves="both"
      footer={online && pending > 0 ? (
        <Button label={`Sync ${count(pending)} check-in${pending === 1 ? '' : 's'} now`} icon="cloudUpload" onPress={() => router.replace('/sync')} />
      ) : (
        <Button label="Continue Scanning" onPress={continueScanning} />
      )}
    >
      <Header
        right={(
          <View style={styles.pill}>
            <View style={[styles.dot, { backgroundColor: online ? colors.successStrong : colors.offline }]} />
            <Text variant="small" weight="semibold" color={colors.text}>{online ? 'Back online' : 'Offline Mode'}</Text>
          </View>
        )}
      />
      <View style={styles.hero}>
        <StatusIcon kind="info" icon="offline" />
        <Text variant="heading" align="center">{online ? 'You’re Back Online' : 'You’re Offline'}</Text>
        <Text color={colors.muted} align="center" style={styles.body}>
          {online
            ? 'Saved check-ins sync automatically. You can also sync them now.'
            : listReady
              ? 'Check-ins will be checked on this phone, saved locally and synced automatically when you’re back online.'
              : 'Check-ins will be saved locally and synced automatically when you’re back online.'}
        </Text>
      </View>
      <Card style={styles.pending}>
        <Icon name="layers" size={24} color={colors.muted} />
        <View style={{ gap: 2 }}>
          <Text variant="small" color={colors.muted}>Pending Check-ins</Text>
          <Text variant="title">{count(pending)}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.warningHalo,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.lg },
  body: { paddingHorizontal: space.lg },
  pending: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.md },
});
