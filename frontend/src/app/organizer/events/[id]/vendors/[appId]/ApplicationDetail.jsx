'use client';

import { useState } from 'react';
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
import { AgreementText } from '../../../../../components/sponsors/sponsorUi';
import { VendorStatus, STARTER_VENDOR_TERMS } from '../../../../../components/vendors/vendorUi';
import { useEventContext } from '../../EventContext';
import FloorPlanViewer from '../../../../../components/vendors/floorPlan/FloorPlanViewer';
import { AddonsAndDocuments, BusinessFacts } from './ApplicationExtras';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE VENDOR APPLICATION (2026-11-20).
 *
 *   new / waitlist  read the application and answers; waitlist it, decline
 *                   it, or offer a space (booth type, fee, booth number, staff
 *                   passes, terms, reply-by date)
 *   offer sent      revise the offer, or decline
 *   accepted        the signed terms; record the booth fee if it was paid
 *                   another way (card payments record themselves); cancel
 *   booked          staff named for the door; booth number can still change
 * ─────────────────────────────────────────────────────────────────────────────
 */
const METHODS = [['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['other', 'Other']];
const METHOD_LABEL = Object.fromEntries([...METHODS, ['card', 'Card (Stripe)']]);
const HISTORY = {
  applied: 'Applied from the vendor page',
  created: 'Added by the organizer',
  waitlisted: 'Put on the waitlist',
  unwaitlisted: 'Taken off the waitlist',
  offer_sent: 'Offer sent',
  offer_revised: 'Revised offer sent',
  accepted: 'Offer accepted and signed',
  payment_recorded: 'Booth fee recorded',
  profile_updated: 'Vendor updated their booking',
  rejected: 'Declined',
  withdrawn: 'Withdrawn by the vendor',
  cancelled: 'Cancelled',
};

export default function ApplicationDetail({ eventId, appId }) {
  const event = useEventContext()?.event;
  const toast = useToast();
  const confirm = useConfirm();
  const app = useApi(`/events/${eventId}/vendors/applications/${appId}`);
  if (app.error) return <ErrorNotice error={app.error} onRetry={app.reload} />;
  if (!app.data) return <Loading variant="card" label="Loading the application" />;
  const a = app.data;
  const tz = event?.timezone;
  const open = ['submitted', 'waitlisted', 'offered'].includes(a.stage);

  async function act(path, body, success) {
    try {
      await post(`/events/${eventId}/vendors/applications/${appId}/${path}`, body, { noRedirect: true });
      toast.success(success);
      app.reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function close(outcome) {
    let reason = '';
    const ok = await confirm({
      title: outcome === 'rejected' ? `Decline ${a.businessName}?` : `Cancel ${a.businessName}’s booking?`,
      tone: 'danger',
      body: (
        <div className="fx-stack fx-stack--sm">
          <p>{outcome === 'rejected'
            ? 'They get a polite email saying you cannot offer a space this time.'
            : `They are taken off the door list and the vendor directory, and get an email.${a.paidCents > 0 ? ` ${formatMoney(a.paidCents, a.currency)} already paid is yours to refund.` : ''}`}</p>
          <label className="fx-stack gap-1 text-sm">
            <span>Reason (optional, included in the email)</span>
            <textarea className="es-input py-2" rows={2} maxLength={500} onChange={(e) => { reason = e.target.value; }} />
          </label>
        </div>
      ),
      confirmLabel: outcome === 'rejected' ? 'Decline' : 'Cancel booking',
    });
    if (ok) await act('close', { outcome, reason: reason.trim() || null }, outcome === 'rejected' ? 'Declined.' : 'Booking cancelled.');
  }

  return (
    <div className="fx-stack">
      <Link href={`/organizer/events/${eventId}/vendors`} className="es-sp-back"><NavIcon name="arrow" size={16} />All vendors</Link>

      <header className="es-sp-dealhead">
        {a.logoUrl
          // eslint-disable-next-line @next/next/no-img-element -- the vendor's logo
          ? <img src={a.logoUrl} alt="" className="es-sp-dealhead__logo" />
          : <span className="es-sp-dealhead__initial" aria-hidden="true">{a.businessName.slice(0, 1).toUpperCase()}</span>}
        <div className="fx-min0">
          <h1 className="es-section-title fx-break">{a.businessName}</h1>
          <p className="es-sp-dealhead__meta">
            <VendorStatus status={a.status} expired={a.expired} />
            {a.category && <span>{a.category}</span>}
            {a.boothName && <span>{a.boothName}</span>}
            {a.boothLabel && <span className="es-pill">Booth {a.boothLabel}</span>}
            {['offered', 'confirmed', 'paid'].includes(a.status) && <b className="es-nums">{a.amountCents > 0 ? formatMoney(a.amountCents, a.currency) : 'Free'}</b>}
          </p>
        </div>
        <div className="es-sp-dealhead__actions">
          {a.stage === 'submitted' && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => act('waitlist', { waitlisted: true }, 'Moved to the waitlist.')}>Waitlist</button>}
          {a.stage === 'waitlisted' && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => act('waitlist', { waitlisted: false }, 'Back in New.')}>Off the waitlist</button>}
          {open && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => close('rejected')}>Decline</button>}
          {a.stage === 'confirmed' && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => close('cancelled')}>Cancel booking</button>}
        </div>
      </header>

      {a.expired && (
        <Notice tone="warning" title="This offer has expired.">
          <p>The vendor can no longer accept it. Send it again below with a new reply-by date.</p>
        </Notice>
      )}

      <div className="es-sp-dealgrid">
        <div className="fx-stack fx-min0">
          <Panel icon="store" title="The application" description={`Received ${formatEventTime(a.createdAt, tz)}${a.requestedBoothName ? ` · asked for: ${a.requestedBoothName}` : ''}.`}>
            {a.description ? <p className="fx-break es-vd-desc">{a.description}</p> : <p className="text-sm text-muted">No description.</p>}
            {a.answers.length > 0 && (
              <dl className="es-vd-answers">
                {a.answers.map((x) => (
                  <div key={x.id}><dt>{x.label}</dt><dd className="fx-break">{x.answer || <span className="text-subtle">No answer</span>}</dd></div>
                ))}
              </dl>
            )}
          </Panel>

          <AddonsAndDocuments eventId={eventId} app={a} onChange={app.reload} />

          {open && <OfferEditor eventId={eventId} app={a} onSent={() => { toast.success('Offer sent.'); app.reload(); }} />}

          {(a.stage === 'confirmed' || a.acceptedAt) && (
            <BookingPanel eventId={eventId} app={a} tz={tz} onChange={app.reload} />
          )}

          {a.acceptedAt && (
            <Panel icon="pencil" title="Signed terms" description={`Accepted by ${a.signerName} (${a.signerEmail}) on ${formatEventTime(a.acceptedAt, tz)}.`}>
              <AgreementText text={a.terms} />
              {a.signatureSvg && (
                <figure className="es-sp-signature">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an SVG the API rendered from checked pen points */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(a.signatureSvg)}`} alt={`Signature of ${a.signerName}`} />
                  <figcaption className="text-xs text-subtle">{a.signatureMethod === 'typed' ? 'Typed signature' : 'Drawn signature'} · fingerprint {a.signatureSha256?.slice(0, 16)}…</figcaption>
                </figure>
              )}
            </Panel>
          )}

          <History items={a.history} tz={tz} />
        </div>
        <div className="fx-stack fx-min0">
          <Panel icon="user" title="Contact">
            <dl className="es-sp-contact">
              {a.contactName && <div><dt>Name</dt><dd>{a.contactName}</dd></div>}
              <div><dt>Email</dt><dd className="fx-break"><a href={`mailto:${a.contactEmail}`}>{a.contactEmail}</a></dd></div>
              {a.contactPhone && <div><dt>Phone</dt><dd><a href={`tel:${a.contactPhone}`}>{a.contactPhone}</a></dd></div>}
              {a.website && <div><dt>Website</dt><dd className="fx-break"><a href={a.website} target="_blank" rel="noreferrer noopener">{a.website.replace(/^https?:\/\//, '')}</a></dd></div>}
            </dl>
          </Panel>
          <BusinessFacts app={a} />
          <NotesPanel eventId={eventId} app={a} onSaved={app.reload} />
        </div>
      </div>
    </div>
  );
}

// ── The offer ─────────────────────────────────────────────────────────────
const dateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const addDays = (n) => new Date(Date.now() + n * 86400e3).toISOString();

function OfferEditor({ eventId, app, onSent }) {
  const booths = useApi(`/events/${eventId}/vendors/booths`);
  const program = useApi(`/events/${eventId}/vendors/program`);
  const floor = useApi(`/events/${eventId}/vendors/floor-plan`);
  if (booths.error || program.error) return <ErrorNotice error={booths.error || program.error} onRetry={() => { booths.reload(); program.reload(); }} />;
  if (!booths.data || !program.data) return <Loading variant="card" label="Loading the offer" />;
  if (booths.data.length === 0) {
    return (
      <Notice tone="info" title="Add a booth type first.">
        <p>An offer is for a booth type — go to Vendors › Booths and add the spaces you sell.</p>
      </Notice>
    );
  }
  return <OfferForm eventId={eventId} app={app} booths={booths.data} program={program.data} floor={floor.data} onSent={onSent} />;
}

function OfferForm({ eventId, app, booths, program, floor, onSent }) {
  const currency = app.currency;
  const byId = (id) => booths.find((b) => b.id === id) || null;
  const first = byId(app.boothTypeId) || byId(app.requestedBoothTypeId) || booths.find((b) => b.isActive) || booths[0];
  const revising = app.stage === 'offered';
  // The add-ons the vendor chose join the booth fee (2026-11-21); the organizer can still change the amount.
  const extra = (app.addons || []).reduce((s, x) => s + x.priceCents, 0);
  const [form, setForm] = useState(() => ({
    boothTypeId: first.id,
    fee: centsToInput(revising ? app.amountCents : first.priceCents + extra, currency),
    boothLabel: app.boothLabel || '',
    staffPasses: String(revising ? app.staffPasses : first.staffPasses),
    includes: (revising ? app.includes : first.includes).join('\n'),
    terms: app.terms || program.defaultTerms || STARTER_VENDOR_TERMS,
    expires: dateInput(app.offerExpiresAt && new Date(app.offerExpiresAt) > new Date() ? app.offerExpiresAt : addDays(7)),
    boothKey: app.boothKey || '',
  }));
  const [picking, setPicking] = useState(false);
  const hasPlan = !!floor?.plan?.elements?.some((e) => e.kind === 'booth');
  const picked = hasPlan && form.boothKey ? floor.plan.elements.find((e) => e.id === form.boothKey) : null;

  /** A booth chosen on the map brings its code and its type (with that type's fee, passes and inclusions). */
  function pickBooth(el) {
    const b = el.boothTypeId ? byId(el.boothTypeId) : null;
    setForm((f) => ({
      ...f, boothKey: el.id, boothLabel: el.code || f.boothLabel,
      ...(b ? { boothTypeId: b.id, fee: centsToInput(b.priceCents + extra, currency), staffPasses: String(b.staffPasses), includes: b.includes.join('\n') } : {}),
    }));
    setPicking(false);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cents = form.fee === '' ? 0 : parseMoneyToCents(form.fee, currency);
  const chosen = byId(form.boothTypeId);

  function chooseBooth(e) {
    const b = byId(e.target.value);
    setForm((f) => ({
      ...f, boothTypeId: e.target.value,
      ...(b ? { fee: centsToInput(b.priceCents + extra, currency), staffPasses: String(b.staffPasses), includes: b.includes.join('\n') } : {}),
    }));
  }

  async function submit(e) {
    e.preventDefault();
    if (cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/vendors/applications/${app.id}/offer`, {
        boothTypeId: form.boothTypeId,
        boothKey: form.boothKey || null,
        amountCents: cents,
        boothLabel: form.boothLabel.trim() || null,
        staffPasses: Number(form.staffPasses) || 0,
        includes: form.includes.split('\n').map((x) => x.trim()).filter(Boolean),
        terms: form.terms,
        expiresAt: form.expires ? new Date(`${form.expires}T23:59:00`).toISOString() : null,
      }, { noRedirect: true });
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon="send" title={revising ? 'Revise the offer' : 'Offer a space'} description={`It is emailed to ${app.contactEmail}, who signs in with that address to accept and pay.`}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        {hasPlan && (
          <div className="es-vd-pick">
            <div className="fx-row fx-row--between gap-2">
              <span className="text-sm">
                <b>Booth on the floor plan:</b>{' '}
                {picked ? `${picked.code || 'Booth'} ` : 'none chosen '}
              </span>
              <span className="fx-row gap-1">
                <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setPicking((v) => !v)}>
                  <NavIcon name="map" size={16} />{picking ? 'Close the map' : picked ? 'Change booth' : 'Choose on the floor plan'}
                </button>
                {picked && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setForm((f) => ({ ...f, boothKey: '' }))}>Remove</button>}
              </span>
            </div>
            {picking && (
              <FloorPlanViewer
                floorPlan={floor}
                currency={currency}
                pickable
                pickedKey={form.boothKey || null}
                canPick={(el, st) => !st || st.status === 'available' || st.applicationId === app.id}
                onPick={pickBooth}
                title="Choose a booth"
              />
            )}
          </div>
        )}
        <div className="fx-grid fx-grid--2">
          <SelectField label="Booth type" name="of-booth" value={form.boothTypeId} onChange={chooseBooth}
            options={booths.filter((b) => b.isActive || b.id === app.boothTypeId).map((b) => [b.id, `${b.name}${b.remaining === 0 ? ' — fully booked' : b.remaining !== null ? ` — ${b.remaining} left` : ''}`])}
            hint={chosen?.remaining === 0 ? 'Fully booked: they can only accept if another vendor cancels.' : 'Spaces are only taken when a vendor accepts.'} />
          <Field label={`Booth fee (${currency})`} name="of-fee" inputMode="decimal" placeholder={moneyPlaceholder(currency)} value={form.fee} onChange={set('fee')}
            error={cents === null ? 'Enter an amount, e.g. 150.' : null} hint="0 for a free space." />
          <Field label="Booth number" name="of-label" optional maxLength={40} value={form.boothLabel} onChange={set('boothLabel')} placeholder="A12" />
          <Field label="Staff passes" name="of-passes" type="number" min={0} max={50} value={form.staffPasses} onChange={set('staffPasses')} />
          <Field label="Reply by" name="of-expires" type="date" optional min={dateInput(addDays(1))} value={form.expires} onChange={set('expires')}
            hint="After this date the offer can no longer be accepted." />
        </div>
        <TextareaField label="What is included" name="of-includes" optional rows={3} value={form.includes} onChange={set('includes')} hint="One per line." />
        <TextareaField label="Terms" name="of-terms" rows={8} required maxLength={20000} value={form.terms} onChange={set('terms')}
          hint="What the vendor signs. The space, fee, booth number and passes above are shown with it." />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} disabled={cents === null}><NavIcon name="send" size={18} />{revising ? 'Send revised offer' : 'Send offer'}</SubmitButton>
        </div>
      </form>
    </Panel>
  );
}

// ── The booking (accepted) ────────────────────────────────────────────────
function BookingPanel({ eventId, app, tz, onChange }) {
  const toast = useToast();
  const [marking, setMarking] = useState(false);
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [boothLabel, setBoothLabel] = useState(app.boothLabel || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function markPaid(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/vendors/applications/${app.id}/paid`, { method, reference: reference.trim() || null }, { noRedirect: true });
      toast.success(`${formatMoney(app.amountCents, app.currency)} recorded as paid.`);
      setMarking(false);
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveBooth() {
    try {
      await patch(`/events/${eventId}/vendors/applications/${app.id}`, { boothLabel: boothLabel.trim() || null }, { noRedirect: true });
      toast.success('Booth number saved.');
      onChange();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <Panel icon="coins" title="Booking">
      <dl className="es-sp-facts">
        <div><dt>Booth fee</dt><dd className="es-nums">{app.amountCents > 0 ? formatMoney(app.amountCents, app.currency) : 'Free'}</dd></div>
        <div><dt>Paid</dt><dd>{app.paidAt ? `${formatEventTime(app.paidAt, tz, { time: false })} · ${METHOD_LABEL[app.paidMethod] || 'Free'}${app.paidReference ? ` · ${app.paidReference}` : ''}` : 'Not yet'}</dd></div>
        <div><dt>Staff named</dt><dd>{app.staff.length} of {app.staffPasses}</dd></div>
      </dl>

      {app.includes.length > 0 && (
        <ul className="es-sp-benefits mt-3">{app.includes.map((x) => <li key={x}><NavIcon name="check" size={16} />{x}</li>)}</ul>
      )}

      {app.stage === 'confirmed' && (
        <div className="es-vd-boothrow">
          <label className="fx-stack gap-1 text-sm fx-min0">
            <span className="es-label"><span>Booth number</span></span>
            <input className="es-input" maxLength={40} value={boothLabel} onChange={(e) => setBoothLabel(e.target.value)} placeholder="A12" />
          </label>
          {(boothLabel.trim() || null) !== (app.boothLabel || null) && <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={saveBooth}>Save</button>}
        </div>
      )}

      {app.staff.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">Staff on the door list</p>
          <ul className="es-vd-staff">{app.staff.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}

      {app.stage === 'confirmed' && !app.paidAt && app.amountCents > 0 && (
        marking ? (
          <form onSubmit={markPaid} className="es-sp-markpaid mt-3">
            <SelectField label="How it was paid" name="vp-method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
            <Field label="Reference" name="vp-ref" optional maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
            <FormError error={error} />
            <div className="fx-row">
              <SubmitButton busy={busy}>Confirm {formatMoney(app.amountCents, app.currency)} received</SubmitButton>
              <button type="button" className="es-btn es-btn--ghost" onClick={() => setMarking(false)} disabled={busy}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="fx-row mt-3">
            <button type="button" className="es-btn es-btn--secondary" onClick={() => setMarking(true)}>Mark booth fee as paid</button>
            <span className="text-xs text-subtle">Card payments record themselves.</span>
          </div>
        )
      )}
    </Panel>
  );
}

function NotesPanel({ eventId, app, onSaved }) {
  const toast = useToast();
  const [notes, setNotes] = useState(app.notes || '');
  const [busy, setBusy] = useState(false);
  const dirty = (notes.trim() || null) !== (app.notes || null);
  async function save() {
    setBusy(true);
    try {
      await patch(`/events/${eventId}/vendors/applications/${app.id}`, { notes: notes.trim() || null }, { noRedirect: true });
      toast.success('Notes saved.');
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel icon="lock" title="Private notes" description="Only you see these — never the vendor.">
      <div className="fx-stack fx-stack--sm">
        <TextareaField label="Notes" name="va-notes" rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {dirty && <div className="fx-row"><button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save notes'}</button></div>}
      </div>
    </Panel>
  );
}

function History({ items, tz }) {
  if (!items?.length) return null;
  return (
    <Panel icon="clock" title="History">
      <ol className="es-sp-history">
        {[...items].reverse().map((h) => (
          <li key={h.id}>
            <span className="es-sp-history__what">
              {HISTORY[h.kind] || h.kind}
              {h.kind === 'payment_recorded' && h.detail?.method ? ` — ${METHOD_LABEL[h.detail.method] || h.detail.method}` : ''}
              {['rejected', 'cancelled', 'withdrawn'].includes(h.kind) && h.detail?.reason ? ` — ${h.detail.reason}` : ''}
            </span>
            <span className="text-xs text-subtle">{formatEventTime(h.at, tz)}{h.by ? ` · ${h.by}` : ''}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
