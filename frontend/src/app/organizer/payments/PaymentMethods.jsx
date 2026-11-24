'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { del, get, patch, post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useOrganizer } from '../../hooks/useOrganizer';
import { useApi } from '../../hooks/useApi';
import { refreshAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import Field, { SelectField, TextareaField } from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import { CardsArt, BankArt } from '../../components/ui/Illustrations';
import NavIcon from '../../components/shell/NavIcon';
import { PageHeader } from '../../components/ui/Page';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import CreateProfile from '../CreateProfile';
import { OnboardingProgress } from '../OnboardingProgress';
import { useShellFocus } from '../../components/shell/shellFocus';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How an organizer gets paid: Stripe for cards, and manual methods for the rest.
 *
 * The page opens with the ANSWER — what an event of theirs can offer right now,
 * in the same words the create-event screen will use — and then the two ways to
 * change that answer. Every choice on an event comes from here.
 *
 * Stripe's status is re-read from Stripe on every visit, not answered from our
 * flags: onboarding finishes asynchronously, and an account can be restricted
 * later without telling us.
 *
 * `?onboarding=1` is the second step of a new organizer's setup: the progress
 * bar shows, and the page ends in "Continue" rather than leaving them to find
 * the next thing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KINDS = [
  ['e_transfer', 'Interac e-Transfer'],
  ['bank_transfer', 'Bank transfer'],
  ['cash', 'Cash'],
  ['mobile_money', 'Mobile money'],
  ['other', 'Other'],
];
const KIND_LABEL = Object.fromEntries(KINDS);
/** A method's kind, as a list names it. */
const kindName = (kind) => KIND_LABEL[kind];
/** Interac e-Transfer is Canadian; nobody else is offered it for a new method. */
const kindsFor = (country) => KINDS.filter(([kind]) => kind !== 'e_transfer' || country === 'CA');
const PLACEHOLDER = {
  e_transfer: 'Send the total to pay@yourorg.com. Put your order number in the message.',
  bank_transfer: 'Account name, bank, account number or IBAN — and what to write as the reference.',
  cash: 'Pay at the door on the night, or at our box office Mon–Fri 10am–5pm.',
  mobile_money: 'The wallet or number to send to (e.g. Vodafone Cash, M-Pesa, InstaPay), and the name it is under.',
  other: 'Tell buyers exactly how to pay you — a payment link, a pickup point — and to quote their reference.',
};


export default function PaymentMethods() {
  const params = useSearchParams();
  const onboarding = params.get('onboarding') === '1';
  const { loading, organizer, error: orgError, refresh } = useOrganizer();

  if (loading) return <Loading variant="card" />;
  if (orgError) return <ErrorNotice error={orgError} onRetry={refresh} />;
  if (!organizer || !organizer.setupComplete) return <CreateProfile organizer={organizer} onCreated={refresh} />;

  return <PaymentsPage organizer={organizer} onboarding={onboarding} onChanged={refresh} />;
}

function PaymentsPage({ organizer, onboarding, onChanged }) {
  const choices = organizer.payments?.choices || [];
  const nothing = choices.length === 0;
  // Card checkout is not on for their country (utils/markets.js on the API):
  // they sell with their own methods only, and Stripe is not offered at all.
  const cardAvailable = organizer.payments?.cardAvailable !== false;

  // Step 2 of getting set up is a task with its own sticky Back / Continue, so
  // the shell's tab bar stands down for it — the same as step 1 and the wizard.
  // The everyday Payments page is a place and keeps the tabs.
  useShellFocus(onboarding ? { title: 'Set up payments' } : null);

  return (
    <div className={onboarding ? 'es-wizard es-wizard--center' : 'fx-stack'}>
      {onboarding ? (
        <>
          <OnboardingProgress current="payments" />
          <div className="es-wizard__head">
            <h1 className="es-wizard__title">How will buyers pay you?</h1>
            <p className="es-wizard__lede">
              {cardAvailable
                ? 'Connect Stripe for card payments, add a manual method like bank transfer, or both.'
                : 'Add how buyers pay you — bank transfer, cash, mobile money. You confirm each payment when it arrives.'}
              {' '}You can skip this if you only want to list events without selling tickets.
            </p>
          </div>
        </>
      ) : (
        <PageHeader
          icon="card"
          title="Payment methods"
          lede={cardAvailable
            ? 'Accept payments online with cards, or manually — bank transfer, cash or another method of yours. Each event chooses which it takes.'
            : 'Buyers pay you directly — bank transfer, cash, mobile money — and you confirm each payment. Each event chooses which methods it takes.'}
        />
      )}

      {/* Where the account stands, as the page's banner. The same three
          answers the notice gave — none yet, cards, manual, or both. */}
      <section className="es-payintro" data-tone={nothing ? 'warning' : 'info'} aria-labelledby="pay-intro">
        <span className="es-payintro__icon" aria-hidden="true"><NavIcon name={nothing ? 'alert' : 'info'} size={24} /></span>
        <div className="fx-min0">
          <h2 id="pay-intro" className="es-payintro__title">{nothing
            ? 'No payment method yet'
            : organizer.payments.stripeReady && organizer.payments.manualMethods > 0
              ? 'Card and manual payments are ready'
              : organizer.payments.stripeReady ? 'Card payments are ready' : 'Manual payments are ready'}</h2>
          <p className="es-payintro__text">
            {nothing
              ? 'Ticketed events cannot go on sale until you add one. Display-only events do not need any.'
              : organizer.payments.stripeReady && organizer.payments.manualMethods > 0
                ? 'Each ticketed event can take cards, manual payments, or both — you choose when you create it.'
                : organizer.payments.stripeReady
                  ? 'Your events take cards through Stripe. Add a manual method below to also offer bank transfer, cash or another method.'
                  : cardAvailable
                    ? 'Your events take manual payments. Connect Stripe below to also take cards online.'
                    : 'Your events take payments by the methods below. You confirm each one when the money arrives.'}
          </p>
        </div>
        <CardsArt className="es-payintro__art" />
      </section>

      {cardAvailable ? <StripeSection organizer={organizer} onChanged={onChanged} /> : <NoCardNotice offlineCheckout={Boolean(organizer.payments?.offlineCheckout)} />}
      <ManualSection country={organizer.country} offlineCheckout={Boolean(organizer.payments?.offlineCheckout)} onChanged={onChanged} />

      {onboarding && (
        <div className="es-wizard__actions fx-sticky-actions">
          <Link href="/organizer" className="es-btn es-btn--ghost">Back</Link>
          <Link href="/organizer/events/new" className="es-btn es-btn--primary es-btn--lg">
            {nothing ? 'Skip for now' : 'Continue: create your first event'}
            <NavIcon name="arrow" size={18} />
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * In a country where card checkout is not on. Said plainly, once, so nobody
 * hunts for a Stripe button that is not coming — and what to do instead.
 */
function NoCardNotice({ offlineCheckout = false }) {
  return (
    <Notice tone="info" title="Card payments are not available in your country yet.">
      {offlineCheckout ? (
        <p>
          Buyers reserve online and pay you directly with the methods below. You mark each payment received under
          Offline payments, and their tickets are issued then. Unpaid reservations end at their deadline.
        </p>
      ) : (
        <p>
          Buyers cannot pay online for events in your country yet. Sell tickets directly — in person, or by a bank
          transfer or mobile payment you arrange — and record each sale under Door sales; Eventsli issues the
          tickets the moment you record it.
        </p>
      )}
    </Notice>
  );
}

// ─── Stripe ────────────────────────────────────────────────────────────────
export function StripeSection({ organizer, onChanged }) {
  const params = useSearchParams();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Stripe sends the organizer back here: `return` after hosted onboarding,
  // `refresh` when the one-time link expired before they finished.
  const returned = params.get('stripe') === 'return';
  const linkExpired = params.get('stripe') === 'refresh';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/organizer/stripe/status', { cache: 'no-store', noRedirect: true });
        if (cancelled) return;
        setStatus(data);
        setError(null);
        // Stripe may have finished since the organizer profile was read.
        if (data?.canReceivePayouts !== organizer.payments?.stripeReady) {
          refreshAuth();
          onChanged?.();
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
    // Once per visit; `onChanged` re-reads the organizer, which must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { onboardingUrl } = await post('/organizer/stripe/onboard', undefined, { noRedirect: true });
      // A full navigation: Stripe's onboarding is a different origin.
      window.location.assign(onboardingUrl);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const ready = Boolean(status?.canReceivePayouts);
  // An account from the old payment setup, on which Eventsli — not Stripe —
  // would carry the organizer's losses. Checkout refuses it; connecting again
  // creates the organizer's own Stripe account (TECH-AUDIT-LOG T-074).
  const reconnect = Boolean(status?.needsReconnect);
  const label = !status ? 'Checking…' : ready ? 'Connected'
    : reconnect ? 'Reconnect needed' : status.connected ? 'Needs details' : 'Not connected';

  return (
    <section className="es-dcard es-paycard" aria-labelledby="pay-stripe">
      <div className="es-paycard__main">
        <div className="es-paycard__head">
          <span className="es-paytile es-paytile--stripe" aria-hidden="true">S</span>
          <h2 id="pay-stripe" className="es-paycard__title">Stripe</h2>
          <span className="es-status" data-tone={ready ? 'success' : status?.connected ? 'warning' : 'neutral'}>{label}</span>
        </div>
        <p className="es-paycard__desc">
          Accept card payments at checkout. Funds go directly to your Stripe account, and Eventsli never holds your money.
        </p>
        <ul className="es-paycard__checks">
          <li><NavIcon name="tick" size={16} />Credit and debit cards at checkout</li>
          <li><NavIcon name="tick" size={16} />Card details are taken by Stripe, never stored by Eventsli</li>
          <li><NavIcon name="tick" size={16} />Orders confirm themselves the moment a payment succeeds</li>
        </ul>
        {!status && !error && <Loading variant="card" label="Checking with Stripe" />}
        {error && !status && <ErrorNotice error={error} />}

        {linkExpired && status && !ready && (
          <Notice tone="warning" title="Your Stripe link expired before you finished.">
            <p>Nothing you entered is lost. Continue where you left off.</p>
          </Notice>
        )}
        {returned && status && (
          <Notice tone="info" title={ready ? 'Stripe is connected.' : 'Back from Stripe.'}>
            <p>{ready ? 'Your events can take card payments.' : 'Stripe is still checking your details. Anything it still needs is listed below.'}</p>
          </Notice>
        )}

        {status?.paymentsDisabled && (
          <Notice tone="warning" title="Card payments are not switched on for Eventsli yet.">
            <p>You can still add manual payment methods below and build your events.</p>
          </Notice>
        )}

        {reconnect && (
          <Notice tone="warning" title="Reconnect Stripe to keep taking card payments.">
            <p>
              Eventsli now sets you up with your own Stripe account: you are the seller, payments go
              straight to you, and you handle refunds and disputes in your Stripe Dashboard. Your
              current connection uses the old setup, so card checkout is paused until you reconnect.
              It takes about five minutes; your events and past orders are not affected.
            </p>
          </Notice>
        )}

        {status && !status.paymentsDisabled && !ready && (
          <div className="fx-stack fx-stack--sm">
            <p className="text-sm text-muted">
              {reconnect
                ? 'You will be taken to Stripe to set up your own account.'
                : status.connected
                  ? 'Your Stripe account exists but is not ready to receive money yet.'
                  : 'You will be taken to Stripe to enter your business and bank details. It takes about five minutes.'}
            </p>
            {status.requirements?.length > 0 && (
              <div className="fx-stack fx-stack--sm gap-1">
                <p className="text-sm text-ink">Stripe still needs:</p>
                <ul className="list-disc pl-5 text-sm text-muted">
                  {status.requirements.map((r) => <li key={r}>{humanise(r)}</li>)}
                </ul>
              </div>
            )}
            {status.pendingVerification?.length > 0 && (
              <p className="text-sm text-muted">Stripe is checking {status.pendingVerification.length} item(s). Nothing to do — this can take a day.</p>
            )}
            <FormError error={error} />
            <div className="fx-row gap-2">
              <button type="button" onClick={connect} disabled={busy} className="es-btn es-btn--primary">
                <NavIcon name="link" size={18} />
                {busy ? 'Opening Stripe…' : reconnect ? 'Reconnect Stripe' : status.connected ? 'Continue with Stripe' : 'Connect Stripe'}
              </button>
              <a href="https://stripe.com/connect" target="_blank" rel="noopener noreferrer" className="es-btn es-btn--secondary">
                <NavIcon name="external" size={18} />Learn more<span className="sr-only"> about Stripe (opens in a new tab)</span>
              </a>
            </div>
          </div>
        )}

        {ready && (
          <p className="fx-row flex-nowrap items-start text-sm text-muted">
            <span className="shrink-0 text-accent"><NavIcon name="check" size={18} /></span>
            <span className="fx-min0">Ready to take card payments. If Stripe ever needs more from you, it shows up here.</span>
          </p>
        )}
      </div>
      <CardsArt label="Stripe" className="es-paycard__art" />
    </section>
  );
}

// ─── Manual methods ────────────────────────────────────────────────────────
function ManualSection({ country, offlineCheckout = false, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, reload } = useApi('/organizer/payment-methods');
  const methods = data ? (Array.isArray(data) ? data : []) : null;
  const [editing, setEditing] = useState(null);   // null | 'new' | method id

  async function changed(message) {
    setEditing(null);
    await reload();
    onChanged?.();
    if (message) toast.success(message);
  }

  async function toggle(method) {
    try {
      await patch(`/organizer/payment-methods/${method.id}`, { isActive: !method.isActive }, { noRedirect: true });
      changed(method.isActive ? 'Hidden from new checkouts.' : 'Switched back on.');
    } catch (err) {
      // `messageFor` rather than the raw message: a dropped connection has no
      // useful `message`, and "Could not update it." does not say whether to
      // retry. It still prefers the server's sentence where there is one.
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function remove(method) {
    const ok = await confirm({
      title: `Remove “${method.label}”?`,
      body: <p>Events that take manual payments will stop showing it. If it was your only manual method, those events cannot go on sale until you add another.</p>,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await del(`/organizer/payment-methods/${method.id}`, { noRedirect: true });
      changed('Payment method removed.');
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <section className="es-dcard es-paycard" aria-labelledby="pay-manual">
      <div className="es-paycard__main">
        <div className="es-paycard__head">
          <span className="es-paytile" aria-hidden="true"><NavIcon name="bank" size={24} /></span>
          <h2 id="pay-manual" className="es-paycard__title">Manual payments</h2>
          <span className="es-paycard__chip">Optional</span>
        </div>
        <p className="es-paycard__desc">Payments buyers make to you directly, outside Eventsli — bank transfer, cash, mobile money{country === 'CA' ? ' or e-Transfer' : ''}.</p>
        <ul className="es-paycard__checks">
          {/* What is TRUE, not what is planned: with offline checkout on
              (phase 2) buyers see these instructions when they reserve;
              without it, nobody sees them and sales go under Door sales. */}
          {offlineCheckout ? (
            <>
              <li><NavIcon name="tick" size={16} />Shown to buyers who reserve online, with a reference to quote</li>
              <li><NavIcon name="tick" size={16} />You mark each payment received under Offline payments; the tickets are issued then</li>
            </>
          ) : (
            <>
              <li><NavIcon name="tick" size={16} />Take payment yourself — in person, by bank transfer or mobile money</li>
              <li><NavIcon name="tick" size={16} />Record each sale under Door sales (seated events); the tickets are issued when you do</li>
            </>
          )}
        </ul>
        {error && <ErrorNotice error={error} />}
        {!methods && !error && <Loading variant="list" rows={2} label="Loading manual methods" />}


        {methods && methods.length > 0 && (
          <ul className="fx-stack fx-stack--sm">
            {methods.map((m) => (
              <li key={m.id}>
                {editing === m.id ? (
                  <MethodForm method={m} country={country} onCancel={() => setEditing(null)} onSaved={() => changed('Saved.')} />
                ) : (
                  <div className="es-method" data-active={m.isActive}>
                    <span className="es-method__icon"><NavIcon name={m.kind === 'cash' ? 'cash' : 'bank'} size={20} /></span>
                    <div className="es-method__body">
                      <p className="fx-row gap-2 text-ink">
                        <span className="font-medium">{m.label}</span>
                        {kindName(m.kind) !== m.label && <span className="text-xs text-subtle">{kindName(m.kind)}</span>}
                        {!m.isActive && <span className="es-optional">Off</span>}
                        {m.requireProof && <span className="es-pill es-pill--accent"><NavIcon name="receipt" size={12} /> Receipt required</span>}
                      </p>
                      <p className="fx-break whitespace-pre-line text-sm text-muted">{m.instructions}</p>
                    </div>
                    <div className="es-method__actions">
                      <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(m.id)}>
                        <NavIcon name="pencil" size={16} /> Edit<span className="sr-only"> {m.label}</span>
                      </button>
                      <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle(m)}>
                        {m.isActive ? 'Turn off' : 'Turn on'}
                      </button>
                      <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => remove(m)}>
                        <NavIcon name="trash" size={16} /> Remove<span className="sr-only"> {m.label}</span>
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {editing === 'new' ? (
          <MethodForm country={country} onCancel={() => setEditing(null)} onSaved={() => changed('Manual payment method added.')} />
        ) : methods && (
          <div>
            <button type="button" className="es-btn es-btn--secondary" onClick={() => setEditing('new')}>
              <NavIcon name="plus" size={18} /> Add manual payment method
            </button>
          </div>
        )}
      </div>
      <BankArt className="es-paycard__art" />
    </section>
  );
}

function MethodForm({ method = null, country, onCancel, onSaved }) {
  const firstKind = country === 'CA' ? 'e_transfer' : 'bank_transfer';
  // An existing method keeps its own kind on offer, even an e-Transfer outside Canada.
  const kinds = method ? KINDS.filter(([k]) => k === method.kind || kindsFor(country).some(([c]) => c === k)) : kindsFor(country);
  const [form, setForm] = useState(() => ({
    kind: method?.kind || firstKind,
    label: method?.label || KIND_LABEL[firstKind],
    instructions: method?.instructions || '',
    // The organizer decides (2026-11-24). A new transfer-type method starts
    // on — a transfer always leaves a receipt — and cash starts off.
    requireProof: method ? method.requireProof === true : firstKind !== 'cash',
  }));
  const [proofTouched, setProofTouched] = useState(Boolean(method));
  const [labelTouched, setLabelTouched] = useState(Boolean(method));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setKind = (e) => {
    const kind = e.target.value;
    setForm((f) => ({
      ...f, kind,
      ...(labelTouched ? {} : { label: kind === 'other' ? '' : KIND_LABEL[kind] }),
      ...(proofTouched ? {} : { requireProof: kind !== 'cash' }),
    }));
  };
  const ready = form.label.trim().length >= 2 && form.instructions.trim().length >= 5;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const body = { kind: form.kind, label: form.label.trim(), instructions: form.instructions.trim(), requireProof: form.requireProof };
    try {
      if (method) await patch(`/organizer/payment-methods/${method.id}`, body, { noRedirect: true });
      else await post('/organizer/payment-methods', body, { noRedirect: true });
      onSaved?.();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-border-base bg-bg-sunken p-4">
      <p className="font-medium text-ink">{method ? 'Edit payment method' : 'New manual payment method'}</p>
      <SelectField label="Type" required value={form.kind} onChange={setKind} options={kinds} />
      <Field
        label="Name buyers see" required minLength={2} maxLength={80}
        value={form.label}
        onChange={(e) => { setLabelTouched(true); setForm((f) => ({ ...f, label: e.target.value })); }}
      />
      <TextareaField
        label="Instructions for buyers" required minLength={5} maxLength={1000} rows={3}
        placeholder={PLACEHOLDER[form.kind]}
        hint="Exactly how to pay you. Do not include passwords or card numbers."
        value={form.instructions}
        onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
      />
      <label className="es-check">
        <input
          type="checkbox" className="es-check__box" checked={form.requireProof}
          onChange={(e) => { setProofTouched(true); setForm((f) => ({ ...f, requireProof: e.target.checked })); }}
        />
        <span className="text-sm">
          <span className="block font-medium text-ink">Buyers must upload a receipt</span>
          <span className="block text-muted">
            {form.requireProof
              ? 'A buyer paying this way uploads a photo or screenshot of the transfer before they can finish. You see it beside the reservation.'
              : 'Uploading a receipt is optional for buyers paying this way.'}
          </span>
        </span>
      </label>
      <FormError error={error} />
      <div className="fx-row">
        <SubmitButton busy={busy} busyLabel="Saving…" disabled={!ready}>{method ? 'Save' : 'Add method'}</SubmitButton>
        <button type="button" className="es-btn es-btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Stripe's requirement keys land in front of a person; split and sentence-case them. */
function humanise(key) {
  return String(key)
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID');
}
