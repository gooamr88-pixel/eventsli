import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './bits';
import { useLayout } from './layout';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/**
 * A sheet that rises from the bottom for a short task that belongs to the
 * screen under it — Notify me, give a ticket away, the seat list — so the
 * person never loses their place. On a wide screen it is a centred dialog
 * instead, since a sheet 1,200 points wide reads as a page.
 *
 * Tapping the dimmed backdrop, the close button, or Android's back closes it.
 */
export function Sheet({ visible, onClose, title, subtitle, children, footer }: {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode;
  /** The sheet's action, pinned under the scrolling body. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { tablet, height } = useLayout();
  return (
    <Modal visible={visible} transparent animationType={tablet ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, tablet && styles.rootCentre]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
          <View style={styles.backdrop} />
        </Pressable>
        <View
          style={[styles.panel, tablet ? styles.dialog : { paddingBottom: insets.bottom + space.md }, { maxHeight: height * (tablet ? 0.8 : 0.9) }]}
          accessibilityViewIsModal
        >
          {!tablet ? <View style={styles.grabber} /> : null}
          <View style={styles.head}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title" accessibilityRole="header">{title}</Text>
              {subtitle ? <Text variant="small" color={colors.muted}>{subtitle}</Text> : null}
            </View>
            <IconButton icon="close" label="Close" variant="soft" size={18} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  rootCentre: { justifyContent: 'center', alignItems: 'center', padding: space.xl },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  panel: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm },
  dialog: { width: '100%', maxWidth: 540, borderRadius: radius.xl, paddingBottom: space.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  body: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md },
  footer: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.sm },
});
