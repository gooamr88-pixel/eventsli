'use client';

import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { Panel } from '../../../components/ui/Page';
import { KpiRow, Kpi } from '../../../components/ui/Kpi';
import { Segmented } from '../../../components/ui/Filters';
import DataTable from '../../../components/ui/DataTable';
import AreaChart from '../../../components/charts/AreaChart';
import BarChart from '../../../components/charts/BarChart';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import { formatCount, formatMicros, delta, deliveryRate } from '../../../lib/smsFormat';
import { SmsPage, DeltaChip } from '../smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Delivery and cost analytics, aggregated in the database (`sms_analytics`).
 *
 * Cost is shown per currency and never summed across them: Twilio bills in
 * USD, a Vonage account may bill in EUR, and adding the two would produce a
 * number that is not a price in anything.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const WINDOWS = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }];
const pct = (n, d) => (Number(d) ? `${((Number(n) / Number(d)) * 100).toFixed(1)}%` : '—');
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function Analytics() {
  const [days, setDays] = useState('30');
  const { data, error, loading, reload } = useApi(`/admin/sms/analytics?days=${days}`);

  if (error) return <SmsPage icon="chart" title="Delivery and cost analytics"><ErrorNotice error={error} onRetry={reload} /></SmsPage>;
  if (loading && !data) return <SmsPage icon="chart" title="Delivery and cost analytics"><Loading variant="stats" rows={4} label="Loading analytics" /></SmsPage>;

  const { current: cur, previous: prev } = data;
  const t = cur.totals;
  const rate = deliveryRate(t);
  const prevRate = deliveryRate(prev.totals);
  const daily = cur.daily || [];
  const currency = cur.cost?.[0]?.currency || 'USD';

  return (
    <SmsPage icon="chart" title="Delivery and cost analytics" lede="What was sent, what arrived, what was held back and why, and what it cost.">
      <div className="fx-row fx-row--between items-center">
        <p className="text-sm text-muted">Last {days} days, against the {days} days before.</p>
        <Segmented label="Window" value={days} onChange={setDays} options={WINDOWS} />
      </div>

      <KpiRow label="Delivery figures" tiles>
        <Kpi icon="chat" label="Sent" value={formatCount(t.sent)} note={<DeltaChip value={delta(t.sent, prev.totals.sent)} />} />
        <Kpi icon="check" label="Delivered" value={rate == null ? '—' : `${rate.toFixed(1)}%`}
          note={rate == null || prevRate == null ? null : <DeltaChip value={Number((rate - prevRate).toFixed(1))} suffix=" pts" />} />
        <Kpi icon="alert" label="Failed" value={formatCount(t.failed)} iconTone="danger" />
        <Kpi icon="shield" label="Held back by policy" value={formatCount(t.blocked)} />
        <Kpi icon="help" label="Outcome unknown" value={formatCount(t.unknown)} note="Not retried, to avoid duplicates" />
        <Kpi icon="layers" label="Segments billed" value={formatCount(t.segments)} />
      </KpiRow>

      <div className="es-smsgrid es-smsgrid--even">
        <Panel icon="trend" title="Sent per day">
          {daily.length ? <AreaChart data={daily.map((d) => ({ label: dayLabel(d.day), value: Number(d.sent), detail: `${formatCount(d.delivered)} delivered` }))} ariaLabel="Messages sent per day" formatAxis={formatCount} />
            : <p className="py-10 text-center text-sm text-muted">Nothing sent in this window.</p>}
        </Panel>
        <Panel icon="coins" title="Cost per day" description={`In ${currency}${cur.cost.length > 1 ? '; other currencies below' : ''}`}>
          {daily.length ? <BarChart data={daily.slice(-14).map((d) => ({ label: dayLabel(d.day), value: Number(d.micros) }))} format={(v) => formatMicros(v, currency, { precise: 2 })} ariaLabel="Cost per day" />
            : <p className="py-10 text-center text-sm text-muted">No cost in this window.</p>}
        </Panel>
      </div>

      <Panel icon="coins" title="Cost analytics">
        <div className="fx-row gap-6">
          {(cur.cost.length ? cur.cost : [{ currency, micros: 0 }]).map((c) => {
            const before = prev.cost.find((p) => p.currency === c.currency);
            return (
              <div key={c.currency} className="fx-stack fx-stack--sm">
                <span className="text-sm text-muted">Total {c.currency}</span>
                <span className="text-2xl font-bold text-ink">{formatMicros(c.micros, c.currency, { precise: 2 })}</span>
                <DeltaChip value={delta(c.micros, before?.micros || 0)} inverse />
              </div>
            );
          })}
          <div className="fx-stack fx-stack--sm">
            <span className="text-sm text-muted">Per delivered message</span>
            <span className="text-2xl font-bold text-ink">{t.delivered && cur.cost[0] ? formatMicros(Math.round(cur.cost[0].micros / t.delivered), cur.cost[0].currency) : '—'}</span>
          </div>
        </div>
      </Panel>

      <Panel icon="globe" title="By country">
        <DataTable caption="Delivery by country" rows={(cur.byCountry || []).filter((c) => c.country)} rowKey={(r) => r.country} columns={[
          { key: 'country', label: 'Country', primary: true },
          { key: 'sent', label: 'Sent', align: 'end', render: (r) => formatCount(r.sent) },
          { key: 'delivered', label: 'Delivered', align: 'end', render: (r) => pct(r.delivered, r.sent) },
          { key: 'failed', label: 'Failed', align: 'end', render: (r) => formatCount(r.failed) },
          { key: 'blocked', label: 'Held back', align: 'end', render: (r) => formatCount(r.blocked) },
          { key: 'cost', label: 'Cost', align: 'end', render: (r) => formatMicros(r.micros, r.currency || currency, { precise: 2 }) },
        ]} />
      </Panel>

      <div className="es-smsgrid es-smsgrid--even">
        <Panel icon="send" title="By provider">
          <DataTable caption="Delivery by provider" rows={cur.byProvider || []} rowKey={(r) => r.provider_id} columns={[
            { key: 'provider_id', label: 'Provider', primary: true, render: (r) => <span className="capitalize">{r.provider_id}</span> },
            { key: 'sent', label: 'Sent', align: 'end', render: (r) => formatCount(r.sent) },
            { key: 'rate', label: 'Delivered', align: 'end', render: (r) => pct(r.delivered, r.sent) },
            { key: 'unknown', label: 'Unknown', align: 'end', render: (r) => formatCount(r.unknown) },
          ]} />
        </Panel>
        <Panel icon="layers" title="By category">
          <DataTable caption="Delivery by category" rows={cur.byCategory || []} rowKey={(r) => r.category} columns={[
            { key: 'category', label: 'Category', primary: true, render: (r) => r.category.replace('_', ' ') },
            { key: 'messages', label: 'Messages', align: 'end', render: (r) => formatCount(r.messages) },
            { key: 'sent', label: 'Sent', align: 'end', render: (r) => formatCount(r.sent) },
            { key: 'rate', label: 'Delivered', align: 'end', render: (r) => pct(r.delivered, r.sent) },
          ]} />
        </Panel>
      </div>

      <div className="es-smsgrid es-smsgrid--even">
        <Panel icon="shield" title="Why messages were held back">
          {(cur.blockReasons || []).length === 0 ? <p className="text-sm text-muted">Nothing held back.</p> : (
            <DataTable caption="Block reasons" rows={cur.blockReasons} rowKey={(r) => r.reason} columns={[
              { key: 'reason', label: 'Reason', primary: true, render: (r) => r.reason.replace(/_/g, ' ') },
              { key: 'n', label: 'Messages', align: 'end', render: (r) => formatCount(r.n) },
            ]} />
          )}
        </Panel>
        <Panel icon="alert" title="Top provider errors">
          {(cur.errors || []).length === 0 ? <p className="text-sm text-muted">No provider errors.</p> : (
            <DataTable caption="Provider error codes" rows={cur.errors} rowKey={(r) => `${r.provider_id}:${r.code}`} columns={[
              { key: 'provider_id', label: 'Provider', primary: true, render: (r) => <span className="capitalize">{r.provider_id}</span> },
              { key: 'code', label: 'Code' },
              { key: 'n', label: 'Messages', align: 'end', render: (r) => formatCount(r.n) },
            ]} />
          )}
        </Panel>
      </div>
    </SmsPage>
  );
}
