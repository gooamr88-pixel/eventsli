'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { formatEventTime } from '../../../../lib/eventTime';
import { useApi } from '../../../../hooks/useApi';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import { KpiRow, Kpi } from '../../../../components/ui/Kpi';
import Field, { SelectField, TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { StatusPill, LevelBadge } from '../../../../components/sponsors/sponsorUi';
import { useEventContext } from '../EventContext';
import Packages from './Packages';
import ProgramSettings from './ProgramSettings';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPONSORS (owner, 2026-11-20) — the organizer's sponsorship desk for one event.
 *
 *   Pipeline      every brand from first contact to paid: Leads → Proposal sent
 *                 → Signed → Paid, with lost and cancelled deals kept apart
 *   Packages      the prospectus: tiers, prices, how many, what is included
 *   Sponsor page  the public "Become a sponsor" page and its inquiry form,
 *                 the agreement every proposal starts from, how to pay offline
 *
 * A deal opens on its own page (./[dealId]) where the proposal is written and
 * sent, payments are recorded and the signed agreement is kept. A deal paid in
 * full puts the sponsor on the event page by itself; nothing here is copied
 * into "Page & branding" by hand.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const VIEWS = [['pipeline', 'Pipeline'], ['packages', 'Packages'], ['page', 'Sponsor page']];

export default function Sponsors({ eventId }) {
  const event = useEventContext()?.event;
  const [view, setView] = useState('pipeline');
  const deals = useApi(`/events/${eventId}/sponsorship/deals`);
  const packages = useApi(`/events/${eventId}/sponsorship/packages`);
  const program = useApi(`/events/${eventId}/sponsorship/program`);

  const currency = deals.data?.currency || event?.currency || 'USD';
  const t = deals.data?.totals;

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="handshake"
        title="Sponsors"
        lede="Sell sponsorship of this event: packages, proposals, signed agreements and payments, in one place. Paid sponsors appear on your event page automatically."
        actions={event?.slug && program.data?.isOpen ? (
          <a className="es-btn es-btn--secondary" href={`/e/${event.slug}/sponsor`} target="_blank" rel="noreferrer">
            <NavIcon name="external" size={18} />View sponsor page
          </a>
        ) : null}
      />

      {t && (
        <KpiRow label="Sponsorship totals" tiles>
          <Kpi icon="target" label="In proposals" value={formatMoney(t.pipelineCents, currency)} note={`${t.leads} ${t.leads === 1 ? 'lead' : 'leads'} waiting`} />
          <Kpi icon="handshake" label="Signed" value={formatMoney(t.signedCents, currency)} note={`${t.sponsors} ${t.sponsors === 1 ? 'sponsor' : 'sponsors'}`} featured />
          <Kpi icon="coins" label="Received" value={formatMoney(t.paidCents, currency)} tone="success" />
          <Kpi icon="clock" label="Still to collect" value={formatMoney(t.outstandingCents, currency)} tone={t.outstandingCents > 0 ? 'warning' : undefined} />
        </KpiRow>
      )}

      <div role="group" aria-label="Sponsorship sections" className="es-segmented">
        {VIEWS.map(([key, label]) => (
          <button key={key} type="button" className="es-segmented__option" aria-pressed={view === key} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'pipeline' && (
        <Pipeline eventId={eventId} deals={deals} packages={packages.data || []} currency={currency} event={event} programOpen={!!program.data?.isOpen} onOpenPage={() => setView('page')} />
      )}
      {view === 'packages' && (
        <Packages eventId={eventId} currency={currency} state={packages} onChange={() => { packages.reload(); deals.reload(); }} />
      )}
      {view === 'page' && (
        <ProgramSettings eventId={eventId} state={program} slug={event?.slug} />
      )}
    </div>
  );
}

function Pipeline({ eventId, deals, packages, currency, event, programOpen, onOpenPage }) {
  const [adding, setAdding] = useState(false);
  if (deals.error) return <ErrorNotice error={deals.error} onRetry={deals.reload} />;
  if (!deals.data) return <Loading variant="card" label="Loading sponsorships" />;

  const { columns, deals: list } = deals.data;
  const tz = event?.timezone;

  return (
    <div className="fx-stack">
      {/* Said before the first deal: the organizer delivers what is sold. */}
      <section className="es-payintro" data-tone="info" aria-labelledby="sp-duty">
        <span className="es-payintro__icon" aria-hidden="true"><NavIcon name="handshake" size={26} /></span>
        <div className="fx-min0">
          <h3 id="sp-duty" className="es-payintro__title">You deliver every benefit you sell.</h3>
          <p className="es-payintro__text">
            You alone are responsible for providing what each sponsorship includes, and for any refund. Card payments go
            straight to your own Stripe account, as ticket sales do; payments made another way you record here yourself.
          </p>
        </div>
      </section>

      <div className="fx-row fx-row--between gap-2">
        <p className="text-sm text-muted">
          {programOpen
            ? 'Brands can ask to sponsor from your public sponsor page. Their inquiries land in Leads.'
            : <>Your public sponsor page is off. <button type="button" className="es-sp-linkbtn" onClick={onOpenPage}>Open it</button> to receive inquiries, or add leads yourself.</>}
        </p>
        {!adding && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setAdding(true)}>
            <NavIcon name="plus" size={18} />Add a lead
          </button>
        )}
      </div>

      {adding && <NewLead eventId={eventId} packages={packages} onCancel={() => setAdding(false)} />}

      {list.length === 0 && !adding ? (
        <div className="es-sp-empty">
          <NavIcon name="handshake" size={36} />
          <p className="es-sp-empty__title">No sponsors yet</p>
          <p className="text-sm text-muted">Create your packages, open your sponsor page, or add a brand you are already talking to.</p>
        </div>
      ) : (
        <div className="es-sp-board" role="list" aria-label="Sponsorship pipeline">
          {columns.map((col) => {
            const items = list.filter((d) => d.column === col.key);
            const total = items.reduce((s, d) => s + d.amountCents, 0);
            return (
              <section key={col.key} className="es-sp-col" role="listitem" aria-labelledby={`sp-col-${col.key}`} data-col={col.key}>
                <header className="es-sp-col__head">
                  <h3 id={`sp-col-${col.key}`}>{col.label}</h3>
                  <span className="es-sp-col__count">{items.length}</span>
                  {total > 0 && col.key !== 'closed' && <span className="es-sp-col__sum es-nums">{formatMoney(total, currency)}</span>}
                </header>
                {items.length === 0 ? (
                  <p className="es-sp-col__none">Nothing here</p>
                ) : (
                  <ul className="es-sp-col__list">
                    {items.map((d) => (
                      <li key={d.id}>
                        <Link href={`/organizer/events/${eventId}/sponsors/${d.id}`} className="es-sp-card">
                          <span className="es-sp-card__top">
                            {d.logoUrl
                              // eslint-disable-next-line @next/next/no-img-element -- the sponsor's logo, from storage
                              ? <img src={d.logoUrl} alt="" className="es-sp-card__logo" />
                              : <span className="es-sp-card__initial" aria-hidden="true">{d.companyName.slice(0, 1).toUpperCase()}</span>}
                            <span className="fx-min0">
                              <span className="es-sp-card__name fx-break">{d.companyName}</span>
                              <span className="es-sp-card__sub">{d.packageName || 'Custom'}{d.source === 'inquiry' && d.stage === 'lead' ? ' · Inquiry' : ''}</span>
                            </span>
                          </span>
                          <span className="es-sp-card__meta">
                            <LevelBadge level={d.level} />
                            {d.amountCents > 0 && <b className="es-nums">{formatMoney(d.amountCents, d.currency)}</b>}
                          </span>
                          <span className="es-sp-card__foot">
                            <StatusPill status={d.status} expired={d.expired} />
                            {d.nextDue && (
                              <span className="text-xs text-subtle">
                                Next {formatMoney(d.nextDue.amountCents, d.currency)} · {formatEventTime(d.nextDue.dueAt, tz, { time: false })}
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewLead({ eventId, packages, onCancel }) {
  const router = useRouter();
  const [form, setForm] = useState({ companyName: '', contactName: '', contactEmail: '', contactPhone: '', website: '', packageId: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ''));
      const deal = await post(`/events/${eventId}/sponsorship/deals`, body, { noRedirect: true });
      router.push(`/organizer/events/${eventId}/sponsors/${deal.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title="New lead" description="A brand you are already talking to. You write and send the proposal from the lead.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Company" name="sp-company" required maxLength={120} autoFocus value={form.companyName} onChange={set('companyName')} />
          <Field label="Contact email" name="sp-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')}
            hint="The proposal goes here. They sign in with this address to sign and pay." />
          <Field label="Contact name" name="sp-contact" optional maxLength={120} value={form.contactName} onChange={set('contactName')} />
          <Field label="Phone" name="sp-phone" type="tel" optional maxLength={30} value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Website" name="sp-website" type="url" optional placeholder="https://" value={form.website} onChange={set('website')} />
          <SelectField label="Package" name="sp-package" optional value={form.packageId} onChange={set('packageId')}
            options={[['', 'Decide later'], ...packages.filter((p) => p.isActive).map((p) => [p.id, p.name])]} />
        </div>
        <TextareaField label="Notes" name="sp-notes" optional rows={3} maxLength={4000} value={form.notes} onChange={set('notes')}
          hint="Only you see these." />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy}>Add lead</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
