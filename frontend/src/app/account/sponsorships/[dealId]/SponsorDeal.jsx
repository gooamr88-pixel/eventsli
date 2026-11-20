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
import { Panel } from '../../../components/ui/Page';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { StatusPill, LevelBadge, AgreementText, LogoField, levelLabel } from '../../../components/sponsors/sponsorUi';
import SignatureDialog from '../../../checkout/[reservationId]/SignatureDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SPONSORSHIP, AS THE SPONSOR SEES IT (2026-11-20).
 *
 *   proposal   read what is offered and the agreement; sign it (drawn or
 *              typed, the same signature step as the checkout)
 *   signed     pay each instalment by card — on the organizer's own Stripe
 *              account — or by the organizer's offline instructions
 *   any time   the logo, name and link shown on the event page
 *
 * Coming back from Stripe (`?paid=`), the payment is recorded by its webhook a
 * moment later; the page says so and looks again rather than claiming it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SponsorDeal({ dealId }) {
  const { user } = useAuth();
  const toast = useToast();
  const deal = useApi(`/partner/sponsorships/${dealId}`);
  // Back from Stripe (`?paid=<instalment>`): look again a few times while the webhook lands.
  const returning = Boolean(useSearchParams().get('paid'));
  useEffect(() => {
    if (!returning) return undefined;
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      deal.reload();
      if (n >= 5) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [returning]); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  if (deal.error) return <ErrorNotice error={deal.error} onRetry={deal.reload} />;
  if (!deal.data) return <Loading variant="card" label="Loading the sponsorship" />;
  const d = deal.data;
  const tz = d.event?.timezone;
  const canSign = d.stage === 'proposal' && !d.expired;
  const justPaid = returning && d.installments.some((i) => i.status === 'paid');

  return (
    <div className="fx-stack">
      <Link href="/account/sponsorships" className="es-sp-back"><NavIcon name="arrow" size={16} />All sponsorships</Link>

      <header className="es-sp-dealhead">
        {d.event?.coverUrl
          // eslint-disable-next-line @next/next/no-img-element -- the event's poster
          ? <img src={d.event.coverUrl} alt="" className="es-sp-dealhead__logo es-sp-dealhead__logo--cover" />
          : <span className="es-sp-dealhead__initial" aria-hidden="true"><NavIcon name="calendar" size={24} /></span>}
        <div className="fx-min0">
          <p className="text-sm text-muted">Sponsorship of</p>
          <h1 className="es-section-title fx-break">{d.event?.title}</h1>
          <p className="es-sp-dealhead__meta">
            <StatusPill status={d.status} sponsor expired={d.expired} />
            <LevelBadge level={d.level} />
            <span>{d.companyName}</span>
            {d.event?.organizerName && <span>with {d.event.organizerName}</span>}
          </p>
        </div>
        {d.event?.slug && (
          <div className="es-sp-dealhead__actions">
            <a className="es-btn es-btn--ghost es-btn--sm" href={`/e/${d.event.slug}`} target="_blank" rel="noreferrer"><NavIcon name="external" size={16} />Event page</a>
          </div>
        )}
      </header>

      {returning && !justPaid && (
        <Notice tone="info" title="Recording your payment…">
          <p>Your card payment went to the organizer. It shows here as soon as Stripe confirms it — usually within a minute.</p>
        </Notice>
      )}
      {justPaid && returning && (
        <Notice tone="info" icon="check" title="Payment received. Thank you!">
          <p>A receipt is on its way to your email. {d.status === 'paid' ? 'Your sponsorship is paid in full and your logo is on the event page.' : ''}</p>
        </Notice>
      )}
      {d.expired && (
        <Notice tone="warning" title="This proposal has expired.">
          <p>Its reply-by date has passed, so it can no longer be signed. Ask {d.event?.organizerName || 'the organizer'} to send it again.</p>
        </Notice>
      )}
      {d.stage === 'lead' && (
        <Notice tone="info" title="Your inquiry is with the organizer.">
          <p>When they send you a proposal you will get an email, and it will appear here to read and sign.</p>
        </Notice>
      )}
      {(d.stage === 'lost' || d.stage === 'cancelled') && (
        <Notice tone="neutral" title={d.stage === 'cancelled' ? 'This sponsorship was cancelled.' : 'This sponsorship is closed.'}>
          <p>Contact {d.event?.organizerName || 'the organizer'} with any questions.</p>
        </Notice>
      )}
      {d.published && !returning && (
        <Notice tone="info" icon="check" title="You are on the event page.">
          <p>Your sponsorship is complete and your logo is shown with the {levelLabel(d.level).toLowerCase()} sponsors.</p>
        </Notice>
      )}

      {d.stage !== 'lead' && (
        <div className="es-sp-dealgrid">
          <div className="fx-stack fx-min0">
            <Panel icon="receipt" title="What you get"
              description={d.proposalExpiresAt && d.stage === 'proposal' ? `Reply by ${formatEventTime(d.proposalExpiresAt, tz, { time: false })}.` : null}>
              <dl className="es-sp-facts">
                <div><dt>Amount</dt><dd className="es-nums">{d.amountCents > 0 ? formatMoney(d.amountCents, d.currency) : 'In kind'}</dd></div>
                <div><dt>Tier</dt><dd>{levelLabel(d.level)}</dd></div>
                {d.amountCents > 0 && <div><dt>Paid</dt><dd className="es-nums">{formatMoney(d.paidCents, d.currency)}</dd></div>}
              </dl>
              {d.benefits.length > 0 && (
                <ul className="es-sp-benefits mt-3">
                  {d.benefits.map((b) => <li key={b}><NavIcon name="check" size={16} />{b}</li>)}
                </ul>
              )}
            </Panel>

            {d.installments.length > 0 && (
              <Payments deal={d} tz={tz} onPaid={deal.reload} />
            )}

            <Panel icon="pencil" title="Agreement" description={d.signedAt ? `Signed by ${d.signerName} on ${formatEventTime(d.signedAt, tz)}.` : 'Read it before you sign.'}>
              <AgreementText text={d.terms} />
              {d.signatureSvg && (
                <figure className="es-sp-signature">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an SVG the API rendered from checked pen points */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(d.signatureSvg)}`} alt={`Signature of ${d.signerName}`} />
                  <figcaption className="text-xs text-subtle">Fingerprint {d.signatureSha256?.slice(0, 16)}…</figcaption>
                </figure>
              )}
              {canSign && <SignBlock deal={d} defaultName={user?.fullName || user?.name || d.contactName || ''} onSigned={() => { toast.success('Signed. Thank you!'); deal.reload(); }} />}
            </Panel>
          </div>
          <div className="fx-stack fx-min0">
            {(d.stage === 'proposal' || d.stage === 'signed') && <BrandPanel deal={d} onSaved={deal.reload} />}
          </div>
        </div>
      )}
    </div>
  );
}

function SignBlock({ deal, defaultName, onSigned }) {
  const [name, setName] = useState(defaultName);
  const [accept, setAccept] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = accept && name.trim().length >= 2;

  async function sign(signature) {
    setBusy(true);
    setError(null);
    try {
      await post(`/partner/sponsorships/${deal.id}/sign`, { signature, signerName: name.trim(), accept: true }, { noRedirect: true });
      setOpen(false);
      onSigned();
    } catch (err) {
      setError(err);
      // A signature problem is shown in the dialog; anything else closes it.
      if (!String(err?.code || '').startsWith('SIGNATURE_')) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="es-sp-sign">
      <Field label="Your full name" name="sg-name" required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
        hint={`You sign on behalf of ${deal.companyName}.`} />
      <label className="fx-row items-start gap-2 text-sm">
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
        <span>
          I have read the agreement above and agree to it on behalf of <b>{deal.companyName}</b>
          {deal.amountCents > 0 ? <>, including paying {formatMoney(deal.amountCents, deal.currency)} as scheduled</> : null}.
        </span>
      </label>
      {error && !open && <FormError error={error} />}
      <div className="fx-row">
        <button type="button" className="es-btn es-btn--primary es-btn--lg" disabled={!ready} onClick={() => { setError(null); setOpen(true); }}>
          <NavIcon name="pencil" size={18} />Sign the agreement
        </button>
      </div>
      <SignatureDialog
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        onSign={sign}
        busy={busy}
        error={open && error && String(error.code || '').startsWith('SIGNATURE_') ? error : null}
        defaultName={name}
        actionLabel="Sign agreement"
        busyLabel="Signing…"
        legal={<>By signing, you agree to this sponsorship agreement on behalf of {deal.companyName}. Your signature is kept with the agreement.</>}
      />
    </div>
  );
}

function Payments({ deal, tz, onPaid }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const signed = deal.stage === 'signed';
  const card = deal.payment?.card;
  const instructions = deal.payment?.instructions;
  const outstanding = Math.max(0, deal.amountCents - deal.paidCents);

  async function pay(i) {
    setBusyId(i.id);
    try {
      const { url } = await post(`/partner/sponsorships/${deal.id}/installments/${i.id}/pay`, {}, { noRedirect: true });
      window.location.assign(url);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      setBusyId(null);
      onPaid();
    }
  }

  return (
    <Panel icon="coins" title="Payments"
      description={signed && outstanding > 0 ? `${formatMoney(outstanding, deal.currency)} to pay, to ${deal.event?.organizerName || 'the organizer'}.` : outstanding === 0 ? 'Paid in full.' : 'Payment opens once you sign.'}>
      <ul className="es-sp-payments">
        {deal.installments.map((i) => (
          <li key={i.id} className="es-sp-payment" data-status={i.status}>
            <div className="fx-min0">
              <p className="es-sp-payment__label">{i.label}</p>
              <p className="text-xs text-subtle">
                {i.status === 'paid' ? `Paid ${formatEventTime(i.paidAt, tz, { time: false })}`
                  : i.status === 'void' ? 'Cancelled'
                    : `Due ${formatEventTime(i.dueAt, tz, { time: false })}${i.overdue ? ' · overdue' : ''}`}
              </p>
            </div>
            <b className="es-nums">{formatMoney(i.amountCents, deal.currency)}</b>
            {i.status === 'paid' && <span className="es-pill es-pill--accent">Paid</span>}
            {i.status === 'open' && signed && card?.available && (
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => pay(i)} disabled={busyId !== null}>
                <NavIcon name="card" size={16} />{busyId === i.id ? 'Opening…' : 'Pay by card'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {signed && outstanding > 0 && (
        <div className="es-sp-payhow">
          {card && !card.available && <p className="text-sm text-muted">Card payment is not available for this sponsorship.</p>}
          {instructions ? (
            <>
              <p className="text-sm font-semibold">{card?.available ? 'Or pay another way' : 'How to pay'}</p>
              <div className="es-sp-terms es-sp-terms--compact">{instructions}</div>
              <p className="text-xs text-subtle">The organizer marks these as paid when your payment arrives.</p>
            </>
          ) : (!card?.available && <p className="text-sm text-muted">Contact {deal.event?.organizerName || 'the organizer'} for how to pay.</p>)}
        </div>
      )}
    </Panel>
  );
}

function BrandPanel({ deal, onSaved }) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState(deal.displayName || '');
  const [linkUrl, setLinkUrl] = useState(deal.linkUrl || '');
  const [logo, setLogo] = useState(deal.logoUrl ? { url: deal.logoUrl, path: null } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { displayName: displayName.trim() || null, linkUrl: linkUrl.trim() || null };
    if (logo?.path) body.logoPath = logo.path;
    else if (!logo && deal.logoUrl) body.logoPath = null;
    try {
      await patch(`/partner/sponsorships/${deal.id}/brand`, body, { noRedirect: true });
      toast.success(deal.published ? 'Saved — the event page shows the change.' : 'Saved. It is shown once the sponsorship is complete.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon="image" title="Your logo on the event page" description="Shown with the event's sponsors once your sponsorship is complete.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <LogoField base={`/partner/sponsorships/${deal.id}`} value={logo} onChange={setLogo} />
        <Field label="Name shown" name="sb-name" optional maxLength={120} placeholder={deal.companyName} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <Field label="Link" name="sb-link" type="url" optional placeholder={deal.website || 'https://'} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
          hint="Where your logo takes people." />
        <FormError error={error} />
        <div className="fx-row"><SubmitButton busy={busy}>Save</SubmitButton></div>
      </form>
    </Panel>
  );
}
