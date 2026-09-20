'use client';

import { useApi } from '../../../hooks/useApi';
import { formatMoney } from '../../../utils/money';
import { formatDay } from '../../../lib/eventTime';
import { StatCard, Panel } from '../../../components/ui/Page';
import BarChart from '../../../components/charts/BarChart';
import Ring from '../../../components/charts/Ring';
import { percent } from '../../../components/charts/chartMath';
import { Loading, ErrorNotice } from '../../../components/Feedback';

/**
 * How one event is selling — one request (`/events/:id/stats`), aggregated in
 * SQL. Every figure is the API's; nothing here adds up money.
 */
export default function EventStats({ eventId, currency }) {
  const { data, error, loading, reload } = useApi(`/events/${eventId}/stats?days=30`);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (loading || !data) return <Loading variant="stats" rows={4} label="Loading sales" />;

  const cur = data.currency || currency;
  const base = `/organizer/events/${eventId}`;
  const { issued = 0, admitted = 0 } = data.admissions || {};
  const seats = data.seats || {};
  const checkedIn = percent(admitted, issued);

  return (
    <div className="fx-stack">
      <div className="es-statgrid">
        <StatCard
          label="Revenue"
          value={formatMoney(data.grossCents, cur)}
          note={`${formatMoney(data.netCents, cur)} to you`}
          icon="money"
          href={`${base}/orders`}
        />
        <StatCard
          label="Tickets sold"
          value={data.tickets}
          note={`${data.orders} ${data.orders === 1 ? 'order' : 'orders'}`}
          icon="ticket"
          href={`${base}/attendees`}
        />
        <StatCard
          label="Seats sold"
          value={seats.total ? `${seats.sold} / ${seats.total}` : '—'}
          note={seats.held ? `${seats.held} held in checkouts right now` : 'Across the whole map'}
          icon="map"
          href={`${base}/map`}
        />
        <StatCard
          label="Card · door"
          value={`${data.byChannel?.stripe?.orders ?? 0} · ${data.byChannel?.manual?.orders ?? 0}`}
          note="Orders by channel"
          icon="receipt"
          href={`${base}/door`}
        />
      </div>

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Sales, last 30 days">
          <BarChart
            ariaLabel="Revenue per day for the last 30 days"
            format={(v) => formatMoney(v, cur)}
            data={(data.timeline || []).map((d) => ({
              label: formatDay(d.date),
              value: Number(d.grossCents),
              detail: `${formatMoney(d.grossCents, cur)} · ${d.tickets} tickets`,
            }))}
          />
        </Panel>

        <Panel title="At the door">
          <Ring
            fraction={issued ? admitted / issued : 0}
            value={checkedIn === null ? '—' : `${checkedIn}%`}
            caption={`${admitted} of ${issued} tickets checked in`}
          />
        </Panel>
      </div>

      {data.tiers?.length > 0 && (
        <Panel title="Ticket types">
          <ul className="fx-stack fx-stack--sm">
            {data.tiers.map((tier) => (
              <li key={tier.id} className="fx-stack fx-stack--sm gap-1 border-t border-border-base pt-3 first:border-0 first:pt-0">
                <div className="fx-row fx-row--between">
                  <span className="fx-min0 fx-truncate text-ink">{tier.name}</span>
                  <span className="es-nums text-sm text-muted">
                    {tier.quantity ? `${tier.sold} of ${tier.quantity}` : `${tier.sold} sold`}
                  </span>
                </div>
                {tier.quantity ? (
                  <progress
                    className="es-progress"
                    max={tier.quantity}
                    value={Math.min(tier.sold, tier.quantity)}
                    aria-label={`${tier.name}: ${tier.sold} of ${tier.quantity} sold`}
                  />
                ) : (
                  <p className="text-xs text-subtle">No cap — limited by the seat map.</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
