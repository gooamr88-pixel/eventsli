import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, messageFor } from '@/api/client';
import { checkoutResult, claimFree, quote, startCheckout, type Buyer } from '@/api/endpoints';
import { useSession, useToken } from '@/auth/session';
import { countdown, eventWhen, money } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { Card, Empty, Failed, Header, Loading } from '@/ui/bits';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';
const RESULT_POLLS = 10;
const RESULT_GAP_MS = 2000;

/**
 * Checkout (the mockup's second lower frame).
 *
 * The order summary and every amount come from the SERVER's quote
 * (GET /reservations/:id/quote) — the tax, the card fee and the total are
 * worked out there and itemised as the buyer will be charged; nothing is
 * added up here.
 *
 * Paying is Stripe Checkout, the same page the website uses, opened in an
 * in-app browser: cards, Apple Pay and Google Pay all work there, and no card
 * number ever passes through the app. When the browser closes, the app asks
 * the API how the session ended (GET /checkout/:sessionId — which also
 * fulfils the order if Stripe's webhook has not landed yet) and only then
 * says "Booking Confirmed". A free order is claimed directly.
 *
 * The buyer signs by typing their name under the terms, the accessible form
 * the API accepts beside a drawn signature (signatureService).
 */
export default function Checkout() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const insets = useSafeAreaInsets();
  const token = useToken();
  const user = useSession((s) => s.account?.user);
  const current = useReservation((s) => s.current);

  const [name, setName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'paying' | 'confirming'>('idle');
  const [now, setNow] = useState(() => Date.now());

  const q = useQuery({ queryKey: ['quote', reservationId], queryFn: () => quote(reservationId), staleTime: 0 });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const mine = current && current.reservationId === reservationId ? current : null;
  if (!mine) {
    // The hold is in memory only (lib/reservation.ts); an app restart lets it go.
    return (
      <View style={styles.root}>
        <Header title="Checkout" back />
        <Empty icon="clock" title="This hold has ended" body="Your seats went back on sale. Choose them again to book." action="Back to the event" onAction={() => router.back()} />
      </View>
    );
  }
  if (q.isLoading) return <View style={styles.root}><Header title="Checkout" back /><Loading /></View>;
  if (q.isError || !q.data) {
    const ended = q.error instanceof ApiError && (q.error.code === 'RESERVATION_EXPIRED' || q.error.code === 'RESERVATION_NOT_FOUND');
    return (
      <View style={styles.root}>
        <Header title="Checkout" back />
        {ended
          ? <Empty icon="clock" title="This hold has ended" body="Your seats went back on sale. Choose them again to book." action="Back to the event" onAction={() => { useReservation.getState().clear(); router.back(); }} />
          : <Failed message={messageFor(q.error)} onRetry={() => { void q.refetch(); }} />}
      </View>
    );
  }

  const qd = q.data;
  const left = Date.parse(qd.expiresAt) - now;
  const free = qd.totalCents === 0;
  const hold = mine; // narrowed for the closures below

  function buyer(): Buyer | null {
    if (name.trim().length < 2) { setError('Enter your full name.'); return null; }
    if (!token && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter the email your tickets should go to.'); return null; }
    if (!agreed) { setError('Accept the terms to continue.'); return null; }
    return {
      name: name.trim(),
      email: email.trim() || undefined,
      acceptTerms: true,
      signature: { method: 'typed', name: name.trim() },
    };
  }

  async function pay() {
    const b = buyer();
    if (!b) return;
    setError(null);
    setStage('paying');
    try {
      if (free) {
        const r = await claimFree(reservationId, hold.reservationToken, b, token);
        useReservation.getState().clear();
        router.replace({ pathname: '/checkout/confirmed', params: { orderId: r.orderId, count: String(r.ticketCount) } });
        return;
      }
      const session = await startCheckout(reservationId, hold.reservationToken, b, token);
      useReservation.getState().setSession(session.sessionId);
      await WebBrowser.openBrowserAsync(session.checkoutUrl, { dismissButtonStyle: 'close', readerMode: false });
      setStage('confirming');
      await confirm(session.sessionId);
    } catch (err) {
      setError(messageFor(err));
      setStage('idle');
    }
  }

  /** Ask how the Stripe session ended — a few times, while the webhook lands. */
  async function confirm(sessionId: string) {
    for (let i = 0; i < RESULT_POLLS; i += 1) {
      const r = await checkoutResult(sessionId).catch(() => null);
      if (r?.order) {
        useReservation.getState().clear();
        router.replace({ pathname: '/checkout/confirmed', params: { orderId: r.order.id } });
        return;
      }
      // Open = they closed Stripe without paying; nothing was charged.
      if (r && r.status === 'unpaid' && r.sessionStatus === 'open') break;
      await new Promise((res) => setTimeout(res, RESULT_GAP_MS));
    }
    setStage('idle');
    setError('Payment was not completed. Your seats are still held — you can try again.');
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Checkout" back />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.timer, left < 120_000 && styles.timerLow]} accessibilityLiveRegion="polite">
          <Icon name="clock" size={18} color={left < 120_000 ? colors.danger : colors.text} />
          <Text variant="small" weight="semibold" color={left < 120_000 ? colors.danger : colors.text}>
            {left > 0 ? `Seats held for ${countdown(left)}` : 'Your hold has ended'}
          </Text>
        </View>

        <Text variant="title" accessibilityRole="header">Order Summary</Text>
        <Card style={styles.summary}>
          <Cover uri={qd.event.coverUrl} style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text variant="label" weight="bold" numberOfLines={2}>{qd.event.title}</Text>
            <Text variant="caption" color={colors.muted}>{eventWhen(qd.event.startsAt, qd.event.timezone)}</Text>
            {qd.event.venue ? <Text variant="caption" color={colors.muted}>{qd.event.venue}</Text> : null}
          </View>
        </Card>

        <Card style={{ gap: space.sm }}>
          {qd.lines.map((l) => (
            <View key={l.label} style={styles.line}>
              <Text variant="small" color={colors.muted}>{l.label}</Text>
              <Text variant="small">{money(l.amountCents, qd.currency)}</Text>
            </View>
          ))}
          <View style={[styles.line, styles.totalLine]}>
            <Text variant="label" weight="bold">Total</Text>
            <Text variant="title">{money(qd.totalCents, qd.currency)}</Text>
          </View>
        </Card>

        <Text variant="title" accessibilityRole="header">Your details</Text>
        <Field label="Full name" icon="user" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        {!token ? (
          <Field label="Email for your tickets" icon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        ) : null}

        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((v) => !v)} style={styles.agree}>
          <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Icon name="tick" size={16} color={colors.white} /> : null}</View>
          <Text variant="small" style={{ flex: 1 }}>
            I agree to the{' '}
            <Text variant="small" color={colors.accent} onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/terms`); }}>Terms</Text>
            {' '}and sign this order as <Text variant="small" weight="bold">{name.trim() || 'my full name'}</Text>.
          </Text>
        </Pressable>

        {!free ? (
          <View style={styles.methods}>
            <Icon name="lock" size={16} color={colors.muted} />
            <Text variant="caption" color={colors.muted} style={{ flex: 1 }}>
              Pay securely on Stripe with a card, Apple Pay or Google Pay. Your card details never reach Eventsli.
            </Text>
          </View>
        ) : null}

        {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <Button
          label={stage === 'confirming' ? 'Confirming payment…' : free ? 'Get my tickets' : `Pay Now · ${money(qd.totalCents, qd.currency)}`}
          onPress={() => { void pay(); }}
          busy={stage !== 'idle'}
          disabled={left <= 0}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, gap: space.md, paddingBottom: 140 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.sun100 },
  timerLow: { backgroundColor: colors.dangerSoft },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  totalLine: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, marginTop: space.xs, alignItems: 'center' },
  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  methods: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
