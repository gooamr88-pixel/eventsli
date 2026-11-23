'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';
import { SectionHeader } from '../../../../components/ui/Page';
import { KpiRow, Kpi } from '../../../../components/ui/Kpi';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { VendorStatus } from '../../../../components/vendors/vendorUi';
import { useEventContext } from '../EventContext';
import { SetupGuide, PartnerList, PartnerActions, PartnerOff, DutyNote } from '../_partners/PartnerParts';
import Booths from './Booths';
import Addons from './Addons';
import VendorProgram from './VendorProgram';
import FloorPlanEditor from './FloorPlanEditor';
import NewVendor from './NewVendor';
import DoorList from './DoorList';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDORS — one event's vendor desk, rebuilt 2026-11-23 (owner: "a hardship
 * journey … especially sponsors and vendors").
 *
 * It had six tabs — Applications, Floor plan, Booths, Add-ons, Door list,
 * Vendor page — and opened on a board of six empty columns. Booths were drawn
 * in two places (here and on the Event map) and priced in a third. Now:
 *
 *   Vendors           the setup guide until it is done, then every vendor as a
 *                     plain row with filters
 *   Booths & prices   booth types and the extras vendors can add, together
 *   Page & settings   the public vendor page, how vendors book, documents
 *
 * BOOTHS ARE DRAWN ON THE EVENT MAP, the one map of the room, for every event
 * that has one. A listing (display only) has no event map, so it alone keeps
 * the separate floor plan here. The vendor staff list moved to the event's
 * Door list, beside the attendees it is checked with.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FILTERS = [
  { key: 'submitted', label: 'New' },
  { key: 'waitlisted', label: 'Waitlist' },
  { key: 'offered', label: 'Offer sent' },
  { key: 'confirmed', label: 'Accepted · unpaid' },
  { key: 'paid', label: 'Booked' },
  { key: 'closed', label: 'Closed' },
];

export default function Vendors({ eventId }) {
  const event = useEventContext()?.event;
  if (event && !event.partners?.vendors) {
    return (
      <div className="fx-stack">
        <SectionHeader icon="store" title="Vendors" />
        <PartnerOff eventId={eventId} kind="vendors" />
      </div>
    );
  }
  return <VendorDesk eventId={eventId} event={event} />;
}

function VendorDesk({ eventId, event }) {
  const listing = event?.listingType === 'display_only';
  const views = [
    ['list', 'Vendors'],
    ['booths', 'Booths & prices'],
    // A listing has no event map and no Door list screen: both stay here.
    ...(listing ? [['plan', 'Floor plan'], ['door', 'Door list']] : []),
    ['page', 'Page & settings'],
  ];
  const [view, setView] = useState('list');
  const [adding, setAdding] = useState(false);
  const apps = useApi(`/events/${eventId}/vendors/applications`);
  const booths = useApi(`/events/${eventId}/vendors/booths`);
  const program = useApi(`/events/${eventId}/vendors/program`);
  const plan = useApi(`/events/${eventId}/vendors/floor-plan`);
  const currency = apps.data?.currency || event?.currency || 'USD';
  const t = apps.data?.totals;
  const list = apps.data?.applications || [];
  const isOpen = !!program.data?.isOpen;
  const mapHref = `/organizer/events/${eventId}/map`;

  const steps = [
    {
      key: 'booths',
      title: 'Set your booth types and prices',
      text: 'For example: Food stall 3×3 m, $250 · Merch table, $80. Say what each includes.',
      done: (booths.data || []).length > 0,
      action: { label: 'Add a booth type', onClick: () => setView('booths') },
    },
    {
      key: 'map',
      title: 'Place your booths on the map',
      text: listing
        ? 'Draw the floor and drop each booth where it goes, so vendors can pick their spot.'
        : 'Booths go on your Event map, beside everything else in the room, so vendors can pick their spot.',
      done: (plan.data?.booths || []).length > 0,
      action: listing ? { label: 'Open the floor plan', onClick: () => setView('plan') } : { label: 'Open the Event map', href: mapHref },
    },
    {
      key: 'page',
      title: 'Open your vendor page',
      text: 'A public page where businesses see your booths and apply or book. Or add a vendor you already work with.',
      done: isOpen || list.length > 0,
      action: { label: 'Set up the page', onClick: () => setView('page') },
    },
  ];

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="store"
        title="Vendors"
        lede="Rent booths to businesses: take applications, collect booth fees, and list booked vendors on your event page."
        actions={<PartnerActions eventId={eventId} kind="vendors" publicHref={event?.slug && isOpen ? `/e/${event.slug}/vendors` : null} />}
      />

      {apps.data && booths.data && program.data && plan.data && <SetupGuide title="Get set up in three steps" steps={steps} />}

      <div role="group" aria-label="Vendor sections" className="es-segmented">
        {views.map(([key, label]) => (
          <button key={key} type="button" className="es-segmented__option" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>
        ))}
      </div>

      {view === 'list' && (
        <>
          {t && list.length > 0 && (
            <KpiRow label="Vendor totals" tiles>
              <Kpi icon="mail" label="New applications" value={String(t.newCount)} tone={t.newCount > 0 ? 'warning' : undefined} />
              <Kpi icon="store" label="Booked vendors" value={String(t.booked)} featured />
              <Kpi icon="coins" label="Booth fees received" value={formatMoney(t.paidCents, currency)} tone="success" />
              <Kpi icon="clock" label="Still to collect" value={formatMoney(t.outstandingCents, currency)} note={t.offeredCents ? `${formatMoney(t.offeredCents, currency)} in open offers` : null} />
            </KpiRow>
          )}
          <VendorList eventId={eventId} apps={apps} adding={adding} onAdd={() => setAdding(true)} />
          {adding && <NewVendor eventId={eventId} onCancel={() => setAdding(false)} />}
          <DutyNote title="You provide the space; vendors answer for what they sell">
            You are responsible for the spaces and what each offer includes, and for any refund. Card booth fees go
            straight to your own Stripe account, as ticket sales do; fees paid another way you record on the vendor yourself.
          </DutyNote>
        </>
      )}
      {view === 'booths' && (
        <>
          <Booths eventId={eventId} currency={currency} state={booths} onChange={() => { booths.reload(); apps.reload(); }} />
          {!listing && (
            <p className="text-sm text-muted">
              <NavIcon name="map" size={16} /> Booths are placed on your{' '}
              <Link href={mapHref} className="text-accent underline">Event map</Link>.
            </p>
          )}
          <Addons eventId={eventId} currency={currency} />
        </>
      )}
      {view === 'plan' && listing && <FloorPlanEditor eventId={eventId} currency={currency} />}
      {view === 'door' && listing && <DoorList eventId={eventId} eventTitle={event?.title} />}
      {view === 'page' && <VendorProgram eventId={eventId} state={program} slug={event?.slug} timezone={event?.timezone} />}
    </div>
  );
}

function VendorList({ eventId, apps, adding, onAdd }) {
  const [category, setCategory] = useState('');
  if (apps.error) return <ErrorNotice error={apps.error} onRetry={apps.reload} />;
  if (!apps.data) return <Loading variant="card" label="Loading vendors" />;
  const all = apps.data.applications;
  const categories = [...new Set(all.map((a) => a.category).filter(Boolean))].sort();
  const rows = (category ? all.filter((a) => a.category === category) : all).map((a) => ({
    id: a.id,
    column: a.column,
    href: `/organizer/events/${eventId}/vendors/${a.id}`,
    logoUrl: a.logoUrl,
    name: a.businessName,
    sub: [a.category, a.boothLabel ? `Booth ${a.boothLabel}` : (a.boothName || a.requestedBoothName)].filter(Boolean).join(' · ') || null,
    end: (
      <>
        {['offered', 'confirmed', 'paid'].includes(a.status) && (
          <b className="es-nums">{a.amountCents > 0 ? formatMoney(a.amountCents, a.currency) : 'Free'}</b>
        )}
        <VendorStatus status={a.status} expired={a.expired} />
        {a.status === 'paid' && a.staffPasses > 0 && <span className="text-xs text-subtle">{a.staffCount} of {a.staffPasses} staff named</span>}
      </>
    ),
  }));

  return (
    <div className="fx-stack fx-stack--sm">
      <div className="fx-row fx-row--between gap-2">
        <h2 className="es-panel-head__title">Your vendors</h2>
        <div className="fx-row gap-2">
          {categories.length > 1 && (
            <select className="es-input es-input--sm" aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {!adding && <button type="button" className="es-btn es-btn--primary" onClick={onAdd}><NavIcon name="plus" size={18} />Add a vendor</button>}
        </div>
      </div>
      <PartnerList
        label="Vendors"
        filters={FILTERS}
        rows={rows}
        empty={!adding && <p className="text-sm text-muted">No vendors yet. They appear here as businesses apply through your page, or when you add one.</p>}
      />
    </div>
  );
}
