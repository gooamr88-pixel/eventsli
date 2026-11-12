'use client';

import { useState } from 'react';
import { post, del } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useToast } from '../../../components/ui/Toast';
import { Pagination } from '../../../components/ui/Filters';
import Field, { SelectField } from '../../../components/forms/Field';
import { Loading, ErrorNotice } from '../../../components/Feedback';

/**
 * The suppression list. A number that opted out itself (STOP, the link, the
 * carrier) can only be released by that person replying START; the console
 * offers removal only for entries an admin added.
 */

const REASON = {
  stop_keyword: 'Replied STOP', opt_out_link: 'Unsubscribe link', carrier_opt_out: 'Opted out at the carrier',
  invalid_number: 'Invalid number', admin: 'Added by an admin', fraud: 'Fraud',
};
const SELF = new Set(['stop_keyword', 'opt_out_link', 'carrier_opt_out']);

export default function Suppressions({ canSuper }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ phone: '', scope: 'all', reason: 'admin', note: '' });
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi(`/admin/sms/suppressions?page=${page}&limit=10`, { raw: true });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/admin/sms/suppressions', { ...f, note: f.note || undefined }, { noRedirect: true });
      toast.success('Number suppressed.');
      setF({ phone: '', scope: 'all', reason: 'admin', note: '' });
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function remove(s) {
    try {
      await del(`/admin/sms/suppressions/${s.key}`, { noRedirect: true });
      toast.success('Removed from the list.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  const rows = data?.data || [];
  return (
    <div className="fx-stack">
      <form onSubmit={add} className="fx-stack fx-stack--sm">
        <fieldset disabled={busy} className="es-smsform">
          <Field label="Number" value={f.phone} onChange={set('phone')} required placeholder="+20 100 123 4567" />
          <SelectField label="Stop" value={f.scope} onChange={set('scope')} options={[['all', 'Everything'], ['marketing', 'Marketing only']]} />
          <SelectField label="Reason" value={f.reason} onChange={set('reason')} options={[['admin', 'Admin decision'], ['fraud', 'Fraud'], ['invalid_number', 'Invalid number']]} />
          <Field label="Note" value={f.note} onChange={set('note')} optional />
        </fieldset>
        <div><button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Suppress number</button></div>
      </form>
      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={3} label="Loading list" />
        : rows.length === 0 ? <p className="text-sm text-muted">The list is empty.</p> : (
          <ul className="fx-stack fx-stack--sm">
            {rows.map((s) => (
              <li key={s.key} className="fx-row fx-row--between items-center gap-2 border-b border-(--es-border) pb-2 last:border-0">
                <span className="fx-min0">
                  <span className="block font-medium text-ink">{s.phone}</span>
                  <span className="block text-xs text-subtle">{REASON[s.reason] || s.reason} · {s.scope === 'all' ? 'everything' : 'marketing only'} · {new Date(s.createdAt).toLocaleDateString()}</span>
                </span>
                {canSuper && !SELF.has(s.reason) && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => remove(s)}>Remove</button>}
                {SELF.has(s.reason) && <span className="text-xs text-subtle">Only START undoes this</span>}
              </li>
            ))}
          </ul>
        )}
      {data?.pagination && <Pagination pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
