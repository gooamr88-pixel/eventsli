'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { post, patch } from '../../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../../utils/errors';
import { formatMoney } from '../../../../../utils/money';
import { formatEventTime } from '../../../../../lib/eventTime';
import { centsToInput, moneyPlaceholder, parseMoneyToCents } from '../../../../../lib/moneyInput';
import { useApi } from '../../../../../hooks/useApi';
import { useToast } from '../../../../../components/ui/Toast';
import { useConfirm } from '../../../../../components/ui/Confirm';
import { Panel } from '../../../../../components/ui/Page';
import Field, { SelectField, TextareaField } from '../../../../../components/forms/Field';
import FormError from '../../../../../components/forms/FormError';
import SubmitButton from '../../../../../components/forms/SubmitButton';
import NavIcon from '../../../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../../../components/Feedback';
import {
  StatusPill, LevelBadge, LEVELS, AgreementText, LogoField,
} from '../../../../../components/sponsors/sponsorUi';
import { useEventContext } from '../../EventContext';
import { STARTER_TERMS } from '../ProgramSettings';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SPONSORSHIP DEAL (2026-11-20).
 *
 *   lead / proposal  write the proposal — package, amount, what is included,
 *                    the agreement, the payment schedule, a reply-by date —
 *                    and send it. Sending again sends a revised proposal.
 *   signed           the agreement as signed, with the signature; each payment
 *                    and "Mark as paid" for money that arrived another way.
 *                    Card payments record themselves.
 *   paid             the sponsor is on the event page; their display details
 *                    (name, link, logo) can still be corrected here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const METHODS = [['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['other', 'Other']];
const METHOD_LABEL = Object.fromEntries([...METHODS, ['card', 'Card (Stripe)']]);
const HISTORY = {
  created: 'Lead added',
  inquiry: 'Inquiry received from the sponsor page',
  proposal_sent: 'Proposal sent',
  proposal_revised: 'Revised proposal sent',
  signed: 'Agreement signed',
  payment_recorded: 'Payment recorded',
  published: 'Shown on the event page',
  brand_updated: 'Sponsor updated their logo or link',
  lost: 'Marked as lost',
  cancelled: 'Cancelled',
  reopened: 'Reopened',
};

export default function DealDetail({ eventId, dealId }) {
  const event = useEventContext()?.event;
  const toast = useToast();
  const confirm = useConfirm();
  const deal = useApi(`/events/${eventId}/sponsorship/deals/${dealId}`);
  const back = `/organizer/events/${eventId}/sponsors`;

  if (deal.error) return <ErrorNotice error={deal.error} onRetry={deal.reload} />;
  if (!deal.data) return <Loading variant="card" label="Loading the sponsorship" />;
  const d = deal.data;
  const tz = event?.timezone;
  const open = d.stage === 'lead' || d.stage === 'proposal';

  async function close(outcome) {
    const ok = await confirm({
      title: outcome === 'lost' ? `Mark ${d.companyName} as lost?` : `Cancel the ${d.companyName} sponsorship?`,
      tone: 'danger',
      body: outcome === 'lost'
        ? <p>It moves to Lost. You can reopen it later.</p>
        : (
          <p>
            Unpaid payments are cancelled{d.published ? ' and their logo comes off your event page' : ''}.
            {d.paidCents > 0 && ` ${formatMoney(d.paidCents, d.currency)} already paid is yours to refund — in your Stripe Dashboard for card payments, or directly.`}
          </p>
        ),
      confirmLabel: outcome === 'lost' ? 'Mark as lost' : 'Cancel sponsorship',
    });
    if (!ok) return;
    try {
      await post(`/events/${eventId}/sponsorship/deals/${dealId}/close`, { outcome }, { noRedirect: true });
      toast.success(outcome === 'lost' ? 'Marked as lost.' : 'Sponsorship cancelled.');
      deal.reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function reopen() {
    try {
      await post(`/events/${eventId}/sponsorship/deals/${dealId}/reopen`, {}, { noRedirect: true });
      toast.success('Reopened as a lead.');
      deal.reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      <Link href={back} className="es-sp-back"><NavIcon name="arrow" size={16} />All sponsors</Link>

      <header className="es-sp-dealhead">
        {d.logoUrl
          // eslint-disable-next-line @next/next/no-img-element -- the sponsor's logo
          ? <img src={d.logoUrl} alt="" className="es-sp-dealhead__logo" />
          : <span className="es-sp-dealhead__initial" aria-hidden="true">{d.companyName.slice(0, 1).toUpperCase()}</span>}
        <div className="fx-min0">
          <h1 className="es-section-title fx-break">{d.companyName}</h1>
          <p className="es-sp-dealhead__meta">
            <StatusPill status={d.status} expired={d.expired} />
            <LevelBadge level={d.level} />
            {d.packageName && <span>{d.packageName}</span>}
            {d.amountCents > 0 && <b className="es-nums">{formatMoney(d.amountCents, d.currency)}</b>}
          </p>
        </div>
        <div className="es-sp-dealhead__actions">
          {open && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => close('lost')}>Mark as lost</button>}
          {d.stage === 'signed' && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => close('cancelled')}>Cancel sponsorship</button>}
          {d.stage === 'lost' && <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={reopen}>Reopen</button>}
        </div>
      </header>

      {d.expired && (
        <Notice tone="warning" title="This proposal has expired.">
          <p>The sponsor can no longer sign it. Send it again below with a new reply-by date.</p>
        </Notice>
      )}
      {d.published && (
        <Notice tone="info" title="Shown on your event page." icon="check">
          <p>Paid in full, so {d.displayName || d.companyName} appears with your {LEVELS.find(([v]) => v === d.level)?.[1].toLowerCase()} sponsors.</p>
        </Notice>
      )}

      <div className="es-sp-dealgrid">
        <div className="fx-stack fx-min0">
          {open && <ProposalEditor eventId={eventId} deal={d} event={event} onSent={() => { toast.success('Proposal sent.'); deal.reload(); }} />}
          {!open && d.stage !== 'lost' && <ProposalSummary deal={d} tz={tz} />}
          {d.installments.length > 0 && !open && (
            <Payments eventId={eventId} deal={d} tz={tz} onChange={deal.reload} />
          )}
          {d.signedAt && (
            <Panel icon="pencil" title="Signed agreement" description={`Signed by ${d.signerName} (${d.signerEmail}) on ${formatEventTime(d.signedAt, tz)}.`}>
              <AgreementText text={d.terms} />
              {d.signatureSvg && (
                <figure className="es-sp-signature">
                  {/* Rendered by the API from checked pen points, never markup the browser sent. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data: SVG, nothing to optimise */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(d.signatureSvg)}`} alt={`Signature of ${d.signerName}`} />
                  <figcaption className="text-xs text-subtle">
                    {d.signatureMethod === 'typed' ? 'Typed signature' : 'Drawn signature'} · fingerprint {d.signatureSha256?.slice(0, 16)}…
                  </figcaption>
                </figure>
              )}
            </Panel>
          )}
          {(d.stage === 'proposal' || d.stage === 'signed') && <BrandPanel eventId={eventId} deal={d} onSaved={deal.reload} />}
          <History items={d.history} tz={tz} />
        </div>
        <div className="fx-stack fx-min0">
          <ContactPanel eventId={eventId} deal={d} onSaved={deal.reload} />
          <NotesPanel eventId={eventId} deal={d} onSaved={deal.reload} />
        </div>
      </div>
    </div>
  );
}

// ── The proposal ──────────────────────────────────────────────────────────
const dateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const fromDateInput = (value) => (value ? new Date(`${value}T12:00:00Z`).toISOString() : null);
const addDays = (days, from = Date.now()) => new Date(from + days * 86400e3).toISOString();

/** n payments summing to the amount; odd cents on the first; spaced before the event. */
function splitSchedule(amountCents, n, eventStartsAt) {
  if (!amountCents || amountCents <= 0) return [];
  const parts = Math.max(1, Math.min(12, n));
  const base = Math.floor(amountCents / parts);
  const first = amountCents - base * (parts - 1);
  const start = Date.now() + 7 * 86400e3;
  const end = eventStartsAt ? new Date(eventStartsAt).getTime() - 7 * 86400e3 : start + parts * 30 * 86400e3;
  const span = Math.max(0, end - start);
  return Array.from({ length: parts }, (_, i) => ({
    label: parts === 1 ? 'Full payment' : i === 0 ? 'Deposit' : `Payment ${i + 1}`,
    amountCents: i === 0 ? first : base,
    dueAt: new Date(start + (parts === 1 ? 0 : Math.round((span * i) / (parts - 1)))).toISOString(),
  }));
}

function ProposalEditor({ eventId, deal, event, onSent }) {
  const packages = useApi(`/events/${eventId}/sponsorship/packages`);
  const program = useApi(`/events/${eventId}/sponsorship/program`);
  if (packages.error || program.error) return <ErrorNotice error={packages.error || program.error} onRetry={() => { packages.reload(); program.reload(); }} />;
  if (!packages.data || !program.data) return <Loading variant="card" label="Loading the proposal" />;
  return <ProposalForm eventId={eventId} deal={deal} event={event} packages={packages.data} program={program.data} onSent={onSent} />;
}

function ProposalForm({ eventId, deal, event, packages, program, onSent }) {
  const currency = deal.currency || event?.currency || 'USD';
  const pkgOf = (id) => packages.find((p) => p.id === id) || null;
  const initialPkg = pkgOf(deal.packageId);
  const initialAmount = deal.stage === 'proposal' || deal.amountCents > 0 ? deal.amountCents : initialPkg?.priceCents || 0;
  const [form, setForm] = useState(() => ({
    packageId: deal.packageId || '',
    level: deal.level || initialPkg?.level || 'partner',
    amount: centsToInput(initialAmount, currency),
    benefits: (deal.benefits?.length ? deal.benefits : initialPkg?.benefits || []).join('\n'),
    terms: deal.terms || program.defaultTerms || STARTER_TERMS,
    expires: dateInput(deal.proposalExpiresAt && new Date(deal.proposalExpiresAt) > new Date() ? deal.proposalExpiresAt : addDays(14)),
  }));
  const [schedule, setSchedule] = useState(() => (deal.installments?.length
    ? deal.installments.map((i) => ({ label: i.label, amountCents: i.amountCents, dueAt: i.dueAt }))
    : splitSchedule(initialAmount, 1, event?.startsAt)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const cents = form.amount === '' ? 0 : parseMoneyToCents(form.amount, currency);
  const amountInvalid = cents === null;
  const sum = schedule.reduce((s, x) => s + (Number(x.amountCents) || 0), 0);
  const mismatch = !amountInvalid && cents > 0 && sum !== cents;

  function choosePackage(e) {
    const p = pkgOf(e.target.value);
    setForm((f) => ({
      ...f,
      packageId: e.target.value,
      ...(p ? { level: p.level, amount: centsToInput(p.priceCents, currency), benefits: p.benefits.join('\n') } : {}),
    }));
    if (p) setSchedule(splitSchedule(p.priceCents, schedule.length || 1, event?.startsAt));
  }

  function changeAmount(e) {
    const value = e.target.value;
    setForm((f) => ({ ...f, amount: value }));
    const c = value === '' ? 0 : parseMoneyToCents(value, currency);
    if (c !== null) setSchedule(splitSchedule(c, schedule.length || 1, event?.startsAt));
  }

  const setRow = (i, patchRow) => setSchedule((rows) => rows.map((r, j) => (j === i ? { ...r, ...patchRow } : r)));

  async function submit(e) {
    e.preventDefault();
    if (amountInvalid || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/sponsorship/deals/${deal.id}/proposal`, {
        packageId: form.packageId || null,
        level: form.level,
        amountCents: cents,
        benefits: form.benefits.split('\n').map((b) => b.trim()).filter(Boolean),
        terms: form.terms,
        expiresAt: fromDateInput(form.expires),
        installments: cents > 0 ? schedule.map((r) => ({ label: r.label, amountCents: Number(r.amountCents), dueAt: r.dueAt })) : [],
      }, { noRedirect: true });
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon="send" title={deal.stage === 'proposal' ? 'Revise the proposal' : 'Write the proposal'}
      description={`It is emailed to ${deal.contactEmail}, who signs in with that address to read, sign and pay it.`}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <SelectField label="Package" name="pp-package" value={form.packageId} onChange={choosePackage}
            options={[['', 'Custom (no package)'], ...packages.filter((p) => p.isActive || p.id === deal.packageId).map((p) => [p.id, `${p.name}${p.remaining === 0 ? ' — fully signed' : ''}`])]} />
          <SelectField label="Tier on the event page" name="pp-level" value={form.level} onChange={set('level')} options={LEVELS} />
          <Field label={`Amount (${currency})`} name="pp-amount" inputMode="decimal" placeholder={moneyPlaceholder(currency)}
            value={form.amount} onChange={changeAmount} error={amountInvalid ? 'Enter an amount, e.g. 5000.' : null}
            hint="0 for an in-kind sponsorship — nothing to pay." />
          <Field label="Reply by" name="pp-expires" type="date" optional min={dateInput(addDays(1))} value={form.expires} onChange={set('expires')}
            hint="After this date it can no longer be signed." />
        </div>
        <TextareaField label="What is included" name="pp-benefits" rows={4} value={form.benefits} onChange={set('benefits')}
          hint="One per line. This is what you commit to deliver." />

        {cents > 0 && !amountInvalid && (
          <fieldset className="es-sp-schedule">
            <legend className="es-label"><span>Payment schedule</span></legend>
            <div className="fx-row gap-2 items-center text-sm">
              <span>Payments:</span>
              <div role="group" aria-label="Number of payments" className="es-segmented">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} type="button" className="es-segmented__option" aria-pressed={schedule.length === n}
                    onClick={() => setSchedule(splitSchedule(cents, n, event?.startsAt))}>{n}</button>
                ))}
              </div>
            </div>
            <ol className="es-sp-schedule__rows">
              {schedule.map((r, i) => (
                <li key={i} className="es-sp-schedule__row">
                  <input className="es-input es-input--sm" aria-label={`Payment ${i + 1} label`} maxLength={80} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                  <input className="es-input es-input--sm es-nums" aria-label={`Payment ${i + 1} amount (${currency})`} inputMode="decimal"
                    value={centsToInput(r.amountCents, currency)}
                    onChange={(e) => { const c = parseMoneyToCents(e.target.value, currency); if (c !== null) setRow(i, { amountCents: c }); }} />
                  <input className="es-input es-input--sm" type="date" aria-label={`Payment ${i + 1} due date`} value={dateInput(r.dueAt)}
                    onChange={(e) => setRow(i, { dueAt: fromDateInput(e.target.value) })} />
                </li>
              ))}
            </ol>
            <p className={`text-sm ${mismatch ? 'text-danger' : 'text-subtle'}`} aria-live="polite">
              {mismatch
                ? `The payments add up to ${formatMoney(sum, currency)}; the sponsorship is ${formatMoney(cents, currency)}. Make them match.`
                : `Adds up to ${formatMoney(sum, currency)}.`}
            </p>
          </fieldset>
        )}

        <TextareaField label="Agreement" name="pp-terms" rows={10} required maxLength={20000} value={form.terms} onChange={set('terms')}
          hint="What the sponsor signs. The package, amount, benefits and schedule above are shown with it." />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} disabled={amountInvalid || mismatch}>
            <NavIcon name="send" size={18} />{deal.stage === 'proposal' ? 'Send revised proposal' : 'Send proposal'}
          </SubmitButton>
        </div>
      </form>
    </Panel>
  );
}

function ProposalSummary({ deal, tz }) {
  return (
    <Panel icon="receipt" title="The sponsorship" description={deal.proposalSentAt ? `Proposal sent ${formatEventTime(deal.proposalSentAt, tz)}.` : null}>
      <dl className="es-sp-facts">
        <div><dt>Amount</dt><dd className="es-nums">{deal.amountCents > 0 ? formatMoney(deal.amountCents, deal.currency) : 'In kind'}</dd></div>
        <div><dt>Paid</dt><dd className="es-nums">{formatMoney(deal.paidCents, deal.currency)}</dd></div>
        <div><dt>Package</dt><dd>{deal.packageName || 'Custom'}</dd></div>
      </dl>
      {deal.benefits.length > 0 && (
        <ul className="es-sp-benefits mt-3">
          {deal.benefits.map((b) => <li key={b}><NavIcon name="check" size={16} />{b}</li>)}
        </ul>
      )}
    </Panel>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────
function Payments({ eventId, deal, tz, onChange }) {
  const [marking, setMarking] = useState(null);
  const outstanding = Math.max(0, deal.amountCents - deal.paidCents);
  return (
    <Panel icon="coins" title="Payments"
      description={outstanding > 0
        ? `${formatMoney(outstanding, deal.currency)} still to collect. Card payments record themselves; mark anything else as paid when it arrives.`
        : 'Paid in full.'}>
      <ul className="es-sp-payments">
        {deal.installments.map((i) => (
          <li key={i.id} className="es-sp-payment" data-status={i.status}>
            <div className="fx-min0">
              <p className="es-sp-payment__label">{i.label}</p>
              <p className="text-xs text-subtle">
                {i.status === 'paid'
                  ? `Paid ${formatEventTime(i.paidAt, tz, { time: false })} · ${METHOD_LABEL[i.method] || i.method}${i.reference ? ` · ${i.reference}` : ''}`
                  : i.status === 'void' ? 'Cancelled' : `Due ${formatEventTime(i.dueAt, tz, { time: false })}${i.overdue ? ' · overdue' : ''}`}
              </p>
            </div>
            <b className="es-nums">{formatMoney(i.amountCents, deal.currency)}</b>
            {i.status === 'paid' && <span className="es-pill es-pill--accent">Paid</span>}
            {i.status === 'open' && deal.stage === 'signed' && marking !== i.id && (
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setMarking(i.id)}>Mark as paid</button>
            )}
            {i.status === 'open' && i.overdue && marking !== i.id && <span className="es-pill es-pill--danger">Overdue</span>}
            {marking === i.id && (
              <MarkPaid eventId={eventId} dealId={deal.id} installment={i} currency={deal.currency}
                onCancel={() => setMarking(null)} onDone={() => { setMarking(null); onChange(); }} />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MarkPaid({ eventId, dealId, installment, currency, onCancel, onDone }) {
  const toast = useToast();
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/sponsorship/deals/${dealId}/installments/${installment.id}/paid`,
        { method, reference: reference.trim() || null }, { noRedirect: true });
      toast.success(`${formatMoney(installment.amountCents, currency)} recorded as paid.`);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="es-sp-markpaid">
      <SelectField label="How it was paid" name={`mp-${installment.id}`} value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
      <Field label="Reference" name={`mp-ref-${installment.id}`} optional maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)}
        hint="e.g. the transfer reference or cheque number." />
      <FormError error={error} />
      <div className="fx-row">
        <SubmitButton busy={busy}>Confirm {formatMoney(installment.amountCents, currency)} received</SubmitButton>
        <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

// ── Display, contact, notes, history ──────────────────────────────────────
function BrandPanel({ eventId, deal, onSaved }) {
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
      await patch(`/events/${eventId}/sponsorship/deals/${deal.id}`, body, { noRedirect: true });
      toast.success(deal.published ? 'Saved — your event page shows the change.' : 'Saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon="image" title="On the event page" description="How the sponsor is shown once paid. The sponsor can also set these from their side.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Name shown" name="br-name" optional maxLength={120} placeholder={deal.companyName} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Field label="Link" name="br-link" type="url" optional placeholder={deal.website || 'https://'} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
        </div>
        <LogoField base={`/events/${eventId}/sponsorship`} value={logo} onChange={setLogo} />
        <FormError error={error} />
        <div className="fx-row"><SubmitButton busy={busy}>Save display</SubmitButton></div>
      </form>
    </Panel>
  );
}

function ContactPanel({ eventId, deal, onSaved }) {
  const toast = useToast();
  const editable = deal.stage === 'lead' || deal.stage === 'proposal';
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    companyName: deal.companyName, contactName: deal.contactName || '', contactEmail: deal.contactEmail,
    contactPhone: deal.contactPhone || '', website: deal.website || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch(`/events/${eventId}/sponsorship/deals/${deal.id}`, {
        companyName: form.companyName.trim(), contactEmail: form.contactEmail.trim(),
        contactName: form.contactName.trim() || null, contactPhone: form.contactPhone.trim() || null, website: form.website.trim() || null,
      }, { noRedirect: true });
      toast.success('Contact saved.');
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <Panel icon="user" title="Contact">
        <form onSubmit={submit} className="fx-stack fx-stack--sm">
          <Field label="Company" name="ct-company" required maxLength={120} value={form.companyName} onChange={set('companyName')} />
          <Field label="Email" name="ct-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')}
            hint="Changing it moves the deal to the new address: only they can sign it." />
          <Field label="Name" name="ct-name" optional maxLength={120} value={form.contactName} onChange={set('contactName')} />
          <Field label="Phone" name="ct-phone" type="tel" optional maxLength={30} value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Website" name="ct-web" type="url" optional value={form.website} onChange={set('website')} />
          <FormError error={error} />
          <div className="fx-row">
            <SubmitButton busy={busy}>Save</SubmitButton>
            <button type="button" className="es-btn es-btn--ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      </Panel>
    );
  }

  return (
    <Panel icon="user" title="Contact" action={editable ? <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(true)}>Edit</button> : null}>
      <dl className="es-sp-contact">
        <div><dt>Company</dt><dd className="fx-break">{deal.companyName}</dd></div>
        {deal.contactName && <div><dt>Name</dt><dd>{deal.contactName}</dd></div>}
        <div><dt>Email</dt><dd className="fx-break"><a href={`mailto:${deal.contactEmail}`}>{deal.contactEmail}</a></dd></div>
        {deal.contactPhone && <div><dt>Phone</dt><dd><a href={`tel:${deal.contactPhone}`}>{deal.contactPhone}</a></dd></div>}
        {deal.website && <div><dt>Website</dt><dd className="fx-break"><a href={deal.website} target="_blank" rel="noreferrer noopener">{deal.website.replace(/^https?:\/\//, '')}</a></dd></div>}
      </dl>
      {deal.message && (
        <blockquote className="es-sp-message">
          <p className="text-xs text-subtle">Their message</p>
          <p className="fx-break">{deal.message}</p>
        </blockquote>
      )}
    </Panel>
  );
}

function NotesPanel({ eventId, deal, onSaved }) {
  const toast = useToast();
  const [notes, setNotes] = useState(deal.notes || '');
  const [busy, setBusy] = useState(false);
  const dirty = (notes.trim() || null) !== (deal.notes || null);
  async function save() {
    setBusy(true);
    try {
      await patch(`/events/${eventId}/sponsorship/deals/${deal.id}`, { notes: notes.trim() || null }, { noRedirect: true });
      toast.success('Notes saved.');
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel icon="lock" title="Private notes" description="Only you see these — never the sponsor.">
      <div className="fx-stack fx-stack--sm">
        <TextareaField label="Notes" name="dl-notes" rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {dirty && <div className="fx-row"><button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save notes'}</button></div>}
      </div>
    </Panel>
  );
}

function History({ items, tz }) {
  const list = useMemo(() => [...(items || [])].reverse(), [items]);
  if (!list.length) return null;
  return (
    <Panel icon="clock" title="History">
      <ol className="es-sp-history">
        {list.map((h) => (
          <li key={h.id}>
            <span className="es-sp-history__what">
              {HISTORY[h.kind] || h.kind}
              {h.kind === 'payment_recorded' && h.detail?.amountCents ? ` — ${METHOD_LABEL[h.detail.method] || h.detail.method}` : ''}
              {(h.kind === 'lost' || h.kind === 'cancelled') && h.detail?.reason ? ` — ${h.detail.reason}` : ''}
            </span>
            <span className="text-xs text-subtle">{formatEventTime(h.at, tz)}{h.by ? ` · ${h.by}` : ''}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
