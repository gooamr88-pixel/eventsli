import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { ApiError, messageFor } from '@/api/client';
import {
  applyPromo, checkoutResult, claimFree, quote, removePromo, setAddons, startCheckout, type Buyer, type HolderInput,
} from '@/api/endpoints';
import type { Breakdown, Quote } from '@/api/types';
import { useSession, useToken } from '@/auth/session';
import { useNow } from '@/lib/countdown';
import { countdown, eventWhen, money, price } from '@/lib/format';
import { useReservation } from '@/lib/reservation';
import { Card, Divider, Empty, Failed, Header, Stepper } from '@/ui/bits';
import { BottomBar } from '@/ui/BottomBar';
import { Button } from '@/ui/Button';
import { Cover } from '@/ui/Cover';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container, useLayout } from '@/ui/layout';
import { haptic, Skeleton } from '@/ui/motion';
import { PayMarks } from '@/ui/PayMarks';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, shadow, space } from '@/ui/theme';

const SITE = 'https://eventsli.com';
const RESULT_POLLS = 10;
const RESULT_GAP_MS = 2000;
const DISCOUNT = /^Discount \((.+)\)$/;

/**
 * Checkout (the mockup's second lower frame).
 *
 * The order summary and every amount come from the SERVER's quote
 * (GET /reservations/:id/quote) — the tax, the discount, the card fee and the
 * total are worked out there and itemised as the buyer will be charged;
 * nothing is added up here. Choosing an add-on or a promo code sends the
 * change and shows the quote the server answers with.
 *
 * What the organizer asks for is asked here, as on the website: a name for
 * each ticket (`holders`), "whose guest are you?" (`guestOf`), and the
 * policies they marked "show at checkout" — before any money moves.
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
  const token = useToken();
  const user = useSession((s) => s.account?.user);
  const current = useReservation((s) => s.current);
  const qc = useQueryClient();
  const now = useNow(1000);
  const { wide } = useLayout();

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

  // The add-on steppers start from what the hold already carries.
  if (addonQty === null && q.data) {
    setAddonQty(Object.fromEntries((q.data.addons ?? []).map((a) => [a.addonId, a.quantity])));
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  if (!mine) {
    // The hold is in memory only (lib/reservation.ts); an app restart lets it go.
    return (
      <View style={styles.root}>
        <Header title="Checkout" />
        <Empty icon="clock" title="This hold has ended" body="Your seats went back on sale. Choose them again to book." action="Back to the event" onAction={() => router.back()} />
      </View>
    );
  }
  if (q.isLoading) return <CheckoutSkeleton />;
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
  const hold = mine; // narrowed for the closures below
  const left = Date.parse(qd.expiresAt) - now;
  const free = qd.totalCents === 0;
  const slots = qd.holders?.mode && qd.holders.mode !== 'off' ? qd.holders.slots : [];
  const holderRequired = qd.holders?.mode === 'required';
  const promoLine = qd.lines.find((l) => DISCOUNT.test(l.label));
  const promoCode = promoLine ? DISCOUNT.exec(promoLine.label)?.[1] ?? null : null;

  /** The server's new breakdown, merged into the cached quote. */
  const merge = (b: Breakdown) => qc.setQueryData<Quote>(['quote', reservationId], (old) => (old ? { ...old, ...b } : old));

  function changeAddon(addonId: string, n: number) {
    const nextQty = { ...(addonQty ?? {}), [addonId]: n };
    setAddonQty(nextQty);
    setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // One request after the taps settle, carrying the WHOLE choice.
    saveTimer.current = setTimeout(() => {
      setAddonBusy(true);
      const lines = Object.entries(nextQty).map(([id, quantity]) => ({ addonId: id, quantity }));
      setAddons(reservationId, hold.reservationToken, lines)
        .then(merge)
        .catch((err) => { setError(messageFor(err)); setAddonQty(null); void q.refetch(); })
        .finally(() => setAddonBusy(false));
    }, 450);
  }

  function buyer(): Buyer | null {
    if (free ? name.trim().length < 1 : name.trim().length < 2) { setError(free ? 'Enter your first name.' : 'Enter your full name.'); return null; }
    if (!token && !free && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter the email your tickets should go to.'); return null; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('That email does not look right.'); return null; }
    if (phone.trim() && !/^[0-9+\-() ]{7,20}$/.test(phone.trim())) { setError('Enter the phone number with digits only, like +20 100 123 4567.'); return null; }
    const list: HolderInput[] = slots.map((s, i) => {
      const h = holders[s.key] ?? { firstName: i === 0 ? name.trim().split(/\s+/)[0] ?? '' : '', lastName: '' };
      return { key: s.key, firstName: h.firstName.trim(), lastName: h.lastName.trim() || undefined };
    });
    if (holderRequired && list.some((h) => !h.firstName)) { setError('Add a first name for every ticket.'); return null; }
    if (qd.guestOf?.mode === 'required' && !guestOf) { setError(`Answer “${qd.guestOf.question}” to continue.`); return null; }
    if (!agreed) { setError('Accept the terms to continue.'); return null; }
    return {
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      acceptTerms: true,
      signature: { method: 'typed', name: name.trim() },
      holders: list.length ? list : undefined,
      guestOfHostId: guestOf,
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

  /** Ask how the Stripe session ended — a few times, while the webhook lands. */
  async function confirm(sessionId: string) {
    for (let i = 0; i < RESULT_POLLS; i += 1) {
      const r = await checkoutResult(sessionId).catch(() => null);
      if (r?.order) {
        useReservation.getState().clear();
        router.replace({ pathname: '/checkout/confirmed', params: { orderId: r.order.id, title: qd.event.title } });
        return;
      }
      // Open = they closed Stripe without paying; nothing was charged.
      if (r && r.status === 'unpaid' && r.sessionStatus === 'open') break;
      await new Promise((res) => setTimeout(res, RESULT_GAP_MS));
    }
    setStage('idle');
    setError('Payment was not completed. Your seats are still held — you can try again.');
  }

  const summary = (
    <View style={{ gap: space.md }}>
      <Card style={styles.summary}>
        <Cover uri={qd.event.coverUrl} title={qd.event.title} style={styles.thumb} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight="bold" numberOfLines={2}>{qd.event.title}</Text>
          <Text variant="caption" color={colors.muted}>{eventWhen(qd.event.startsAt, qd.event.timezone)}</Text>
          {qd.event.venue ? <Text variant="caption" color={colors.muted} numberOfLines={1}>{qd.event.venue}</Text> : null}
        </View>
      </Card>

      <Card style={{ gap: space.sm }}>
        {(qd.tickets ?? []).map((t) => (
          <View key={t.key} style={styles.line}>
            <Text variant="small" style={{ flex: 1 }}>{t.name} <Text variant="small" color={colors.muted}>× {t.quantity}</Text></Text>
            <Text variant="small" weight="semibold">{money(t.unitPriceCents * t.quantity, qd.currency)}</Text>
          </View>
        ))}
        {qd.tickets?.length ? <Divider style={{ marginVertical: space.xs }} /> : null}
        {qd.lines.map((l) => (
          <View key={l.label} style={styles.line}>
            <Text variant="small" color={l.amountCents < 0 ? colors.success : colors.muted} style={{ flex: 1 }}>{l.label}</Text>
            <Text variant="small" color={l.amountCents < 0 ? colors.success : colors.text}>{money(l.amountCents, qd.currency)}</Text>
          </View>
        ))}
        <View style={[styles.line, styles.totalLine]}>
          <Text variant="label" weight="bold">Total</Text>
          <Text variant="heading">{free ? 'Free' : money(qd.totalCents, qd.currency)}</Text>
        </View>
      </Card>

      {!free || promoCode ? (
        <Promo code={promoCode} reservationId={reservationId} reservationToken={hold.reservationToken} onQuote={merge} />
      ) : null}
    </View>
  );

  const form = (
    <View style={{ gap: space.xl }}>
      {qd.addonsOffered?.length ? (
        <View style={{ gap: space.sm }}>
          <View style={styles.sectionHead}>
            <Text variant="title" accessibilityRole="header">Make it special</Text>
            {addonBusy ? <Text variant="caption" color={colors.muted}>Updating…</Text> : null}
          </View>
          {qd.addonsOffered.map((a) => {
            const n = addonQty?.[a.id] ?? 0;
            const cap = Math.max(n, Math.min(qd.admits, a.remaining ?? qd.admits));
            return (
              <View key={a.id} style={[styles.addon, n > 0 && styles.addonOn]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label" weight="bold">{a.name}</Text>
                  {a.description ? <Text variant="caption" color={colors.muted} numberOfLines={2}>{a.description}</Text> : null}
                  <Text variant="small" weight="semibold" color={colors.accent}>{price(a.priceCents, qd.currency)} each</Text>
                  {a.remaining !== null && a.remaining <= 0 && n === 0 ? <Text variant="caption" color={colors.danger}>Sold out</Text> : null}
                </View>
                <Stepper label={`${a.name}, how many`} value={n} max={cap} onChange={(v) => changeAddon(a.id, v)} />
              </View>
            );
          })}
          <Text variant="caption" color={colors.muted}>Up to one of each per ticket.</Text>
        </View>
      ) : null}

      <View style={{ gap: space.md }}>
        <Text variant="title" accessibilityRole="header">Your details</Text>
        <Field label={free ? 'First name' : 'Full name'} icon="user" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        {!token ? (
          <Field label={free ? 'Email (optional)' : 'Email for your tickets'} icon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        ) : null}
        <Field label="Phone (optional)" icon="chat" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+20 100 123 4567" />
      </View>

      {slots.length ? (
        <View style={{ gap: space.md }}>
          <View style={{ gap: 2 }}>
            <Text variant="title" accessibilityRole="header">Who is each ticket for?</Text>
            <Text variant="small" color={colors.muted}>{holderRequired ? 'The organizer asks for a first name on every ticket.' : 'Optional — the name is printed on the ticket.'}</Text>
          </View>
          {slots.map((s, i) => {
            const h = holders[s.key] ?? { firstName: i === 0 ? name.trim().split(/\s+/)[0] ?? '' : '', lastName: '' };
            const set = (patch: Partial<typeof h>) => setHolders((prev) => ({ ...prev, [s.key]: { ...h, ...patch } }));
            return (
              <Card key={s.key} style={{ gap: space.sm }}>
                <View style={styles.slotHead}>
                  <View style={styles.slotNum}><Text variant="caption" weight="bold" color={colors.white}>{i + 1}</Text></View>
                  <Text variant="label" weight="bold" style={{ flex: 1 }}>{[s.tierName, s.place].filter(Boolean).join(' · ') || s.title}</Text>
                </View>
                <View style={styles.pair}>
                  <View style={{ flex: 1 }}><Field label="First name" value={h.firstName} onChangeText={(v) => set({ firstName: v })} autoComplete="off" /></View>
                  <View style={{ flex: 1 }}><Field label="Last name" value={h.lastName} onChangeText={(v) => set({ lastName: v })} autoComplete="off" /></View>
                </View>
              </Card>
            );
          })}
        </View>
      ) : null}

      {qd.guestOf ? (
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">{qd.guestOf.question}</Text>
          {qd.guestOf.mode === 'optional' ? <Text variant="small" color={colors.muted}>Optional</Text> : null}
          <View style={styles.hosts} accessibilityRole="radiogroup">
            {qd.guestOf.hosts.map((h) => {
              const on = guestOf === h.id;
              return (
                <Pressable key={h.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { haptic.select(); setGuestOf(on ? null : h.id); }}
                  style={[styles.host, on && styles.hostOn]}>
                  <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                  <Text variant="label" weight={on ? 'bold' : 'medium'}>{h.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {qd.policies?.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">Before you book</Text>
          {qd.policies.map((p) => <Policy key={p.id} title={p.title} body={p.body} />)}
        </View>
      ) : null}

      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => { haptic.select(); setAgreed((v) => !v); }} style={styles.agree}>
        <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Icon name="tick" size={16} color={colors.white} strokeWidth={2.6} /> : null}</View>
        <Text variant="small" style={{ flex: 1 }}>
          I agree to the{' '}
          <Text variant="small" weight="semibold" color={colors.accent} onPress={() => { void WebBrowser.openBrowserAsync(`${SITE}/terms`); }}>Terms</Text>
          {' '}and sign this order as <Text variant="small" weight="bold">{name.trim() || 'my full name'}</Text>.
        </Text>
      </Pressable>
      {agreed && name.trim() ? (
        <Animated.View entering={FadeInDown.duration(200)} style={styles.signature} accessible accessibilityLabel={`Signed ${name.trim()}`}>
          <Text style={styles.signed}>{name.trim()}</Text>
          <Text variant="caption" color={colors.muted}>Signed {new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
        </Animated.View>
      ) : null}

      {!free ? (
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">Payment Method</Text>
          <PayMarks />
          <View style={styles.methods}>
            <Icon name="lock" size={16} color={colors.muted} />
            <Text variant="caption" color={colors.muted} style={{ flex: 1 }}>
              You pay on Stripe&apos;s secure page. Your card details never reach Eventsli.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );

  const payLabel = stage === 'confirming' ? 'Confirming payment…' : free ? 'Get my tickets' : `Pay Now · ${money(qd.totalCents, qd.currency)}`;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Checkout" />
      <ScrollView contentContainerStyle={{ paddingTop: space.md, paddingBottom: wide ? space.xxl : 160 }} keyboardShouldPersistTaps="handled">
        <Container style={{ gap: space.lg }}>
          <Timer left={left} heldForMs={qd.heldForMs} />
          {wide ? (
            <View style={styles.columns}>
              <View style={{ flex: 1 }}>{form}</View>
              <View style={styles.sideCol}>
                <Text variant="title" accessibilityRole="header">Order Summary</Text>
                {summary}
                {error ? <ErrorNote text={error} /> : null}
                <Button label={payLabel} onPress={() => { void pay(); }} busy={stage !== 'idle'} disabled={left <= 0 || addonBusy} />
              </View>
            </View>
          ) : (
            <>
              <Text variant="title" accessibilityRole="header">Order Summary</Text>
              {summary}
              {form}
              {error ? <ErrorNote text={error} /> : null}
            </>
          )}
        </Container>
      </ScrollView>

      {!wide ? (
        <BottomBar>
          <Button label={payLabel} onPress={() => { void pay(); }} busy={stage !== 'idle'} disabled={left <= 0 || addonBusy} icon={free ? 'ticket' : 'lock'} />
        </BottomBar>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** "Seats held for 12:04", with a ring that empties as the hold runs out. */
function Timer({ left, heldForMs }: { left: number; heldForMs: number | null }) {
  const low = left < 120_000;
  const frac = heldForMs ? Math.max(0, Math.min(1, left / heldForMs)) : null;
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <View style={[styles.timer, low && styles.timerLow]} accessibilityLiveRegion="polite"
      accessibilityLabel={left > 0 ? `Seats held for ${countdown(left)}` : 'Your hold has ended'}>
      <Svg width={36} height={36} viewBox="0 0 36 36" accessible={false}>
        <Circle cx={18} cy={18} r={r} stroke={low ? colors.dangerHalo : 'rgba(17,16,24,0.08)'} strokeWidth={4} fill="none" />
        {frac !== null ? (
          <Circle cx={18} cy={18} r={r} stroke={low ? colors.danger : colors.accent} strokeWidth={4} fill="none"
            strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" transform="rotate(-90 18 18)" />
        ) : null}
      </Svg>
      <View style={{ flex: 1 }}>
        <Text variant="small" weight="bold" color={low ? colors.danger : colors.text}>
          {left > 0 ? `Seats held for ${countdown(left)}` : 'Your hold has ended'}
        </Text>
        <Text variant="caption" color={colors.muted}>{left > 0 ? 'Finish before the timer runs out to keep them.' : 'Go back and choose your seats again.'}</Text>
      </View>
    </View>
  );
}

/** A discount code: applied on the server, shown as a chip once it is. */
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
    try {
      const r = await removePromo(reservationId, reservationToken);
      onQuote(r.quote);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <View style={styles.promoOn}>
        <Icon name="tag" size={18} color={colors.success} />
        <Text variant="small" weight="bold" color={colors.success} style={{ flex: 1 }}>{code} applied</Text>
        <Pressable accessibilityRole="button" onPress={() => { void remove(); }} hitSlop={8} disabled={busy}>
          <Text variant="small" weight="semibold" color={colors.accent}>{busy ? 'Removing…' : 'Remove'}</Text>
        </Pressable>
      </View>
    );
  }
  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.promoLink} hitSlop={6}>
        <Icon name="tag" size={18} color={colors.accent} />
        <Text variant="small" weight="semibold" color={colors.accent}>Have a discount code?</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.promoRow}>
        <TextInput
          value={text}
          onChangeText={(v) => { setText(v.toUpperCase()); setError(null); }}
          placeholder="DISCOUNT CODE"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => { void apply(); }}
          accessibilityLabel="Discount code"
          style={styles.promoInput}
          maxFontSizeMultiplier={1.6}
        />
        <Button label="Apply" size="sm" variant="dark" busy={busy} onPress={() => { void apply(); }} />
      </View>
      {error ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

function Policy({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={styles.policy}>
      <View style={styles.policyHead}>
        <Icon name="fileText" size={18} color={colors.muted} />
        <Text variant="label" weight="semibold" style={{ flex: 1 }}>{title}</Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} color={colors.subtle} />
      </View>
      {open ? <Text variant="small" color={colors.muted}>{body}</Text> : null}
    </Pressable>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <Animated.View entering={FadeInDown.duration(180)} style={styles.error}>
      <Icon name="alert" size={18} color={colors.danger} />
      <Text variant="small" color={colors.danger} style={{ flex: 1 }} accessibilityLiveRegion="assertive">{text}</Text>
    </Animated.View>
  );
}

function CheckoutSkeleton() {
  return (
    <View style={styles.root}>
      <Header title="Checkout" />
      <Container style={{ gap: space.md, paddingTop: space.md }}>
        <Skeleton height={60} round={radius.lg} />
        <Skeleton height={96} round={radius.lg} />
        <Skeleton height={160} round={radius.lg} />
        <Skeleton height={52} round={radius.md} />
        <Skeleton height={52} round={radius.md} />
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl },
  sideCol: { width: 380, gap: space.md },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.sun100 },
  timerLow: { backgroundColor: colors.dangerSoft },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  totalLine: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addon: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  addonOn: { borderColor: colors.accent, backgroundColor: colors.coral50 },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  slotNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  pair: { flexDirection: 'row', gap: space.sm },
  hosts: { gap: space.sm },
  host: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  hostOn: { borderColor: colors.accent, backgroundColor: colors.coral50 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  policy: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  policyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.xs },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  signature: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: 2 },
  signed: { fontFamily: fonts.displayBold, fontStyle: 'italic', fontSize: 26, lineHeight: 32, color: colors.night },
  methods: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  promoLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', minHeight: 36 },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  promoInput: {
    flex: 1, minHeight: 46, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.fieldBorder,
    backgroundColor: colors.surface, fontFamily: fonts.bold, fontSize: 15, letterSpacing: 1.2, color: colors.text,
  },
  promoOn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: '#bfe5cc' },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, ...shadow.card },
});
