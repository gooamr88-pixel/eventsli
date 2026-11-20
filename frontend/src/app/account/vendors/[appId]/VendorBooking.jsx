'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { post, patch } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { formatEventTime } from '../../../lib/eventTime';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import Field, { TextareaField } from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { AgreementText, LogoField } from '../../../components/sponsors/sponsorUi';
import { VendorStatus } from '../../../components/vendors/vendorUi';
import SignatureDialog from '../../../checkout/[reservationId]/SignatureDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE VENDOR BOOKING, AS THE VENDOR SEES IT (2026-11-20).
 *
 *   applied    the application as sent; withdraw it
 *   offered    the space, fee, booth number, passes and terms; accept by
 *              signing (the same signature step as the checkout), or withdraw
 *   accepted   pay the booth fee — by card on the organizer's own Stripe
 *              account, or by their offline instructions; name staff for the
 *              door; set the logo and description for the vendor list
 *
 * Back from Stripe (`?paid=1`) the webhook records the payment a moment later;
 * the page says so and looks again rather than claiming it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VendorBooking({ appId }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const app = useApi(`/partner/vendors/${appId}`);
  const returning = Boolean(useSearchParams().get('paid'));
  useEffect(() => {
    if (!returning) return undefined;
    let n = 0;
    const timer = setInterval(() => { n += 1; app.reload(); if (n >= 5) clearInterval(timer); }, 3000);
    return () => clearInterval(timer);
  }, [returning]); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  if (app.error) return <ErrorNotice error={app.error} onRetry={app.reload} />;
  if (!app.data) return <Loading variant="card" label="Loading your booking" />;
  const a = app.data;
  const tz = a.event?.timezone;
  const canWithdraw = ['submitted', 'waitlisted', 'offered'].includes(a.stage);

  async function withdraw() {
    const ok = await confirm({
      title: 'Withdraw your application?', tone: 'danger', confirmLabel: 'Withdraw',
      body: <p>The organizer is told you are no longer interested. You cannot undo this; you would need to apply again.</p>,
    });
    if (!ok) return;
    try {
      await post(`/partner/vendors/${appId}/withdraw`, {}, { noRedirect: true });
      toast.success('Application withdrawn.');
      app.reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      <Link href="/account/vendors" className="es-sp-back"><NavIcon name="arrow" size={16} />All vendor bookings</Link>

      <header className="es-sp-dealhead">
        {a.event?.coverUrl
          // eslint-disable-next-line @next/next/no-img-element -- the event's poster
          ? <img src={a.event.coverUrl} alt="" className="es-sp-dealhead__logo es-sp-dealhead__logo--cover" />
          : <span className="es-sp-dealhead__initial" aria-hidden="true"><NavIcon name="calendar" size={24} /></span>}
        <div className="fx-min0">
          <p className="text-sm text-muted">Vendor at</p>
          <h1 className="es-section-title fx-break">{a.event?.title}</h1>
          <p className="es-sp-dealhead__meta">
            <VendorStatus status={a.status} self expired={a.expired} />
            <span>{a.businessName}</span>
            {a.event?.startsAt && <span>{formatEventTime(a.event.startsAt, tz)}</span>}
          </p>
        </div>
        <div className="es-sp-dealhead__actions">
          {a.event?.slug && <a className="es-btn es-btn--ghost es-btn--sm" href={`/e/${a.event.slug}`} target="_blank" rel="noreferrer"><NavIcon name="external" size={16} />Event page</a>}
          {canWithdraw && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={withdraw}>Withdraw</button>}
        </div>
      </header>

      {returning && !a.paidAt && (
        <Notice tone="info" title="Recording your payment…"><p>Your card payment went to the organizer. It shows here as soon as Stripe confirms it — usually within a minute.</p></Notice>
      )}
      {returning && a.paidAt && (
        <Notice tone="info" icon="check" title="Booth fee received. You are booked in!"><p>A receipt is on its way to your email. Add your staff below so they are on the door list.</p></Notice>
      )}
      {(a.stage === 'submitted' || a.stage === 'waitlisted') && (
        <Notice tone="info" title={a.stage === 'waitlisted' ? 'You are on the waitlist.' : 'Your application is with the organizer.'}>
          <p>If they offer you a space you will get an email, and it will appear here to accept.</p>
        </Notice>
      )}
      {a.expired && (
        <Notice tone="warning" title="This offer has expired."><p>Ask {a.event?.organizerName || 'the organizer'} to send it again.</p></Notice>
      )}
      {['rejected', 'cancelled', 'withdrawn'].includes(a.stage) && (
        <Notice tone="neutral" title={a.stage === 'cancelled' ? 'This booking was cancelled.' : a.stage === 'withdrawn' ? 'You withdrew this application.' : 'You were not offered a space this time.'}>
          {a.closeReason ? <p>{a.closeReason}</p> : <p>Contact {a.event?.organizerName || 'the organizer'} with any questions.</p>}
        </Notice>
      )}

      <div className="es-sp-dealgrid">
        <div className="fx-stack fx-min0">
          {['offered', 'confirmed'].includes(a.stage) && (
            <Panel icon="store" title="Your space" description={a.stage === 'offered' && a.offerExpiresAt ? `Reply by ${formatEventTime(a.offerExpiresAt, tz, { time: false })}.` : null}>
              <dl className="es-sp-facts">
                <div><dt>Space</dt><dd>{a.boothName}</dd></div>
                {a.boothLabel && <div><dt>Booth</dt><dd>{a.boothLabel}</dd></div>}
                <div><dt>Booth fee</dt><dd className="es-nums">{a.amountCents > 0 ? formatMoney(a.amountCents, a.currency) : 'Free'}</dd></div>
                <div><dt>Staff passes</dt><dd>{a.staffPasses}</dd></div>
              </dl>
              {a.includes.length > 0 && <ul className="es-sp-benefits mt-3">{a.includes.map((x) => <li key={x}><NavIcon name="check" size={16} />{x}</li>)}</ul>}
            </Panel>
          )}

          {a.stage === 'confirmed' && a.amountCents > 0 && <Payment app={a} tz={tz} onChange={app.reload} />}

          {a.vendorInfo && (
            <Panel icon="info" title="For the day"><div className="es-sp-terms es-sp-terms--compact">{a.vendorInfo}</div></Panel>
          )}

          {a.terms && (
            <Panel icon="pencil" title="Vendor terms" description={a.acceptedAt ? `Accepted by ${a.signerName} on ${formatEventTime(a.acceptedAt, tz)}.` : 'Read them before you accept.'}>
              <AgreementText text={a.terms} />
              {a.signatureSvg && (
                <figure className="es-sp-signature">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an SVG the API rendered from checked pen points */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(a.signatureSvg)}`} alt={`Signature of ${a.signerName}`} />
                  <figcaption className="text-xs text-subtle">Fingerprint {a.signatureSha256?.slice(0, 16)}…</figcaption>
                </figure>
              )}
              {a.stage === 'offered' && !a.expired && (
                <AcceptBlock app={a} defaultName={user?.fullName || user?.name || a.contactName || ''} onAccepted={() => { toast.success('Accepted. Thank you!'); app.reload(); }} />
              )}
            </Panel>
          )}

          {['submitted', 'waitlisted'].includes(a.stage) && (
            <Panel icon="receipt" title="Your application">
              {a.description && <p className="es-vd-desc fx-break">{a.description}</p>}
              {a.answers.length > 0 && (
                <dl className="es-vd-answers">{a.answers.map((x) => <div key={x.id}><dt>{x.label}</dt><dd className="fx-break">{x.answer || '—'}</dd></div>)}</dl>
              )}
            </Panel>
          )}
        </div>
        <div className="fx-stack fx-min0">
          {a.stage === 'confirmed' && a.staffPasses > 0 && <StaffPanel app={a} onSaved={app.reload} />}
          {['offered', 'confirmed'].includes(a.stage) && <ListingPanel app={a} onSaved={app.reload} />}
        </div>
      </div>
    </div>
  );
}

function AcceptBlock({ app, defaultName, onAccepted }) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isSigError = (e) => String(e?.code || '').startsWith('SIGNATURE_');

  async function sign(signature) {
    setBusy(true);
    setError(null);
    try {
      await post(`/partner/vendors/${app.id}/accept`, { signature, signerName: name.trim(), accept: true }, { noRedirect: true });
      setOpen(false);
      onAccepted();
    } catch (err) {
      setError(err);
      if (!isSigError(err)) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="es-sp-sign">
      <Field label="Your full name" name="ac-name" required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
        hint={`You accept on behalf of ${app.businessName}.`} />
      <label className="fx-row items-start gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
        <span>
          I have read the vendor terms and accept this space on behalf of <b>{app.businessName}</b>
          {app.amountCents > 0 ? <>, including paying the booth fee of {formatMoney(app.amountCents, app.currency)}</> : null}.
        </span>
      </label>
      {error && !open && <FormError error={error} />}
      <div className="fx-row">
        <button type="button" className="es-btn es-btn--primary es-btn--lg" disabled={!agree || name.trim().length < 2} onClick={() => { setError(null); setOpen(true); }}>
          <NavIcon name="pencil" size={18} />Accept and sign
        </button>
      </div>
      <SignatureDialog
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        onSign={sign}
        busy={busy}
        error={open && isSigError(error) ? error : null}
        defaultName={name}
        actionLabel="Accept space"
        busyLabel="Accepting…"
        legal={<>By signing, you accept this vendor space and its terms on behalf of {app.businessName}. Your signature is kept with the booking.</>}
      />
    </div>
  );
}

function Payment({ app, tz, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const card = app.payment?.card;
  const instructions = app.payment?.instructions;

  async function pay() {
    setBusy(true);
    try {
      const { url } = await post(`/partner/vendors/${app.id}/pay`, {}, { noRedirect: true });
      window.location.assign(url);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      setBusy(false);
      onChange();
    }
  }

  if (app.paidAt) {
    return (
      <Panel icon="coins" title="Booth fee">
        <p className="fx-row gap-2 items-center"><span className="es-pill es-pill--accent">Paid</span>{formatMoney(app.amountCents, app.currency)} on {formatEventTime(app.paidAt, tz, { time: false })}</p>
      </Panel>
    );
  }
  return (
    <Panel icon="coins" title="Pay your booth fee" description={`${formatMoney(app.amountCents, app.currency)} to ${app.event?.organizerName || 'the organizer'}. Your space is held once you have accepted.`}>
      <div className="fx-stack fx-stack--sm">
        {card?.available && (
          <div className="fx-row">
            <button type="button" className="es-btn es-btn--primary es-btn--lg" onClick={pay} disabled={busy}>
              <NavIcon name="card" size={18} />{busy ? 'Opening…' : `Pay ${formatMoney(app.amountCents, app.currency)} by card`}
            </button>
          </div>
        )}
        {card && !card.available && <p className="text-sm text-muted">Card payment is not available for this booking.</p>}
        {instructions ? (
          <>
            <p className="text-sm font-semibold">{card?.available ? 'Or pay another way' : 'How to pay'}</p>
            <div className="es-sp-terms es-sp-terms--compact">{instructions}</div>
            <p className="text-xs text-subtle">The organizer marks it as paid when your payment arrives.</p>
          </>
        ) : (!card?.available && <p className="text-sm text-muted">Contact {app.event?.organizerName || 'the organizer'} for how to pay.</p>)}
      </div>
    </Panel>
  );
}

function StaffPanel({ app, onSaved }) {
  const toast = useToast();
  const [names, setNames] = useState(() => {
    const list = [...app.staff];
    while (list.length < app.staffPasses) list.push('');
    return list.slice(0, app.staffPasses);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch(`/partner/vendors/${app.id}`, { staff: names.map((n) => n.trim()).filter(Boolean) }, { noRedirect: true });
      toast.success('Staff saved. They are on the door list.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon="users" title="Your staff" description={`Up to ${app.staffPasses} people, by name. The vendor entrance checks this list.`}>
      <form onSubmit={save} className="fx-stack fx-stack--sm">
        {names.map((n, i) => (
          <Field key={i} label={`Person ${i + 1}`} name={`st-${i}`} optional maxLength={80} value={n}
            onChange={(e) => setNames((list) => list.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
        <FormError error={error} />
        <div className="fx-row"><SubmitButton busy={busy}>Save staff</SubmitButton></div>
      </form>
    </Panel>
  );
}

function ListingPanel({ app, onSaved }) {
  const toast = useToast();
  const [description, setDescription] = useState(app.description || '');
  const [listed, setListed] = useState(app.listed);
  const [logo, setLogo] = useState(app.logoUrl ? { url: app.logoUrl, path: null } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { description: description.trim() || null, listed };
    if (logo?.path) body.logoPath = logo.path;
    else if (!logo && app.logoUrl) body.logoPath = null;
    try {
      await patch(`/partner/vendors/${app.id}`, body, { noRedirect: true });
      toast.success('Saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon="image" title="On the vendor list" description="Shown on the event’s vendor list once your booking is complete.">
      <form onSubmit={save} className="fx-stack fx-stack--sm">
        <LogoField base={`/partner/vendors/${app.id}`} value={logo} onChange={setLogo} />
        <TextareaField label="What you sell" name="ls-desc" optional rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="fx-row items-center gap-2 text-sm">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          List my business on the event’s public vendor list
        </label>
        <FormError error={error} />
        <div className="fx-row"><SubmitButton busy={busy}>Save</SubmitButton></div>
      </form>
    </Panel>
  );
}
