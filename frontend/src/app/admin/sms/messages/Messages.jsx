'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../../components/ui/Filters';
import Field, { TextareaField, SelectField } from '../../../components/forms/Field';
import { Loading, ErrorNotice } from '../../../components/Feedback';
import { formatMicros, formatCount } from '../../../lib/smsFormat';
import { SmsPage, StatusPill } from '../smsUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The delivery log: every message, its attempts, its receipts.
 *
 * "Outcome unknown" is its own filter because it is the one state that needs a
 * person. The provider may or may not have the message; resending risks a
 * duplicate, not resending risks a missed text. The retry asks a super admin
 * to accept that risk in so many words.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const FILTERS = [
  { value: '', label: 'All' }, { value: 'delivered', label: 'Delivered' }, { value: 'sent', label: 'Sent' },
  { value: 'queued', label: 'Queued' }, { value: 'failed', label: 'Failed' }, { value: 'blocked', label: 'Held back' },
  { value: 'unknown', label: 'Unknown' },
];

function Detail({ id, canSuper, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: m, error, loading } = useApi(`/admin/sms/messages/${id}`);
  if (error) return <ErrorNotice error={error} />;
  if (loading || !m) return <Loading variant="list" rows={2} label="Loading message" />;

  async function retry() {
    const unknown = m.status === 'unknown';
    const ok = await confirm({
      title: unknown ? 'This message may already have arrived.' : 'Retry this message?',
      body: unknown
        ? <p>The provider call did not finish cleanly and no receipt has come back. Retrying can text this person twice.</p>
        : <p>It is queued again and goes through the full checks.</p>,
      confirmLabel: unknown ? 'Retry, accepting a possible duplicate' : 'Retry', tone: unknown ? 'danger' : undefined,
    });
    if (!ok) return;
    try {
      await post(`/admin/sms/messages/${m.id}/retry`, unknown ? { acceptDuplicateRisk: true } : {}, { noRedirect: true });
      toast.success('Queued again.');
      onChanged();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function cancel() {
    try {
      await post(`/admin/sms/messages/${m.id}/cancel`, {}, { noRedirect: true });
      toast.success('Cancelled.');
      onChanged();
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  return (
    <div className="fx-stack fx-stack--sm">
      <div className="es-smsphone">{m.body}</div>
      <dl className="es-smsdl">
        <dt>To</dt><dd>{m.to} · {m.country}</dd>
        <dt>From</dt><dd>{m.senderValue || '—'} {m.providerId && <span className="capitalize">via {m.providerId}</span>}</dd>
        <dt>Provider ID</dt><dd>{m.providerMessageId || '—'}</dd>
        <dt>Segments</dt><dd>{m.segments} · {m.encoding}</dd>
        <dt>Cost</dt><dd>{m.costMicros != null ? formatMicros(m.costMicros, m.currency) : m.estCostMicros != null ? `${formatMicros(m.estCostMicros, m.currency)} (estimate)` : '—'}</dd>
        {m.blockReasonLabel && <><dt>Held back</dt><dd>{m.blockReasonLabel}</dd></>}
        {m.lastError && <><dt>Last note</dt><dd>{m.lastErrorCode ? `${m.lastErrorCode}: ` : ''}{m.lastError}</dd></>}
      </dl>
      {m.attempts.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink">Attempts</p>
          <ol className="es-smsmeta" style={{ flexDirection: 'column' }}>
            {m.attempts.map((a) => (
              <li key={a.attemptNo}>#{a.attemptNo} {a.providerId} · {a.outcome}{a.errorCode ? ` · ${a.errorCode}` : ''}{a.errorMessage ? ` · ${a.errorMessage}` : ''} · {new Date(a.startedAt).toLocaleString()}</li>
            ))}
          </ol>
        </div>
      )}
      {m.receipts.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink">Receipts</p>
          <ol className="es-smsmeta" style={{ flexDirection: 'column' }}>
            {m.receipts.map((r, i) => <li key={i}>{r.statusRaw}{r.errorCode ? ` · ${r.errorCode}` : ''} · {new Date(r.at).toLocaleString()}</li>)}
          </ol>
        </div>
      )}
      <div className="fx-row gap-2">
        {canSuper && ['failed', 'unknown', 'blocked'].includes(m.status) && <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={retry}>Retry</button>}
        {m.status === 'queued' && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={cancel}>Cancel</button>}
      </div>
    </div>
  );
}

function TestSend({ onSent }) {
  const toast = useToast();
  const [f, setF] = useState({ to: '', body: 'Eventsli: test message.', category: 'participant' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/admin/sms/test', f, { noRedirect: true });
      toast.success(`Queued to ${r.country}, ${r.segments} segment${r.segments === 1 ? '' : 's'}. It goes through every check a real message does.`);
      onSent();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm">
      <div className="es-smsform">
        <Field label="To" value={f.to} onChange={set('to')} required placeholder="+1 416 555 0199" />
        <SelectField label="Category" value={f.category} onChange={set('category')}
          options={[['participant', 'Participant SMS'], ['event_notification', 'Event notification']]} />
        <div className="es-smsform__wide"><TextareaField label="Message" rows={2} value={f.body} onChange={set('body')} required /></div>
      </div>
      <div><button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Send test</button></div>
    </form>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const search = useSearchParams();
  const campaignId = search?.get('campaignId') || '';
  const [status, setStatus] = useState('');
  const [phone, setPhone] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [showTest, setShowTest] = useState(false);
  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (status) params.set('status', status);
  if (phone) params.set('phone', phone);
  if (campaignId) params.set('campaignId', campaignId);
  const { data, error, loading, reload } = useApi(`/admin/sms/messages?${params}`, { raw: true });
  const rows = data?.data || [];

  return (
    <SmsPage icon="list" title="Delivery log" lede={campaignId ? 'Messages from one campaign.' : 'Every message, with its attempts and delivery receipts. Numbers are masked in the list.'}
      actions={<button type="button" className="es-btn es-btn--secondary" onClick={() => setShowTest((s) => !s)}>{showTest ? 'Close' : 'Send a test'}</button>}>
      {showTest && <Panel icon="send" title="Send a test message"><TestSend onSent={() => { setShowTest(false); reload(); }} /></Panel>}
      <div className="fx-row fx-row--between items-end gap-3">
        <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={FILTERS} />
        <div className="es-smsfilter"><SearchBox label="Find a number" placeholder="Full number, e.g. +14165550199" value={phone} onSearch={(v) => { setPhone(v); setPage(1); }} /></div>
      </div>
      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={6} label="Loading messages" /> : (
        <Panel>
          {rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">No messages.</p> : (
            <ul className="fx-stack fx-stack--sm">
              {rows.map((m) => (
                <li key={m.id} className="border-b border-(--es-border) pb-3 last:border-0">
                  <button type="button" className="fx-row fx-row--between w-full items-center gap-3 text-left" aria-expanded={open === m.id}
                    onClick={() => setOpen(open === m.id ? null : m.id)}>
                    <span className="fx-min0">
                      <span className="block font-medium text-ink">{m.to} <span className="text-sm text-muted">· {m.country || '—'} · {m.category.replace('_', ' ')}{m.purpose ? ` · ${m.purpose.replace(/_/g, ' ')}` : ''}</span></span>
                      <span className="block text-xs text-subtle">{new Date(m.createdAt).toLocaleString()}{m.providerId ? ` · ${m.providerId}` : ''}{m.blockReasonLabel ? ` · ${m.blockReasonLabel}` : ''}</span>
                    </span>
                    <StatusPill status={m.status} />
                  </button>
                  {open === m.id && <div className="mt-3"><Detail id={m.id} canSuper={Boolean(user?.isSuperAdmin)} onChanged={reload} /></div>}
                </li>
              ))}
            </ul>
          )}
          {data?.pagination && (
            <div className="fx-row fx-row--between mt-4 items-center">
              <p className="text-sm text-muted">{formatCount(data.pagination.total)} messages</p>
              <Pagination pagination={data.pagination} onPage={setPage} />
            </div>
          )}
        </Panel>
      )}
    </SmsPage>
  );
}
