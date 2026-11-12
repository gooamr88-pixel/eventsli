'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useApi } from '../../../hooks/useApi';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import { Segmented } from '../../../components/ui/Filters';
import NavIcon from '../../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { formatCount, EXCLUSION_LABEL } from '../../../lib/smsFormat';
import { SmsPage, StatusPill } from '../smsUi';
import CampaignForm from './CampaignForm';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Campaigns: draft → submit → a SECOND admin approves → sent in the background.
 *
 * The author never sees an Approve button on their own campaign. The server
 * and the database refuse it anyway; hiding it just saves the round trip.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const FILTERS = [
  { value: '', label: 'All' }, { value: 'pending_approval', label: 'To approve' }, { value: 'draft', label: 'Drafts' },
  { value: 'sending', label: 'Sending' }, { value: 'completed', label: 'Completed' },
];

function Delivery({ c }) {
  const d = c.delivery || {};
  const sent = (d.sent || 0) + (d.delivered || 0) + (d.undelivered || 0);
  const total = c.recipientsQueued || 0;
  return (
    <div className="fx-stack fx-stack--sm">
      <div className="es-smsbar" aria-hidden><span style={{ width: `${total ? Math.min(100, (sent / total) * 100) : 0}%` }} /></div>
      <p className="es-smsmeta">
        <span>{formatCount(total)} queued</span><span>{formatCount(sent)} sent</span><span>{formatCount(d.delivered || 0)} delivered</span>
        <span>{formatCount((d.failed || 0) + (d.undelivered || 0))} failed</span><span>{formatCount(d.blocked || 0)} held back at send time</span>
        <span>{formatCount(c.recipientsSkipped)} not eligible</span>
      </p>
      {c.recipientsSkipped > 0 && (
        <p className="es-smsmeta">
          {Object.entries(c.skippedReasons || {}).map(([k, v]) => <span key={k}>{EXCLUSION_LABEL[k] || k}: {formatCount(v)}</span>)}
        </p>
      )}
    </div>
  );
}

export default function Campaigns() {
  const toast = useToast();
  const confirm = useConfirm();
  const search = useSearchParams();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(search?.get('new') ? {} : null);
  const { data, error, loading, reload } = useApi(`/admin/sms/campaigns${filter ? `?status=${filter}` : ''}`);
  const { data: segments } = useApi('/admin/sms/segments');
  const { data: settings } = useApi('/admin/sms/settings');
  const { data: categories } = useApi('/admin/sms/categories');
  const [busy, setBusy] = useState(null);

  async function act(c, what, body = {}, done = 'Done.') {
    setBusy(c.id);
    try {
      await post(`/admin/sms/campaigns/${c.id}/${what}`, body, { noRedirect: true });
      toast.success(done);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  async function approve(c) {
    const answer = await confirm({
      title: `Approve “${c.name}”?`,
      body: <p>It goes to every eligible person in the segment{c.scheduledAt ? ` at ${new Date(c.scheduledAt).toLocaleString()}` : ' straight away'}. Consent, suppression and quiet hours are checked again for each message.</p>,
      reason: { label: 'Note (optional)', minLength: 0, maxLength: 1000 },
      confirmLabel: 'Approve and schedule',
    });
    if (answer) act(c, 'approve', answer.reason ? { note: answer.reason } : {}, 'Approved.');
  }

  async function reject(c) {
    const answer = await confirm({
      title: `Send “${c.name}” back?`, body: <p>The author sees your note and can edit and resubmit.</p>,
      reason: { label: 'What needs to change?', minLength: 5, maxLength: 1000 }, confirmLabel: 'Send back',
    });
    if (answer) act(c, 'reject', { note: answer.reason }, 'Sent back to the author.');
  }

  async function cancel(c) {
    const ok = await confirm({ title: `Cancel “${c.name}”?`, body: <p>Messages not yet sent are withdrawn. Messages already sent cannot be recalled.</p>, confirmLabel: 'Cancel campaign', tone: 'danger' });
    if (ok) act(c, 'cancel', {}, 'Campaign cancelled.');
  }

  const list = Array.isArray(data) ? data : [];
  const ready = segments && settings && categories;

  return (
    <SmsPage icon="send" title="Campaign management"
      lede="Promotions and targeted messages to people who said yes. Every campaign needs a second admin."
      actions={!editing && <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing({})}><NavIcon name="plus" size={18} />New campaign</button>}>
      {editing && (
        <Panel icon="pencil" title={editing.id ? `Edit “${editing.name}”` : 'New campaign'}>
          {!ready ? <Loading variant="list" rows={2} label="Loading" /> : segments.length === 0 ? (
            <Notice tone="info" title="Build an audience first." action={<Link href="/admin/sms/audiences" className="es-btn es-btn--secondary es-btn--sm">Audiences</Link>}>
              <p>A campaign goes to a saved segment.</p>
            </Notice>
          ) : (
            <CampaignForm campaign={editing.id ? editing : null} segments={segments} settings={settings} categories={categories}
              onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
          )}
        </Panel>
      )}

      <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS} />

      {error ? <ErrorNotice error={error} onRetry={reload} /> : loading && !data ? <Loading variant="list" rows={3} label="Loading campaigns" />
        : list.length === 0 ? <p className="py-10 text-center text-sm text-muted">No campaigns here.</p> : (
          <ul className="fx-stack fx-stack--sm">
            {list.map((c) => (
              <li key={c.id} className="es-card fx-stack fx-stack--sm p-5">
                <div className="fx-row fx-row--between items-start gap-3">
                  <div className="fx-min0">
                    <p className="fx-break text-lg font-medium text-ink">{c.name}</p>
                    <p className="text-sm text-muted">
                      {categories?.find((k) => k.key === c.category)?.label || c.category}
                      {' · '}{segments?.find((s) => s.id === c.segmentId)?.name || c.segmentName || 'No segment'}
                      {c.scheduledAt && ` · ${new Date(c.scheduledAt).toLocaleString()}`}
                      {c.mine && ' · yours'}
                      {c.organizerName && ` · by ${c.organizerName}`}
                    </p>
                  </div>
                  <StatusPill status={c.status} map="campaign" />
                </div>
                <div className="es-smsphone">{c.body}</div>
                {c.decisionNote && <p className="text-sm text-muted">Note: {c.decisionNote}</p>}
                {['sending', 'completed', 'cancelled'].includes(c.status) && <Delivery c={c} />}
                <div className="fx-row gap-2">
                  {!c.organizerId && ['draft', 'rejected'].includes(c.status) && (
                    <>
                      <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setEditing(c)}>Edit</button>
                      <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busy === c.id} onClick={() => act(c, 'submit', {}, 'Submitted for approval.')}>Submit</button>
                    </>
                  )}
                  {c.status === 'pending_approval' && !c.mine && (
                    <>
                      <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busy === c.id} onClick={() => approve(c)}>Approve</button>
                      <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy === c.id} onClick={() => reject(c)}>Send back</button>
                    </>
                  )}
                  {c.status === 'pending_approval' && c.mine && <span className="text-sm text-muted">Waiting for another admin to approve.</span>}
                  {['draft', 'pending_approval', 'approved', 'sending', 'rejected'].includes(c.status) && (
                    <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy === c.id} onClick={() => cancel(c)}>Cancel</button>
                  )}
                  {['sending', 'completed'].includes(c.status) && (
                    <Link href={`/admin/sms/messages?campaignId=${c.id}`} className="es-btn es-btn--ghost es-btn--sm">Messages</Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
    </SmsPage>
  );
}
