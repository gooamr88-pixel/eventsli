'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { SearchBox, Pagination } from '../../components/ui/Filters';
import MoreActions, { MoreItem, MoreDivider } from '../../components/ui/MoreActions';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { formatMicros, formatCount, MISSING_LABEL } from '../../lib/smsFormat';
import { CountryBadge, StatusPill, Toggle } from './smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The country table — compact on the overview, full on the Countries page.
 *
 * The switch turns SMS on or off for a country. It cannot turn on a country
 * nobody has verified: the server refuses that (and so does the database),
 * and the switch says what is missing instead of pretending.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const STATUSES = [
  ['', 'All statuses'], ['enabled', 'Enabled'], ['unverified', 'Unverified'], ['disabled', 'Disabled'], ['blocked', 'Blocked'],
];

function requirementText(c) {
  if (c.senderIdSupport === 'unknown') return 'Not yet checked';
  const parts = [];
  if (c.senderIdSupport === 'registration_required' || c.requiresSenderRegistration) parts.push('Sender ID registration');
  if (c.senderIdSupport === 'not_supported') parts.push('Numbers only');
  if (c.doubleOptInRequired) parts.push('Double opt-in');
  if (c.restrictions) parts.push('Restrictions apply');
  return parts.length ? parts.join(' · ') : 'None';
}

export default function CountryTable({ canEdit, compact = false, limit = 25 }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const { data, error, loading, reload } = useApi(`/admin/sms/countries?${params}`, { raw: true });

  async function setCountry(country, next) {
    if (next === 'enabled' && !country.readyToEnable) {
      toast.error(country.missing.map((m) => MISSING_LABEL[m]).join('. ') + '.', { title: `${country.name} is not verified yet` });
      return;
    }
    if (next !== 'enabled') {
      const ok = await confirm({
        title: next === 'blocked' ? `Block SMS to ${country.name}?` : `Turn off SMS to ${country.name}?`,
        body: <p>Messages already queued for {country.name} will not be sent. You can turn it back on at any time.</p>,
        confirmLabel: next === 'blocked' ? 'Block country' : 'Turn off',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(country.iso2);
    try {
      await post(`/admin/sms/countries/${country.iso2}/status`, { status: next }, { noRedirect: true });
      toast.success(next === 'enabled' ? `SMS is on for ${country.name}.` : `SMS is ${next} for ${country.name}.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.data || [];
  const pagination = data?.pagination;
  const from = pagination ? (pagination.page - 1) * pagination.limit + 1 : 0;

  return (
    <div className="fx-stack fx-stack--sm">
      <div className="fx-row fx-row--between items-end gap-3">
        <div className="es-smsfilter">
          <SearchBox label="Search countries" placeholder="Search countries…" value={q} onSearch={(v) => { setQ(v); setPage(1); }} />
        </div>
        <label className="es-smsselect">
          <span className="sr-only">Status</span>
          <select className="es-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={compact ? 4 : 8} label="Loading countries" /> : (
        <div className="es-table-wrap">
          <table className="es-table es-table--stack es-smstable">
            <caption className="sr-only">SMS availability by country</caption>
            <thead>
              <tr>
                <th scope="col">Country</th>
                <th scope="col">SMS status</th>
                <th scope="col">Provider</th>
                <th scope="col" data-align="end">Est. cost</th>
                <th scope="col">Requirements</th>
                <th scope="col" data-align="end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const primary = c.routes.find((r) => r.verified && r.active) || null;
                return (
                  <tr key={c.iso2}>
                    <td data-label="Country" data-primary="">
                      <Link href={`/admin/sms/countries/${c.iso2}`} className="hover:text-accent">
                        <CountryBadge iso2={c.iso2} name={c.name} sub={compact ? null : `+${c.dialCode} · ${c.region}`} />
                      </Link>
                    </td>
                    <td data-label="SMS status">
                      <StatusPill status={c.status} map="country" />
                      {c.pausedUntil && <span className="es-smsnote">Paused</span>}
                    </td>
                    <td data-label="Provider">{primary ? <span className="capitalize">{primary.providerId}</span> : <span className="text-subtle">—</span>}</td>
                    <td data-label="Est. cost" data-align="end">
                      {c.estimatedCost ? formatMicros(c.estimatedCost.micros, c.estimatedCost.currency) : <span className="text-subtle">—</span>}
                    </td>
                    <td data-label="Requirements" className="text-sm text-muted">{requirementText(c)}</td>
                    <td data-label="Actions" data-align="end">
                      <span className="flex flex-nowrap items-center justify-end gap-1">
                        <Toggle
                          label={`SMS for ${c.name}`}
                          checked={c.status === 'enabled'}
                          disabled={!canEdit || busy === c.iso2 || c.status === 'blocked'}
                          onChange={(on) => setCountry(c, on ? 'enabled' : 'disabled')}
                        />
                        {!compact && (
                        <MoreActions compact align="end" srLabel={`More for ${c.name}`}>
                          <MoreItem href={`/admin/sms/countries/${c.iso2}`} icon="eye">Rules and routes</MoreItem>
                          {canEdit && c.status !== 'blocked' && <MoreDivider />}
                          {canEdit && c.status !== 'blocked' && (
                            <MoreItem icon="ban" tone="danger" onClick={() => setCountry(c, 'blocked')}>Block country</MoreItem>
                          )}
                          {canEdit && c.status === 'blocked' && (
                            <MoreItem icon="undo" onClick={() => setCountry(c, 'disabled')}>Unblock</MoreItem>
                          )}
                        </MoreActions>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted">No country matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pagination && (
        <div className="fx-row fx-row--between items-center gap-3">
          <p className="text-sm text-muted">
            {pagination.total === 0 ? 'No countries' : `Showing ${from}–${Math.min(from + rows.length - 1, pagination.total)} of ${formatCount(pagination.total)} countries`}
          </p>
          <Pagination pagination={pagination} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
