'use client';

import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { actRefusal, REFUSAL } from '../../lib/roleLadder';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import { useOrganizerBan } from './useOrganizerBan';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every organizer, with their standing (BRD §19).
 *
 * BANNING IS NOT BLOCKING, and the confirmation says so. A banned organizer
 * still signs in and still sees the commission invoice they owe — an organizer
 * who cannot see the invoice cannot pay it — but nothing new goes on sale.
 * Published events are NOT pulled automatically; an admin suspends those
 * deliberately, from the event. The ban itself is useOrganizerBan, shared with
 * the Accounts page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STANDING = [
  { value: '', label: 'Everyone' },
  { value: 'false', label: 'Active' },
  { value: 'true', label: 'Banned' },
];

/**
 * Why this admin may not ban or unban this organizer, or null.
 *
 * The RULE is `lib/roleLadder`, mirroring the API's `mayActOn`; only the
 * wording is this screen's. It used to be written out here with its own level
 * map, which defaulted an unknown role to 1 where the API — and the copy on the
 * Accounts page — used 0. Harmless at today's levels, and exactly the shape of
 * drift that stops being harmless later.
 */
const WHY = {
  [REFUSAL.SELF]: 'Your own organizer — ask another administrator.',
  [REFUSAL.SUPERIOR]: 'Owned by a superior; not actionable from here.',
  [REFUSAL.EQUAL]: 'Owned by an equal; not actionable from here.',
};

function cannotActOn(owner, me) {
  return WHY[actRefusal(me, owner)] || null;
}

const PAYOUTS = [
  { value: '', label: 'Any payouts' },
  { value: 'ready', label: 'Can be paid' },
  { value: 'missing', label: 'Payouts not set up' },
];

export default function AdminOrganizers() {
  const { user: me } = useAuth();
  const { get, set, page } = useUrlFilters();
  const banned = get('banned');
  const payouts = get('payouts');
  const q = get('q');

  const query = new URLSearchParams({ limit: '25', page: String(page) });
  if (banned) query.set('banned', banned);
  if (payouts) query.set('payouts', payouts);
  if (q) query.set('q', q);

  const { data, error, loading, reload } = useApi(`/admin/organizers?${query}`, { raw: true });
  const { toggleBan, busyId } = useOrganizerBan(reload);
  const rows = data?.data || [];

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="People"
        title="Organizers"
        lede="Who sells on Eventsli, whether they can be paid, and whether they are allowed to."
      />

      <div className="fx-stack fx-stack--sm">
        <div className="fx-row">
          <Segmented label="Standing" value={banned} onChange={(v) => set('banned', v)} options={STANDING} />
          <Segmented label="Payouts" value={payouts} onChange={(v) => set('payouts', v)} options={PAYOUTS} />
        </div>
        <SearchBox label="Search organizers" placeholder="Organizer name" value={q} onSearch={(v) => set('q', v)} />
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={5} label="Loading organizers" />
      ) : rows.length === 0 ? (
        <Empty title="No organizers match." hint="Try another filter, or search accounts by email under Accounts." />
      ) : (
        <>
          <DataTable
            caption="Organizers"
            rows={rows}
            columns={[
              {
                key: 'organizer',
                label: 'Organizer',
                primary: true,
                render: (o) => (
                  <span className="fx-stack fx-stack--sm gap-0.5">
                    <span className="fx-break font-medium text-ink">{o.displayName}</span>
                    <span className="fx-break text-sm text-muted">{o.owner?.email}</span>
                  </span>
                ),
              },
              { key: 'country', label: 'Country', render: (o) => o.country },
              {
                key: 'events',
                label: 'Events',
                render: (o) => (
                  <Link href={`/admin/events?organizerId=${o.id}`} className="es-nums whitespace-nowrap hover:text-accent">
                    {o.events.published} on sale · {o.events.total} total
                    {o.events.pendingReview > 0 && ` · ${o.events.pendingReview} in review`}
                  </Link>
                ),
              },
              {
                key: 'sales',
                label: 'Sales',
                render: (o) => {
                  const entries = Object.entries(o.sales || {});
                  if (!entries.length) return <span className="text-muted">None</span>;
                  return (
                    <span className="es-nums fx-stack fx-stack--sm gap-0.5">
                      {entries.map(([cur, s]) => <span key={cur}>{formatMoney(s.grossCents, cur)}</span>)}
                    </span>
                  );
                },
              },
              {
                key: 'standing',
                label: 'Standing',
                render: (o) => (
                  <span className="fx-row">
                    <span className={`es-pill ${o.canReceivePayouts ? 'es-pill--accent' : ''}`}>
                      {o.canReceivePayouts ? 'Can be paid' : 'Payouts not set up'}
                    </span>
                    {o.isBanned && <span className="es-pill es-pill--danger">Banned</span>}
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                hideLabel: true,
                align: 'end',
                render: (o) => {
                  const why = cannotActOn(o.owner, me);
                  if (why) return <span className="block max-w-[26ch] text-right text-xs text-subtle">{why}</span>;
                  return (
                    <button
                      type="button"
                      disabled={busyId === o.id}
                      onClick={() => toggleBan(o)}
                      className={`es-btn es-btn--sm ${o.isBanned ? 'es-btn--secondary' : 'es-btn--danger'}`}
                    >
                      {busyId === o.id ? 'Working…' : o.isBanned ? 'Lift ban' : 'Ban from selling'}
                    </button>
                  );
                },
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={(n) => set('page', String(n))} />
        </>
      )}
    </div>
  );
}
