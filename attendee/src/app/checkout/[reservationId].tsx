import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import {
  applyPromo, checkoutResult, claimFree, quote, removePromo, setAddons, startCheckout, type Buyer, type HolderInput,
} from '@/api/endpoints';
import type { Breakdown, Quote } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useNow } from '@/lib/countdown';
import { countdown, eventWhen, money, price } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { Empty, Failed, Header, Stepper } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { PayMarks } from '@/ui/PayMarks';
import { Text } from '@/ui/Text';
import { colors, fonts, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';
const RESULT_POLLS = 10;
const RESULT_GAP_MS = 2000;
const DISCOUNT = /^Discount \((.+)\)$/;

/**
 * Checkout — the mockup's second lower frame: Order Summary (the event, the
 * seats), Subtotal / Fees / Total, Payment Method, Pay Now. Flat rows on
 * white, as drawn.
 *
 * Every amount is the SERVER's quote (GET /reservations/:id/quote); nothing
 * is added up here. What the organizer asks for is asked here too, in the
 * same plain style: extras, a discount code, a name per ticket, "whose guest
 * are you?", the policies they marked, and the terms, signed by typing a name.
 *
 * Paying is Stripe Checkout in an in-app browser (cards, Apple Pay, Google
 * Pay); the app shows Booking Confirmed only after the API says the order
 * exists. A free order is claimed directly.
 */
export default function Checkout() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const user = useSession((s) => s.account?.user);
  const current = useReservation((s) => s.current);
  const qc = useQueryClient();
  const now = useNow(1000);

  const [name, setName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [holders, setHolders] = useState<Record<string, { firstName: string; lastName: string }>>({});
  const [guestOf, setGuestOf] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'paying' | 'confirming'>('idle');
  const [addonQty, setAddonQty] = useState<Record<string, number> | null>(null);
  const [addonBusy, setAddonBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = useQuery({ queryKey: ['quote', reservationId], queryFn: () => quote(reservationId), staleTime: 0, enabled: Boolean(reservationId) });
  const mine = current && current.reservationId === reservationId ? current : null;

  if (addonQty === null && q.data) {
    setAddonQty(Object.fromEntries((q.data.addons ?? []).map((a) => [a.addonId, a.quantity])));
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  if (!mine) {
    return (
      <View style={styles.root}>
        <Header title="Checkout" />
        <Empty icon="clock" title="This hold has ended" body="Your seats went back on sale. Choose them again to book." action="Back to the event" onAction={() => router.back()} />
      </View>
    );
  }
  if (q.isLoading) {
    return (
      <View style={styles.root}>
        <Header title="Checkout" />
        <Container style={{ gap: space.lg, paddingTop: space.md }}>
          <Skeleton height={20} width="40%" /><Skeleton height={68} /><Skeleton height={120} />
        </Container>
      </View>
    );
  }
  if (q.isError || !q.data) {
    const ended = q.error instanceof ApiError && (q.error.code === 'RESERVATION_EXPIRED' || q.error.code === 'RESERVATION_NOT_FOUND');
    return (
      <View style={styles.root}>
        <Header title="Checkout" />
        {ended
          ? <Empty icon="clock" title="This hold has ended" body="Your seats went back on sale. Choose them again to book." action="Back to the event" onAction={() => { useReservation.getState().clear(); router.back(); }} />
          : <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />}
      </View>
    );
  }

  const qd = q.data;
  const hold = mine;
  const left = Date.parse(qd.expiresAt) - now;
  const free = qd.totalCents === 0;
  const slots = qd.holders?.mode && qd.holders.mode !== 'off' ? qd.holders.slots : [];
  const holderRequired = qd.holders?.mode === 'required';
  const promoLine = qd.lines.find((l) => DISCOUNT.test(l.label));
  const promoCode = promoLine ? DISCOUNT.exec(promoLine.label)?.[1] ?? null : null;
  const seatsText = (qd.tickets ?? []).map((t) => `${t.name}${t.quantity > 1 ? ` × ${t.quantity}` : ''}`).join(', ');

  const merge = (b: Breakdown) => qc.setQueryData<Quote>(['quote', reservationId], (old) => (old ? { ...old, ...b } : old));

  function changeAddon(addonId: string, n: number) {
    const nextQty = { ...(addonQty ?? {}), [addonId]: n };
    setAddonQty(nextQty);
    setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setAddonBusy(true);
      setAddons(reservationId, hold.reservationToken, Object.entries(nextQty).map(([id, quantity]) => ({ addonId: id, quantity })))
        .then(merge)
        .catch((err) => { setError(messageFor(err)); setAddonQty(null); void q.refetch(); })
        .finally(() => setAddonBusy(false));
    }, 450);
  }

  function buyer(): Buyer | null {
    if (free ? name.trim().length < 1 : name.trim().length < 2) { setError(free ? 'Enter your first name.' : 'Enter your full name.'); return null; }
    if (!token && !free && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter the email your tickets should go to.'); return null; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('That email does not look right.'); return null; }
    if (phone.trim() && !/^[0-9+\-() ]{7,20}$/.test(phone.trim())) { setError('Enter the phone number with digits only.'); return null; }
    const list: HolderInput[] = slots.map((s, i) => {
      const h = holders[s.key] ?? { firstName: i === 0 ? name.trim().split(/\s+/)[0] ?? '' : '', lastName: '' };
      return { key: s.key, firstName: h.firstName.trim(), lastName: h.lastName.trim() || undefined };
    });
    if (holderRequired && list.some((h) => !h.firstName)) { setError('Add a first name for every ticket.'); return null; }
    if (qd.guestOf?.mode === 'required' && !guestOf) { setError(`Answer “${qd.guestOf.question}” to continue.`); return null; }
    if (!agreed) { setError('Accept the terms to continue.'); return null; }
    return {
      name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined,
      acceptTerms: true, signature: { method: 'typed', name: name.trim() },
      holders: list.length ? list : undefined, guestOfHostId: guestOf,
    };
  }

  async function pay() {
    const b = buyer();
    if (!b) { haptic.error(); return; }
    setError(null);
    setStage('paying');
    try {
      if (free) {
        const r = await claimFree(reservationId, hold.reservationToken, b, token);
        useReservation.getState().clear();
        router.replace({ pathname: '/checkout/confirmed', params: { orderId: r.orderId, count: String(r.ticketCount), title: qd.event.title } });
        return;
      }
      const session = await startCheckout(reservationId, hold.reservationToken, b, token);
      useReservation.getState().setSession(session.sessionId);
      await WebBrowser.openBrowserAsync(session.checkoutUrl, { dismissButtonStyle: 'close', readerMode: false, controlsColor: colors.accent });
      setStage('confirming');
      await confirm(session.sessionId);
    } catch (err) {
      haptic.error();
      setError(messageFor(err));
      setStage('idle');
    }
  }

  async function confirm(sessionId: string) {
    for (let i = 0; i < RESULT_POLLS; i += 1) {
      const r = await checkoutResult(sessionId).catch(() => null);
      if (r?.order) {
        useReservation.getState().clear();
        router.replace({ pathname: '/checkout/confirmed', params: { orderId: r.order.id, title: qd.event.title } });
        return;
      }
      if (r && r.status === 'unpaid' && r.sessionStatus === 'open') break;
      await new Promise((res) => setTimeout(res, RESULT_GAP_MS));
    }
    setStage('idle');
    setError('Payment was not completed. Your seats are still held — you can try again.');
  }

  const low = left < 120_000;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Checkout" />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Container style={{ gap: space.xl }}>
          <View style={styles.timer} accessibilityLiveRegion="polite">
            <Icon name="clock" size={16} color={low ? colors.accent : colors.muted} />
            <Text variant="small" weight="semibold" color={low ? colors.accent : colors.muted}>
              {left > 0 ? `Your seats are held for ${countdown(left)}` : 'Your hold has ended'}
            </Text>
          </View>

          <View>
            <Text variant="title" accessibilityRole="header">Order Summary</Text>
            <View style={styles.event}>
              <Cover uri={qd.event.coverUrl} title={qd.event.title} style={styles.thumb} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title" numberOfLines={2}>{qd.event.title}</Text>
                <Text variant="small">{eventWhen(qd.event.startsAt, qd.event.timezone)}</Text>
              </View>
            </View>
            {seatsText ? (
              <View style={[styles.row, styles.rule]}>
                <Text variant="label" weight="bold" style={styles.rowKey}>{qd.admits > 1 ? 'Tickets' : 'Ticket'}</Text>
                <Text variant="small" style={{ flex: 1 }}>{seatsText}{qd.admits > 1 ? `\n(${qd.admits} tickets)` : ''}</Text>
              </View>
            ) : null}
            {qd.lines.map((l) => (
              <View key={l.label} style={[styles.row, styles.rule]}>
                <Text variant="label" weight="semibold" style={{ flex: 1 }} color={l.amountCents < 0 ? colors.success : colors.text}>{l.label === 'Tickets' ? 'Subtotal' : l.label}</Text>
                <Text variant="small" weight="semibold" color={l.amountCents < 0 ? colors.success : colors.text}>{money(l.amountCents, qd.currency)}</Text>
              </View>
            ))}
            <View style={styles.row}>
              <Text variant="title" style={{ flex: 1 }}>Total</Text>
              <Text variant="title">{free ? 'Free' : money(qd.totalCents, qd.currency)}</Text>
            </View>
            {!free || promoCode ? <Promo code={promoCode} reservationId={reservationId} reservationToken={hold.reservationToken} onQuote={merge} /> : null}
          </View>

          {qd.addonsOffered?.length ? (
            <View>
              <Text variant="title" accessibilityRole="header">Extras{addonBusy ? <Text variant="small" color={colors.muted}>  updating…</Text> : null}</Text>
              {qd.addonsOffered.map((a, i) => {
                const n = addonQty?.[a.id] ?? 0;
                const cap = Math.max(n, Math.min(qd.admits, a.remaining ?? qd.admits));
                return (
                  <View key={a.id} style={[styles.row, i < qd.addonsOffered!.length - 1 && styles.rule]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="label" weight="bold">{a.name}</Text>
                      <Text variant="small" color={colors.muted}>{price(a.priceCents, qd.currency)} each</Text>
                    </View>
                    <Stepper label={`${a.name}, how many`} value={n} max={cap} onChange={(v) => changeAddon(a.id, v)} />
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={{ gap: space.md }}>
            <Text variant="title" accessibilityRole="header">Your Details</Text>
            <Field label={free ? 'First name' : 'Full name'} value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
            {!token ? <Field label={free ? 'Email (optional)' : 'Email for your tickets'} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" /> : null}
            <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
          </View>

          {slots.length ? (
            <View style={{ gap: space.md }}>
              <View style={{ gap: 2 }}>
                <Text variant="title" accessibilityRole="header">Ticket Holders</Text>
                <Text variant="small" color={colors.muted}>{holderRequired ? 'A first name for every ticket.' : 'Optional — printed on each ticket.'}</Text>
              </View>
              {slots.map((s, i) => {
                const h = holders[s.key] ?? { firstName: i === 0 ? name.trim().split(/\s+/)[0] ?? '' : '', lastName: '' };
                const set = (patch: Partial<typeof h>) => setHolders((prev) => ({ ...prev, [s.key]: { ...h, ...patch } }));
                return (
                  <View key={s.key} style={{ gap: space.sm }}>
                    <Text variant="small" weight="bold">{i + 1}. {[s.tierName, s.place].filter(Boolean).join(' · ') || s.title}</Text>
                    <View style={styles.pair}>
                      <View style={{ flex: 1 }}><Field label="First name" value={h.firstName} onChangeText={(v) => set({ firstName: v })} /></View>
                      <View style={{ flex: 1 }}><Field label="Last name" value={h.lastName} onChangeText={(v) => set({ lastName: v })} /></View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {qd.guestOf ? (
            <View style={{ gap: space.sm }}>
              <Text variant="title" accessibilityRole="header">{qd.guestOf.question}</Text>
              <View style={styles.hosts}>
                {qd.guestOf.hosts.map((h) => {
                  const on = guestOf === h.id;
                  return (
                    <Pressable key={h.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { haptic.select(); setGuestOf(on ? null : h.id); }}
                      style={[styles.host, on && styles.hostOn]}>
                      <Text variant="small" weight="semibold" color={on ? colors.white : colors.text}>{h.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {qd.policies?.length ? (
            <View>
              {qd.policies.map((p) => <Policy key={p.id} title={p.title} body={p.body} />)}
            </View>
          ) : null}

          {!free ? (
            <View style={{ gap: space.md }}>
              <Text variant="title" accessibilityRole="header">Payment Method</Text>
              <PayMarks />
            </View>
          ) : null}

          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => { haptic.select(); setAgreed((v) => !v); }} style={styles.agree}>
            <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Icon name="tick" size={15} color={colors.white} strokeWidth={2.8} /> : null}</View>
            <Text variant="small" style={{ flex: 1 }}>
              I agree to the{' '}
              <Text variant="small" weight="bold" color={colors.accent} onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/terms`); }}>Terms</Text>
              {' '}and sign this order as <Text variant="small" weight="bold">{name.trim() || 'my full name'}</Text>.
            </Text>
          </Pressable>

          {error ? <Text variant="small" weight="semibold" color={colors.accent} accessibilityLiveRegion="assertive">{error}</Text> : null}
        </Container>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <Container>
          <Button
            label={stage === 'confirming' ? 'Confirming payment…' : free ? 'Get My Tickets' : 'Pay Now'}
            onPress={() => { void pay(); }}
            busy={stage !== 'idle'}
            disabled={left <= 0 || addonBusy}
          />
        </Container>
      </View>
    </KeyboardAvoidingView>
  );
}

/** A discount code: "Have a discount code?", then a field; applied on the server. */
function Promo({ code, reservationId, reservationToken, onQuote }: {
  code: string | null; reservationId: string; reservationToken: string; onQuote: (b: Breakdown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (text.trim().length < 2) { setError('Enter a discount code.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await applyPromo(reservationId, reservationToken, text.trim());
      haptic.success();
      onQuote(r.quote);
      setText('');
      setOpen(false);
    } catch (err) {
      haptic.error();
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try { onQuote((await removePromo(reservationId, reservationToken)).quote); } catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }

  if (code) {
    return (
      <View style={styles.promoLine}>
        <Icon name="tag" size={16} color={colors.success} />
        <Text variant="small" weight="bold" color={colors.success} style={{ flex: 1 }}>{code} applied</Text>
        <Pressable accessibilityRole="button" onPress={() => { void remove(); }} hitSlop={8} disabled={busy}>
          <Text variant="small" weight="semibold" color={colors.accent}>Remove</Text>
        </Pressable>
      </View>
    );
  }
  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.promoLine} hitSlop={6}>
        <Icon name="tag" size={16} color={colors.accent} />
        <Text variant="small" weight="semibold" color={colors.accent}>Have a discount code?</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: space.xs, marginTop: space.sm }}>
      <View style={styles.promoRow}>
        <TextInput
          value={text}
          onChangeText={(v) => { setText(v.toUpperCase()); setError(null); }}
          placeholder="Discount code"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => { void apply(); }}
          accessibilityLabel="Discount code"
          style={styles.promoInput}
          maxFontSizeMultiplier={1.4}
        />
        <Button label="Apply" size="sm" variant="dark" busy={busy} onPress={() => { void apply(); }} />
      </View>
      {error ? <Text variant="caption" color={colors.accent} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

function Policy({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={[styles.policy, styles.rule]}>
      <View style={styles.policyHead}>
        <Text variant="label" weight="semibold" style={{ flex: 1 }}>{title}</Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} color={colors.subtle} />
      </View>
      {open ? <Text variant="small" color={colors.muted}>{body}</Text> : null}
    </Pressable>
  );
}

const hair = StyleSheet.hairlineWidth * 2;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: space.xs },
  event: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.lg },
  thumb: { width: 76, height: 76, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rule: { borderBottomWidth: hair, borderBottomColor: colors.border },
  rowKey: { width: 80 },
  pair: { flexDirection: 'row', gap: space.sm },
  hosts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  host: { paddingHorizontal: space.lg, minHeight: 40, borderRadius: 999, backgroundColor: colors.bgSunken, justifyContent: 'center' },
  hostOn: { backgroundColor: colors.accent },
  policy: { gap: space.sm, paddingVertical: space.md },
  policyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.8, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  promoLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  promoInput: { flex: 1, minHeight: 44, paddingHorizontal: space.lg, borderRadius: 12, backgroundColor: colors.bgSunken, fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 1, color: colors.text },
  bar: { backgroundColor: colors.surface, paddingTop: space.md, borderTopWidth: hair, borderTopColor: colors.border },
});
