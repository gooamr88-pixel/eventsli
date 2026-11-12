'use client';

import { useState } from 'react';
import Link from 'next/link';
import { patch } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import { Panel } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import BarChart from '../../components/charts/BarChart';
import NavIcon from '../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import {
  formatCount, formatMicros, delta, deliveryRate, CATEGORY_ICON, describeActivity, relativeTime,
} from '../../lib/smsFormat';
import { SmsHeader, SmsTabs, StatTile, DeltaChip, Toggle } from './smsUi';
import CountryTable from './CountryTable';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Global SMS Management — the console's front page, laid out from the owner's
 * mockup: four figures, the country table, the four categories, delivery by
 * day, recent activity, and the go-live checklist.
 *
 * Every figure is real: it comes from `sms_analytics` over the chosen window
 * and the same window before it, so a change chip compares like with like.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const WINDOWS = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }];

function primaryCost(list, currency) {
  if (!list?.length) return { micros: 0, currency };
  return list.find((c) => c.currency === currency) || list[0];
}

function Readiness({ r, countries }) {
  const items = [
    { ok: r.providersConfigured > 0 && r.providersEnabled > 0, text: 'A provider has credentials and is turned on', href: '/admin/sms/providers' },
    { ok: r.sendersActive > 0, text: 'An approved sender (number or sender ID)', href: '/admin/sms/senders' },
    { ok: r.verifiedRoutes > 0 && countries.enabled > 0, text: 'At least one country verified and enabled', href: '/admin/sms/countries' },
    { ok: r.webhooksConfigured, text: 'Delivery receipts can reach us (public webhook URL)', href: '/admin/sms/providers' },
    { ok: r.sendingEnabled, text: 'Sending switched on', href: '/admin/sms/compliance' },
  ];
  const done = items.filter((i) => i.ok).length;
  return (
    <section className="es-smslive" aria-labelledby="sms-live-title">
      <h2 id="sms-live-title" className="es-smslive__title">{done === items.length ? 'Live and sending' : 'Ready to go live?'}</h2>
      <p className="es-smslive__lede">{done} of {items.length} steps done. Nothing is sent until every country on the route is verified.</p>
      <ul className="es-smslive__list">
        {items.map((i) => (
          <li key={i.text} data-ok={i.ok ? '' : undefined}>
            <NavIcon name={i.ok ? 'tick' : 'clock'} size={16} />
            <Link href={i.href}>{i.text}</Link>
          </li>
        ))}
      </ul>
      {r.dryRun && <p className="es-smslive__dry">Dry run is on: messages are logged, not sent.</p>}
      <Link href="/admin/sms/compliance" className="es-btn es-btn--primary es-btn--sm">Review compliance <NavIcon name="arrow" size={16} /></Link>
      <span className="es-smslive__art" aria-hidden><NavIcon name="globe" size={160} /></span>
    </section>
  );
}

export default function SmsOverview() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = Boolean(user?.isSuperAdmin);
  const [days, setDays] = useState('30');
  const { data, error, loading, reload } = useApi(`/admin/sms/overview?days=${days}`);
  const [busyKey, setBusyKey] = useState(null);

  async function toggleCategory(cat, enabled) {
    setBusyKey(cat.key);
    try {
      await patch(`/admin/sms/categories/${cat.key}`, { enabled }, { noRedirect: true });
      toast.success(`${cat.label} ${enabled ? 'turned on' : 'turned off'}.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyKey(null);
    }
  }

  const header = (
    <SmsHeader
      title="Global SMS Management"
      lede="Send and manage SMS across countries, and control where, what and how Eventsli texts."
      actions={<Link href="/admin/sms/campaigns?new=1" className="es-btn es-btn--primary"><NavIcon name="send" size={18} />New campaign</Link>}
    />
  );

  if (error) return <div className="fx-stack">{header}<SmsTabs /><ErrorNotice error={error} onRetry={reload} /></div>;
  if (loading && !data) return <div className="fx-stack">{header}<SmsTabs /><Loading variant="stats" rows={4} label="Loading SMS overview" /></div>;

  const { current, previous, countries, categories, readiness, activity, settings } = data;
  const currency = settings?.spendCurrency || 'USD';
  const cost = primaryCost(current.cost, currency);
  const prevCost = primaryCost(previous.cost, cost.currency);
  const rate = deliveryRate(current.totals);
  const prevRate = deliveryRate(previous.totals);
  const daily = current.daily || [];
  const bars = daily.slice(-7).map((d) => ({ label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: Number(d.sent) }));

  return (
    <div className="fx-stack">
      {header}
      <SmsTabs />

      {!readiness.sendingEnabled && (
        <Notice tone="info" title="Sending is switched off.">
          <p>Messages queue but are not sent until a super admin turns sending on under Compliance. Countries also stay closed until verified.</p>
        </Notice>
      )}

      <div className="fx-row fx-row--between items-center">
        <p className="text-sm text-muted">Figures for the last {days} days, compared with the {days} days before.</p>
        <Segmented label="Window" value={days} onChange={setDays} options={WINDOWS} />
      </div>

      <div className="es-smsstats">
        <StatTile icon="chat" value={formatCount(current.totals.sent)} label="SMS sent" href="/admin/sms/messages"
          delta={<DeltaChip value={delta(current.totals.sent, previous.totals.sent)} />} spark={daily.map((d) => Number(d.sent))} />
        <StatTile icon="check" value={rate == null ? '—' : `${rate.toFixed(1)}%`} label="Delivery rate" href="/admin/sms/analytics"
          delta={rate == null || prevRate == null ? <DeltaChip value={null} /> : <DeltaChip value={Number((rate - prevRate).toFixed(1))} suffix=" pts" />}
          spark={daily.map((d) => (Number(d.sent) ? Number(d.delivered) / Number(d.sent) : 0))} />
        <StatTile icon="globe" value={formatCount(countries.enabled)} label="Countries enabled" href="/admin/sms/countries"
          delta={<span className="es-smsdelta" data-tone="muted">of {formatCount(countries.total)}</span>} />
        <StatTile icon="coins" value={formatMicros(cost.micros, cost.currency, { precise: 2 })} label="Total cost" href="/admin/sms/analytics"
          delta={<DeltaChip value={delta(cost.micros, prevCost.micros)} inverse />} spark={daily.map((d) => Number(d.micros))} />
      </div>

      <div className="es-smsgrid">
        <Panel icon="globe" title="Country management" description="Enable or disable SMS for specific countries"
          action={<Link href="/admin/sms/countries" className="es-btn es-btn--ghost es-btn--sm">All countries <NavIcon name="arrow" size={16} /></Link>}>
          <CountryTable canEdit={canEdit} compact limit={6} />
        </Panel>

        <Panel icon="chat" title="SMS categories" description="Each switch is independent">
          <ul className="es-smscats">
            {categories.map((c) => (
              <li key={c.key} className="es-smscat">
                <div className="fx-row fx-row--between items-start">
                  <span className="es-smscat__icon" aria-hidden><NavIcon name={CATEGORY_ICON[c.key]} size={22} /></span>
                  <Toggle label={c.label} checked={c.enabled} disabled={!canEdit || busyKey === c.key} onChange={(on) => toggleCategory(c, on)} />
                </div>
                <p className="es-smscat__title">{c.label}</p>
                <p className="es-smscat__desc">{c.description}</p>
                <p className="es-smscat__tag">{c.trafficClass === 'marketing' ? 'Marketing · consent required' : 'Transactional'}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="es-smsgrid es-smsgrid--3">
        <Panel icon="chart" title="SMS analytics"
          action={<Link href="/admin/sms/analytics" className="es-btn es-btn--ghost es-btn--sm">View details <NavIcon name="arrow" size={16} /></Link>}>
          {bars.length ? <BarChart data={bars} format={formatCount} ariaLabel="Messages sent per day" />
            : <p className="py-10 text-center text-sm text-muted">No messages sent in this window yet.</p>}
        </Panel>

        <Panel icon="pulse" title="Recent activity"
          action={<Link href="/admin/audit" className="es-btn es-btn--ghost es-btn--sm">View all <NavIcon name="arrow" size={16} /></Link>}>
          {activity.length === 0 ? <p className="py-10 text-center text-sm text-muted">No SMS changes yet.</p> : (
            <ol className="es-smsfeed">
              {activity.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <span className="es-smsfeed__text">{describeActivity(a.action, a.payload)}</span>
                  <time className="es-smsfeed__time" dateTime={a.at}>{relativeTime(a.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Readiness r={readiness} countries={countries} />
      </div>
    </div>
  );
}
