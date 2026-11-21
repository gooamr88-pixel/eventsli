'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import { KpiRow, Kpi } from '../../../../components/ui/Kpi';
import Field, { TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { VendorStatus } from '../../../../components/vendors/vendorUi';
import { useEventContext } from '../EventContext';
import Booths from './Booths';
import VendorProgram from './VendorProgram';
import DoorList from './DoorList';
import FloorPlanEditor from './FloorPlanEditor';
import Addons from './Addons';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDORS (owner, 2026-11-20) — the organizer's vendor desk for one event.
 *
 *   Applications  every business that applied or was added: New → Waitlist →
 *                 Offer sent → Accepted → Booked, with closed ones apart
 *   Floor plan    the hall drawn to scale-ish: walls, doors, the stage, and
 *                 the booths themselves, each with a code and a type
 *   Booths        the spaces sold: price, how many, staff passes, inclusions
 *   Add-ons       extras on top of a booth: booth and marketing (2026-11-21)
 *   Door list     booked vendors and the staff they named, printable
 *   Vendor page   the public page and form: deadline, categories, questions,
 *                 the terms vendors sign, how to pay offline, info for the day
 *
 * An application opens on its own page (./[appId]) to read the answers, send
 * an offer, record the booth fee or close it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const VIEWS = [['apps', 'Applications'], ['plan', 'Floor plan'], ['booths', 'Booths'], ['addons', 'Add-ons'], ['door', 'Door list'], ['page', 'Vendor page']];

export default function Vendors({ eventId }) {
  const event = useEventContext()?.event;
  const [view, setView] = useState('apps');
  const apps = useApi(`/events/${eventId}/vendors/applications`);
  const booths = useApi(`/events/${eventId}/vendors/booths`);
  const program = useApi(`/events/${eventId}/vendors/program`);
  const currency = apps.data?.currency || event?.currency || 'USD';
  const t = apps.data?.totals;

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="store"
        title="Vendors"
        lede="Fill your event with vendors: take applications, offer spaces, collect booth fees and keep the door list. Booked vendors are listed on your event page."
        actions={event?.slug && program.data?.isOpen ? (
          <a className="es-btn es-btn--secondary" href={`/e/${event.slug}/vendors`} target="_blank" rel="noreferrer">
            <NavIcon name="external" size={18} />View vendor page
          </a>
        ) : null}
      />

      {t && (
        <KpiRow label="Vendor totals" tiles>
          <Kpi icon="mail" label="New applications" value={String(t.newCount)} tone={t.newCount > 0 ? 'warning' : undefined} />
          <Kpi icon="store" label="Booked vendors" value={String(t.booked)} featured />
          <Kpi icon="coins" label="Booth fees received" value={formatMoney(t.paidCents, currency)} tone="success" />
          <Kpi icon="clock" label="Still to collect" value={formatMoney(t.outstandingCents, currency)} note={t.offeredCents ? `${formatMoney(t.offeredCents, currency)} in open offers` : null} />
        </KpiRow>
      )}

      <div role="group" aria-label="Vendor sections" className="es-segmented">
        {VIEWS.map(([key, label]) => (
          <button key={key} type="button" className="es-segmented__option" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>
        ))}
      </div>

      {view === 'apps' && <Board eventId={eventId} apps={apps} programOpen={!!program.data?.isOpen} onOpenPage={() => setView('page')} />}
      {view === 'plan' && <FloorPlanEditor eventId={eventId} currency={currency} />}
      {view === 'booths' && <Booths eventId={eventId} currency={currency} state={booths} onChange={() => { booths.reload(); apps.reload(); }} />}
      {view === 'addons' && <Addons eventId={eventId} currency={currency} />}
      {view === 'door' && <DoorList eventId={eventId} eventTitle={event?.title} />}
      {view === 'page' && <VendorProgram eventId={eventId} state={program} slug={event?.slug} timezone={event?.timezone} />}
    </div>
  );
}

function Board({ eventId, apps, programOpen, onOpenPage }) {
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState('');
  if (apps.error) return <ErrorNotice error={apps.error} onRetry={apps.reload} />;
  if (!apps.data) return <Loading variant="card" label="Loading applications" />;
  const { columns, applications } = apps.data;
  const categories = [...new Set(applications.map((a) => a.category).filter(Boolean))].sort();
  const list = category ? applications.filter((a) => a.category === category) : applications;

  return (
    <div className="fx-stack">
      <section className="es-payintro" data-tone="info" aria-labelledby="vd-duty">
        <span className="es-payintro__icon" aria-hidden="true"><NavIcon name="store" size={26} /></span>
        <div className="fx-min0">
          <h3 id="vd-duty" className="es-payintro__title">You provide the space; vendors answer for what they sell.</h3>
          <p className="es-payintro__text">
            You are responsible for the spaces and what each offer includes, and for any refund. Card booth fees go
            straight to your own Stripe account, as ticket sales do; fees paid another way you record here yourself.
          </p>
        </div>
      </section>

      <div className="fx-row fx-row--between gap-2">
        <p className="text-sm text-muted">
          {programOpen
            ? 'Businesses apply from your public vendor page. New applications land in the first column.'
            : <>Your public vendor page is off. <button type="button" className="es-sp-linkbtn" onClick={onOpenPage}>Open it</button> to take applications, or add vendors yourself.</>}
        </p>
        <div className="fx-row gap-2">
          {categories.length > 1 && (
            <select className="es-input es-input--sm" aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {!adding && <button type="button" className="es-btn es-btn--primary" onClick={() => setAdding(true)}><NavIcon name="plus" size={18} />Add a vendor</button>}
        </div>
      </div>

      {adding && <NewVendor eventId={eventId} onCancel={() => setAdding(false)} />}

      {applications.length === 0 && !adding ? (
        <div className="es-sp-empty">
          <NavIcon name="store" size={36} />
          <p className="es-sp-empty__title">No vendors yet</p>
          <p className="text-sm text-muted">Add your booth types, open your vendor page, or add a vendor you already work with.</p>
        </div>
      ) : (
        <div className="es-sp-board" role="list" aria-label="Vendor applications">
          {columns.map((col) => {
            const items = list.filter((a) => a.column === col.key);
            return (
              <section key={col.key} className="es-sp-col" role="listitem" aria-labelledby={`vd-col-${col.key}`} data-col={col.key}>
                <header className="es-sp-col__head">
                  <h3 id={`vd-col-${col.key}`}>{col.label}</h3>
                  <span className="es-sp-col__count">{items.length}</span>
                </header>
                {items.length === 0 ? <p className="es-sp-col__none">Nothing here</p> : (
                  <ul className="es-sp-col__list">
                    {items.map((a) => (
                      <li key={a.id}>
                        <Link href={`/organizer/events/${eventId}/vendors/${a.id}`} className="es-sp-card">
                          <span className="es-sp-card__top">
                            {a.logoUrl
                              // eslint-disable-next-line @next/next/no-img-element -- the vendor's logo, from storage
                              ? <img src={a.logoUrl} alt="" className="es-sp-card__logo" />
                              : <span className="es-sp-card__initial" aria-hidden="true">{a.businessName.slice(0, 1).toUpperCase()}</span>}
                            <span className="fx-min0">
                              <span className="es-sp-card__name fx-break">{a.businessName}</span>
                              <span className="es-sp-card__sub">{[a.category, a.boothName || a.requestedBoothName].filter(Boolean).join(' · ') || 'No category'}</span>
                            </span>
                          </span>
                          <span className="es-sp-card__meta">
                            {a.boothLabel ? <span className="es-pill">Booth {a.boothLabel}</span> : <span />}
                            {['offered', 'confirmed', 'paid'].includes(a.status) && <b className="es-nums">{a.amountCents > 0 ? formatMoney(a.amountCents, a.currency) : 'Free'}</b>}
                          </span>
                          <span className="es-sp-card__foot">
                            <VendorStatus status={a.status} expired={a.expired} />
                            {a.status === 'paid' && a.staffPasses > 0 && <span className="text-xs text-subtle">{a.staffCount} of {a.staffPasses} staff named</span>}
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

function NewVendor({ eventId, onCancel }) {
  const router = useRouter();
  const [form, setForm] = useState({ businessName: '', contactEmail: '', contactName: '', contactPhone: '', category: '', description: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ''));
      const app = await post(`/events/${eventId}/vendors/applications`, body, { noRedirect: true });
      router.push(`/organizer/events/${eventId}/vendors/${app.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <Panel title="Add a vendor" description="A business you already work with. You send them an offer from the next screen.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Business" name="nv-business" required maxLength={120} autoFocus value={form.businessName} onChange={set('businessName')} />
          <Field label="Contact email" name="nv-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')}
            hint="The offer goes here. They sign in with this address to accept and pay." />
          <Field label="Contact name" name="nv-name" optional maxLength={120} value={form.contactName} onChange={set('contactName')} />
          <Field label="Phone" name="nv-phone" type="tel" optional maxLength={30} value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Category" name="nv-category" optional maxLength={60} value={form.category} onChange={set('category')} placeholder="Food, Merch, Art…" />
        </div>
        <TextareaField label="What they sell" name="nv-desc" optional rows={2} maxLength={1000} value={form.description} onChange={set('description')} />
        <TextareaField label="Notes" name="nv-notes" optional rows={2} maxLength={4000} value={form.notes} onChange={set('notes')} hint="Only you see these." />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy}>Add vendor</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
