'use client';

import { useState } from 'react';
import { formatMoney } from '../../../../utils/money';
import { formatEventTime } from '../../../../lib/eventTime';
import { useApi } from '../../../../hooks/useApi';
import { SectionHeader } from '../../../../components/ui/Page';
import { KpiRow, Kpi } from '../../../../components/ui/Kpi';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { StatusPill, LevelBadge } from '../../../../components/sponsors/sponsorUi';
import { useEventContext } from '../EventContext';
import { useContentSection } from '../content/useContentSection';
import SponsorsEditor from '../content/SponsorsEditor';
import { SetupGuide, PartnerList, PartnerActions, PartnerOff, DutyNote } from '../_partners/PartnerParts';
import Packages from './Packages';
import ProgramSettings from './ProgramSettings';
import NewLead from './NewLead';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPONSORS — one event's sponsorship desk, rebuilt 2026-11-23 so an organizer
 * can follow it without a manual (owner: "a hardship journey").
 *
 *   Sponsors          the setup guide until it is done, then every sponsor as
 *                     a plain row with filters (was: a five-column board),
 *                     and the logos added by hand (were on "Page & branding" —
 *                     two places for one list, and nothing said which to use)
 *   Packages          what you sell
 *   Page & settings   the public "Become a sponsor" page, the agreement, how
 *                     to pay without a card
 *
 * A deal opens on its own page (./[dealId]). A deal paid in full shows on the
 * event page by itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const VIEWS = [['list', 'Sponsors'], ['packages', 'Packages'], ['page', 'Page & settings']];

/** The board's columns, in the words of somebody who has never run a sales pipeline. */
const FILTERS = [
  { key: 'lead', label: 'New' },
  { key: 'proposal', label: 'Proposal sent' },
  { key: 'signed', label: 'Signed' },
  { key: 'paid', label: 'Paid' },
  { key: 'closed', label: 'Closed' },
];

export default function Sponsors({ eventId }) {
  const ctx = useEventContext();
  const event = ctx?.event;
  if (event && !event.partners?.sponsors) {
    return (
      <div className="fx-stack">
        <SectionHeader icon="handshake" title="Sponsors" />
        <PartnerOff eventId={eventId} kind="sponsors" />
      </div>
    );
  }
  return <SponsorsDesk eventId={eventId} event={event} />;
}

function SponsorsDesk({ eventId, event }) {
  const [view, setView] = useState('list');
  const [adding, setAdding] = useState(false);
  const deals = useApi(`/events/${eventId}/sponsorship/deals`);
  const packages = useApi(`/events/${eventId}/sponsorship/packages`);
  const program = useApi(`/events/${eventId}/sponsorship/program`);
  const shown = useContentSection(eventId, 'sponsors');

  const currency = deals.data?.currency || event?.currency || 'USD';
  const t = deals.data?.totals;
  const list = deals.data?.deals || [];
  const isOpen = !!program.data?.isOpen;
  const add = () => { setView('list'); setAdding(true); };

  const steps = [
    {
      key: 'packages',
      title: 'Decide what you sell',
      text: 'Make one or more packages — Gold, Silver, a stage banner — with a price and what each includes.',
      done: (packages.data || []).length > 0,
      action: { label: 'Add a package', onClick: () => setView('packages') },
    },
    {
      key: 'page',
      title: 'Open your sponsor page',
      text: 'A public page that lists your packages and lets brands ask to sponsor. Their requests arrive here and by email.',
      done: isOpen,
      action: { label: 'Set up the page', onClick: () => setView('page') },
    },
    {
      key: 'first',
      title: 'Add your first sponsor',
      text: 'Or add a brand you are already talking to. You send them a proposal; they sign and pay online.',
      done: list.length > 0,
      action: { label: 'Add a sponsor', onClick: add },
    },
  ];

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="handshake"
        title="Sponsors"
        lede="Sell sponsorship of this event. Paid sponsors appear on your event page automatically."
        actions={<PartnerActions eventId={eventId} kind="sponsors" publicHref={event?.slug && isOpen ? `/e/${event.slug}/sponsor` : null} />}
      />

      {deals.data && packages.data && program.data && <SetupGuide title="Get set up in three steps" steps={steps} />}

      <div role="group" aria-label="Sponsorship sections" className="es-segmented">
        {VIEWS.map(([key, label]) => (
          <button key={key} type="button" className="es-segmented__option" aria-pressed={view === key} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'list' && (
        <>
          {t && list.length > 0 && (
            <KpiRow label="Sponsorship totals" tiles>
              <Kpi icon="handshake" label="Signed" value={formatMoney(t.signedCents, currency)} note={`${t.sponsors} ${t.sponsors === 1 ? 'sponsor' : 'sponsors'}`} featured />
              <Kpi icon="coins" label="Received" value={formatMoney(t.paidCents, currency)} tone="success" />
              <Kpi icon="clock" label="Still to collect" value={formatMoney(t.outstandingCents, currency)} tone={t.outstandingCents > 0 ? 'warning' : undefined} />
            </KpiRow>
          )}
          <SponsorList
            eventId={eventId}
            deals={deals}
            currency={currency}
            timezone={event?.timezone}
            adding={adding}
            onAdd={() => setAdding(true)}
          />
          {adding && <NewLead eventId={eventId} packages={packages.data || []} onCancel={() => setAdding(false)} />}

          {/* Logos added by hand: a sponsor arranged outside Eventsli, shown
              on the page with no package or payment here. */}
          <SponsorsEditor eventId={eventId} section={shown} />

          <DutyNote title="You deliver every benefit you sell">
            You alone are responsible for providing what each sponsorship includes, and for any refund. Card payments go
            straight to your own Stripe account, as ticket sales do; payments made another way you record on the sponsor yourself.
          </DutyNote>
        </>
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

function SponsorList({ eventId, deals, currency, timezone, adding, onAdd }) {
  if (deals.error) return <ErrorNotice error={deals.error} onRetry={deals.reload} />;
  if (!deals.data) return <Loading variant="card" label="Loading sponsors" />;
  const rows = deals.data.deals.map((d) => ({
    id: d.id,
    column: d.column,
    href: `/organizer/events/${eventId}/sponsors/${d.id}`,
    logoUrl: d.logoUrl,
    name: d.companyName,
    sub: [d.packageName || 'Custom', d.source === 'inquiry' && d.stage === 'lead' ? 'Asked through your page' : null].filter(Boolean).join(' · '),
    end: (
      <>
        <span className="fx-row gap-2">
          <LevelBadge level={d.level} />
          {d.amountCents > 0 && <b className="es-nums">{formatMoney(d.amountCents, d.currency || currency)}</b>}
        </span>
        <StatusPill status={d.status} expired={d.expired} />
        {d.nextDue && (
          <span className="text-xs text-subtle">
            Next {formatMoney(d.nextDue.amountCents, d.currency || currency)} · {formatEventTime(d.nextDue.dueAt, timezone, { time: false })}
          </span>
        )}
      </>
    ),
  }));

  return (
    <div className="fx-stack fx-stack--sm">
      <div className="fx-row fx-row--between gap-2">
        <h2 className="es-panel-head__title">Your sponsors</h2>
        {!adding && (
          <button type="button" className="es-btn es-btn--primary" onClick={onAdd}>
            <NavIcon name="plus" size={18} />Add a sponsor
          </button>
        )}
      </div>
      <PartnerList
        label="Sponsors"
        filters={FILTERS}
        rows={rows}
        empty={!adding && <p className="text-sm text-muted">No sponsors yet. They appear here as brands ask through your page, or when you add one.</p>}
      />
    </div>
  );
}
