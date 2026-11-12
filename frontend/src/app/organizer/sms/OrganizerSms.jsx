'use client';

import { useState } from 'react';
import { post } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { PageHeader, Panel } from '../../components/ui/Page';
import { KpiRow, Kpi } from '../../components/ui/Kpi';
import NavIcon from '../../components/shell/NavIcon';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import { formatCount } from '../../lib/smsFormat';
import { StatusPill } from '../../admin/sms/smsUi';
import CampaignForm from '../../admin/sms/campaigns/CampaignForm';
import OrgAudiences from './OrgAudiences';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * An organizer's text message campaigns.
 *
 * Who can be reached: buyers who ticked "send me news and offers from <you>"
 * at checkout — nobody else, and the counts say how many. What happens: the
 * organizer drafts and submits, Eventsli reviews, the texts go out under the
 * organizer's name with an opt-out line, within a monthly allowance.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function Campaigns({ list, segments, settings, categories, canEdit, reload }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);

  async function act(c, what, done) {
    try {
      await post(`/organizer/sms/campaigns/${c.id}/${what}`, {}, { noRedirect: true });
      toast.success(done);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      {editing ? (
        segments.length === 0 ? <Notice tone="info" title="Build an audience first."><p>A campaign goes to one of your audiences.</p></Notice> : (
          <CampaignForm campaign={editing.id ? editing : null} segments={segments} settings={settings} categories={categories}
            endpoint="/organizer/sms/campaigns" submitNote="Submit it for Eventsli to review."
            onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
        )
      ) : canEdit && (
        <div><button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => setEditing({})}><NavIcon name="plus" size={16} />New campaign</button></div>
      )}
      {list.length === 0 ? <p className="text-sm text-muted">No campaigns yet.</p> : (
        <ul className="fx-stack fx-stack--sm">
          {list.map((c) => {
            const d = c.delivery || {};
            return (
              <li key={c.id} className="es-card fx-stack fx-stack--sm p-4">
                <div className="fx-row fx-row--between items-start gap-2">
                  <div className="fx-min0">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="text-sm text-muted">{segments.find((s) => s.id === c.segmentId)?.name || 'No audience'}{c.scheduledAt && ` · ${new Date(c.scheduledAt).toLocaleString()}`}</p>
                  </div>
                  <StatusPill status={c.status} map="campaign" />
                </div>
                <div className="es-smsphone">{c.body}</div>
                {c.decisionNote && <p className="text-sm text-muted">Eventsli: {c.decisionNote}</p>}
                {['sending', 'completed'].includes(c.status) && (
                  <p className="es-smsmeta">
                    <span>{formatCount(c.recipientsQueued)} queued</span>
                    <span>{formatCount((d.sent || 0) + (d.delivered || 0))} sent</span>
                    <span>{formatCount(d.delivered || 0)} delivered</span>
                    <span>{formatCount(c.recipientsSkipped)} not reachable</span>
                  </p>
                )}
                <div className="fx-row gap-2">
                  {canEdit && ['draft', 'rejected'].includes(c.status) && (
                    <>
                      <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setEditing(c)}>Edit</button>
                      <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => act(c, 'submit', 'Sent to Eventsli for review.')}>Submit for review</button>
                    </>
                  )}
                  {c.status === 'pending_approval' && <span className="text-sm text-muted">Eventsli is reviewing it.</span>}
                  {['draft', 'pending_approval', 'approved', 'sending', 'rejected'].includes(c.status) && (
                    <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={async () => {
                      if (await confirm({ title: `Cancel “${c.name}”?`, body: <p>Texts not yet sent are withdrawn.</p>, confirmLabel: 'Cancel campaign', tone: 'danger' })) act(c, 'cancel', 'Campaign cancelled.');
                    }}>Cancel</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function OrganizerSms() {
  const { data, error, loading, reload } = useApi('/organizer/sms');
  const segments = useApi('/organizer/sms/segments');
  const campaigns = useApi('/organizer/sms/campaigns');
  const reloadAll = () => { reload(); segments.reload(); campaigns.reload(); };

  if (error) return <div className="fx-stack"><PageHeader title="Text messages" /><ErrorNotice error={error} onRetry={reload} /></div>;
  if (loading || !data) return <div className="fx-stack"><PageHeader title="Text messages" /><Loading variant="stats" rows={3} label="Loading" /></div>;

  const { access, consent } = data;
  const settings = { brandName: data.brandName, optOutText: data.optOutText };
  const categories = data.categories.map((c) => ({ ...c, trafficClass: 'marketing' }));

  return (
    <div className="fx-stack">
      <PageHeader eyebrow="Marketing" title="Text messages"
        lede="Send news and offers by text to buyers who agreed to hear from you. Eventsli reviews each campaign before it goes out." />

      {!access.enabled && (
        <Notice tone="info" title="Text campaigns are not enabled for your organization yet.">
          <p>Contact Eventsli to request access. Meanwhile, buyers can already opt in to your texts at checkout, and the count below grows.</p>
        </Notice>
      )}

      <KpiRow label="Your text audience">
        <Kpi icon="users" label="Opted in to your texts" value={formatCount(consent.optedIn)} note={consent.pending ? `${formatCount(consent.pending)} awaiting their YES` : null} />
        <Kpi icon="send" label="Sent this month" value={formatCount(access.usedThisMonth)} note={access.enabled ? `of ${formatCount(access.monthlyCap)} allowed` : 'Not enabled'} />
        <Kpi icon="ban" label="Opted out" value={formatCount(consent.optedOut)} />
      </KpiRow>

      <div className="es-smsgrid">
        <Panel icon="send" title="Campaigns">
          {campaigns.error ? <ErrorNotice error={campaigns.error} onRetry={campaigns.reload} /> : !campaigns.data || !segments.data ? <Loading variant="list" rows={2} label="Loading campaigns" />
            : <Campaigns list={campaigns.data} segments={segments.data} settings={settings} categories={categories} canEdit={access.enabled} reload={reloadAll} />}
        </Panel>
        <Panel icon="target" title="Audiences" description="Groups of your own buyers.">
          {segments.error ? <ErrorNotice error={segments.error} onRetry={segments.reload} /> : !segments.data ? <Loading variant="list" rows={2} label="Loading audiences" />
            : <OrgAudiences segments={segments.data} events={data.events} canEdit={access.enabled} reload={reloadAll} />}
        </Panel>
      </div>

      <p className="text-xs text-subtle">
        Every text starts with “{data.brandName}:” and ends with “{data.optOutText}”. People who reply STOP, or untick you in their account, are never texted again.
      </p>
    </div>
  );
}
