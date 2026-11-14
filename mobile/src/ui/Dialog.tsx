import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, radius, shadow, space } from './theme';

/**
 * The app's own pop-ups, drawn in the mockup's style instead of the system's
 * grey alert boxes:
 *
 *   dialog.alert / dialog.confirm   a centred card: a coloured icon, a title,
 *                                   a sentence, and stacked buttons
 *   dialog.actions                  a bottom sheet of choices (the event's
 *                                   "more" menu, the language)
 *   <Sheet>                         a bottom sheet with any content (an event's
 *                                   preview, one log entry)
 *
 * One host (`<DialogHost/>`, in the root layout) shows them one at a time; a
 * second request waits for the first to close. Nothing here navigates: an
 * action's own handler does, after the pop-up has closed.
 */

export type DialogTone = 'info' | 'success' | 'warning' | 'danger';

export type DialogAction = {
  label: string;
  /** primary: the filled button. cancel: the quiet one, and what the backdrop does. */
  kind?: 'primary' | 'secondary' | 'danger' | 'cancel';
  onPress?: () => void;
};

export type SheetOption = {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

type DialogSpec = { kind: 'dialog'; tone?: DialogTone; icon?: IconName; title: string; message?: string; actions?: DialogAction[] };
type ActionsSpec = { kind: 'actions'; title?: string; subtitle?: string; options: SheetOption[]; footnote?: string };
type Spec = (DialogSpec | ActionsSpec) & { id: number };

type Store = { current: Spec | null; queue: Spec[] };
let nextId = 1;

export const useDialogStore = create<Store>(() => ({ current: null, queue: [] }));

function open(spec: DialogSpec | ActionsSpec) {
  const item = { ...spec, id: nextId++ } as Spec;
  useDialogStore.setState((s) => (s.current ? { queue: [...s.queue, item] } : { current: item }));
}

function close() {
  useDialogStore.setState((s) => ({ current: s.queue[0] ?? null, queue: s.queue.slice(1) }));
}

export const dialog = {
  /** A message with one button. */
  alert(title: string, message?: string, opts: { tone?: DialogTone; icon?: IconName; button?: string } = {}) {
    open({ kind: 'dialog', title, message, tone: opts.tone ?? 'info', icon: opts.icon, actions: [{ label: opts.button ?? 'OK', kind: 'primary' }] });
  },
  /** Any buttons. The `cancel` one (if any) is also what tapping outside does. */
  show(spec: Omit<DialogSpec, 'kind'>) {
    open({ kind: 'dialog', ...spec });
  },
  /** Yes or no. Resolves true only when the confirming button is pressed. */
  confirm(spec: {
    title: string; message?: string; confirm: string; cancel?: string; tone?: DialogTone; icon?: IconName; destructive?: boolean;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      open({
        kind: 'dialog',
        title: spec.title,
        message: spec.message,
        tone: spec.tone ?? (spec.destructive ? 'danger' : 'info'),
        icon: spec.icon,
        actions: [
          { label: spec.confirm, kind: spec.destructive ? 'danger' : 'primary', onPress: () => resolve(true) },
          { label: spec.cancel ?? 'Cancel', kind: 'cancel', onPress: () => resolve(false) },
        ],
      });
    });
  },
  /** A bottom sheet of choices. */
  actions(spec: Omit<ActionsSpec, 'kind'>) {
    open({ kind: 'actions', ...spec });
  },
};

const TONE: Record<DialogTone, { fg: string; halo: string; icon: IconName }> = {
  info: { fg: colors.accent, halo: colors.mint, icon: 'info' },
  success: { fg: colors.success, halo: colors.successHalo, icon: 'check' },
  warning: { fg: colors.warningGlyph, halo: colors.warningHalo, icon: 'alert' },
  danger: { fg: colors.dangerGlyph, halo: colors.dangerHalo, icon: 'alert' },
};

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (alive) setReduce(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduce);
    return () => { alive = false; sub?.remove(); };
  }, []);
  return reduce;
}

/**
 * Rises from below (a sheet) or settles in (a dialog) when it mounts, unless
 * the phone asks for less motion. Each pop-up mounts fresh, so this runs once
 * per showing.
 */
function useEntrance() {
  const reduce = useReduceMotion();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) {
      t.setValue(1);
      return;
    }
    Animated.timing(t, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce, t]);
  return t;
}

/** Mounted once, in the root layout. */
export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  if (!current) return null;
  if (current.kind === 'dialog') return <DialogView key={current.id} spec={current} />;
  return <ActionsView key={current.id} spec={current} />;
}

function DialogView({ spec }: { spec: DialogSpec & { id: number } }) {
  const t = useEntrance();
  const tone = TONE[spec.tone ?? 'info'];
  const actions = spec.actions?.length ? spec.actions : [{ label: 'OK', kind: 'primary' as const }];
  const cancel = actions.find((a) => a.kind === 'cancel') ?? (actions.length === 1 ? actions[0] : null);

  const press = (a: DialogAction) => {
    close();
    a.onPress?.();
  };
  // Outside the card, and the system back button: the cancel choice, if there is one.
  const dismiss = () => {
    if (cancel) press(cancel);
  };

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.center}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={dismiss}
        />
        <Animated.View
          testID="dialog"
          accessibilityViewIsModal
          style={[
            styles.dialog,
            { opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
          ]}
        >
          <View style={[styles.dialogIcon, { backgroundColor: tone.halo }]}>
            <Icon name={spec.icon ?? tone.icon} size={30} color={tone.fg} strokeWidth={2.2} />
          </View>
          <Text variant="title" align="center" accessibilityRole="header">{spec.title}</Text>
          {spec.message ? <Text variant="body" color={colors.muted} align="center">{spec.message}</Text> : null}
          <View style={styles.actions}>
            {actions.map((a) => (
              <Button
                key={a.label}
                label={a.label}
                variant={a.kind === 'cancel' ? 'ghost' : a.kind === 'danger' ? 'dangerSolid' : a.kind === 'secondary' ? 'secondary' : 'primary'}
                onPress={() => press(a)}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function ActionsView({ spec }: { spec: ActionsSpec & { id: number } }) {
  const choose = (o: SheetOption) => {
    if (o.disabled) return;
    close();
    o.onPress?.();
  };
  return (
    <SheetFrame onClose={close} title={spec.title} subtitle={spec.subtitle} testID="sheet">
      <View style={styles.options}>
        {spec.options.map((o, i) => (
          <Pressable
            key={o.label}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityHint={o.hint}
            accessibilityState={{ disabled: o.disabled, selected: o.selected }}
            onPress={() => choose(o)}
            style={({ pressed }) => [styles.option, i > 0 && styles.optionRule, pressed && !o.disabled && styles.pressed, o.disabled && styles.disabled]}
          >
            <View style={[styles.optionIcon, { backgroundColor: o.danger ? colors.dangerHalo : colors.mint }]}>
              <Icon name={o.icon} size={20} color={o.danger ? colors.dangerGlyph : colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="body" weight="medium" color={o.danger ? colors.dangerGlyph : colors.text}>{o.label}</Text>
              {o.hint ? <Text variant="caption" color={colors.muted}>{o.hint}</Text> : null}
            </View>
            {o.selected ? <Icon name="tick" size={20} color={colors.accent} strokeWidth={2.6} /> : null}
          </Pressable>
        ))}
      </View>
      {spec.footnote ? <Text variant="caption" color={colors.subtle} align="center">{spec.footnote}</Text> : null}
      <Button label="Cancel" variant="ghost" onPress={close} />
    </SheetFrame>
  );
}

/**
 * A bottom sheet with any content. Controlled: show it with `visible`, and
 * `onClose` is called by the backdrop, the handle and the system back button.
 */
export function Sheet({
  visible, onClose, title, subtitle, children, testID = 'sheet',
}: { visible: boolean; onClose: () => void; title?: string; subtitle?: string; children: ReactNode; testID?: string }) {
  // Unmounted while hidden, so each showing mounts fresh and rises again.
  if (!visible) return null;
  return <SheetFrame onClose={onClose} title={title} subtitle={subtitle} testID={testID}>{children}</SheetFrame>;
}

function SheetFrame({
  onClose, title, subtitle, children, testID,
}: { onClose: () => void; title?: string; subtitle?: string; children: ReactNode; testID: string }) {
  const insets = useSafeAreaInsets();
  const t = useEntrance();
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.bottom}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, space.md) + space.sm },
            { transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [360, 0] }) }] },
          ]}
        >
          <View style={styles.handle} />
          {title ? (
            <View style={styles.sheetHead}>
              <Text variant="title" accessibilityRole="header" numberOfLines={2}>{title}</Text>
              {subtitle ? <Text variant="small" color={colors.muted}>{subtitle}</Text> : null}
            </View>
          ) : null}
          <ScrollView bounces={false} contentContainerStyle={styles.sheetBody} style={styles.sheetScroll}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(6, 30, 32, 0.55)' },
  dialog: {
    width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: space.sm, alignItems: 'stretch',
    ...shadow.raised,
  },
  dialogIcon: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: space.xs,
  },
  actions: { gap: space.sm, marginTop: space.md },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4,
    paddingHorizontal: space.lg + 4, paddingTop: space.sm, maxHeight: '88%', ...shadow.raised,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.md },
  sheetHead: { gap: 2, marginBottom: space.md },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { gap: space.md },
  options: { backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: space.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingVertical: space.sm },
  optionRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
});
