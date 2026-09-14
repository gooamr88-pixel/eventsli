'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import { useApi } from '../../hooks/useApi';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every organizer, with their standing (BRD §19).
 *
 * BANNING IS NOT BLOCKING, and the confirmation says so. A banned organizer
 * still signs in and still sees the commission invoice they owe — an organizer
 * who cannot see the invoice cannot pay it — but nothing new goes on sale.
 * Published events are NOT pulled automatically; an admin suspends those
 * deliberately, from the event.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STANDING = [
  { value: '', label: 'Everyone' },
  { value: 'false', label: 'Active' },
  { value: 'true', label: 'Banned' },
];
const PAYOUTS = [
  { value: '', label: 'Any payouts' },
  { value: 'ready', label: 'Can be paid' },
  { value: 'missing', label: 'Not set up' },
];

export default function AdminOrganizers() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const confirm = useConfirm();
  const toast = useToast();

  const banned = params.get('banned') || '';
  const payouts = params.get('payouts') || '';
  const q = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = new URLSearchParams({ limit: '25', page: String(page) });
  if (banned) query.set('banned', banned);
  if (payouts) query.set('payouts', payouts);
  if (q) query.set('q', q);

  const { data, error, loading, reload } = useApi(`/admin/organizers?${query}`, { raw: true });

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    // toString(), not `.size`, which Safari before 17 does not have.
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  async function toggleBan(org) {
    const banning = !org.isBanned;
    const answer = await confirm(banning ? {
      title: `Stop ${org.displayName} selling?`,
      tone: 'danger',
      body: (
        <>
          <p>Nothing new goes on sale and nothing listed can be changed. They can still sign in and see what they owe.</p>
          <p>Events already on sale stay live — suspend those from each event if they must come down.</p>
        </>
      ),
      confirmLabel: 'Ban from selling',
      reason: { label: 'Why?', minLength: 5, maxLength: 1000 },
    } : {
      title: `Let ${org.displayName} sell again?`,
      confirmLabel: 'Lift the ban',
    });
    if (!answer) return;

    try {
      await post(
        `/admin/organizers/${org.id}/${banning ? 'ban' : 'unban'}`,
        banning ? { reason: answer.reason } : undefined,
        { noRedirect: true },
      );
      toast.success(banning ? `${org.displayName} can no longer sell.` : `${org.displayName} can sell again.`);
      reload();
    } catch (err) {
      toast.error(err?.message || describeError(err).recovery);
    }
  }

  const rows = data?.data || [];

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Administration"
        title="Organizers"
        lede="Who sells on Eventsli, whether they can be paid, and whether they are allowed to."
      />

      <div className="fx-stack fx-stack--sm">
        <div className="fx-row">
          <Segmented label="Standing" value={banned} onChange={(v) => setParam('banned', v)} options={STANDING} />
          <Segmented label="Payouts" value={payouts} onChange={(v) => setParam('payouts', v)} options={PAYOUTS} />
        </div>
        <SearchBox label="Search organizers" placeholder="Organizer name" value={q} onSearch={(v) => setParam('q', v)} />
      </div>

      {error ? (
        <ErrorNotice error={error} />
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
                      {o.canReceivePayouts ? 'Can be paid' : 'No payouts'}
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
                render: (o) => (
                  <button type="button" onClick={() => toggleBan(o)} className="text-sm text-muted hover:text-ink">
                    {o.isBanned ? 'Lift ban' : 'Ban from selling'}
                  </button>
                ),
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={(n) => setParam('page', String(n))} />
        </>
      )}
    </div>
  );
}
