'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '../../hooks/useApi';
import { get, post, patch, del } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/Page';
import { Segmented } from '../../components/ui/Filters';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import TemplateCard from '../../components/templates/TemplateCard';
import TemplatePreview from '../../components/templates/TemplatePreview';
import TemplateDialog from '../../components/templates/TemplateDialog';
import { useOrganizerEvents } from '../nav/OrganizerEvents';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Templates (owner, 2026-11-19): the organizer's own library and Eventsli's
 * shared templates, to start new events from.
 *
 *   Use        the new-event form, pre-filled; once the event is created its
 *              ticket types, add-ons and seating map are copied in
 *   Preview    everything a template sets up, map included
 *   Copy       an Eventsli template into the library, to change and keep
 *   Save       any of their events as a template (also from the event's More)
 *
 * `?from=<eventId>` opens Save on that event; `?tab=eventsli` opens Eventsli's.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Templates() {
  const params = useSearchParams();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/organizer/templates');
  const [tab, setTab] = useState(params.get('tab') === 'eventsli' ? 'eventsli' : 'mine');
  const [saving, setSaving] = useState(params.get('from') ? { eventId: params.get('from') } : null);
  const [renaming, setRenaming] = useState(null);
  const [preview, setPreview] = useState(null);

  if (loading && !data) return <Loading variant="list" rows={3} label="Loading templates" />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;

  const mine = data?.mine || [];
  const eventsli = data?.eventsli || [];
  const list = tab === 'mine' ? mine : eventsli;
  const use = (t) => router.push(`/organizer/events/new?type=${t.listingType || 'ticketed'}&template=${t.id}`);

  async function openPreview(t) {
    setPreview({ template: t, full: null });
    try {
      const full = await get(`/organizer/templates/${t.id}`, { cache: 'no-store', noRedirect: true });
      setPreview({ template: t, full });
    } catch (err) {
      setPreview(null);
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function copy(t) {
    try {
      await post(`/organizer/templates/${t.id}/copy`, {}, { noRedirect: true });
      toast.success('It is in Your templates now, to change and keep.', { title: 'Template copied' });
      setTab('mine');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function remove(t) {
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      body: <p>Events already made from it are not affected.</p>,
      confirmLabel: 'Delete template',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await del(`/organizer/templates/${t.id}`, { noRedirect: true });
      toast.success('Template deleted.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Your account"
        title="Templates"
        lede="Start a new event from one you have run before, or from a ready-made Eventsli template — ticket types, add-ons and seating map included."
        actions={(
          <button type="button" className="es-btn es-btn--primary" onClick={() => setSaving({ eventId: '' })}>
            Save an event as a template
          </button>
        )}
      />

      {data && data.enabled === false && (
        <p className="es-notice es-notice--info" role="status">Templates are being switched on. Check back shortly.</p>
      )}

      <Segmented
        label="Which templates"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'mine', label: 'Your templates', count: mine.length },
          { value: 'eventsli', label: 'Eventsli templates', count: eventsli.length },
        ]}
      />

      {list.length === 0 ? (
        tab === 'mine' ? (
          <Empty
            icon="copy"
            title="Save your first template"
            hint="Pick an event you have set up — its ticket types, add-ons and seating map become a template you can start new events from. Or copy one of Eventsli's."
            action={<button type="button" className="es-btn es-btn--secondary" onClick={() => setTab('eventsli')}>Browse Eventsli templates</button>}
          />
        ) : <Empty icon="sparkle" title="No Eventsli templates yet" hint="Ready-made templates will appear here." />
      ) : (
        <div className="es-tplgrid">
          {list.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onOpen={() => openPreview(t)}
              badges={[
                ...(t.scope === 'platform' ? [{ label: 'Eventsli', tone: 'brand' }] : []),
                ...(t.featured ? [{ label: 'Featured', tone: 'highlight' }] : []),
                ...(t.copiedFromId && t.scope === 'organizer' ? [{ label: 'Copied' }] : []),
              ]}
            >
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => use(t)}>Use template</button>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => openPreview(t)}>Preview</button>
              {t.scope === 'platform' ? (
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => copy(t)}>Copy to mine</button>
              ) : (
                <>
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setRenaming(t)}>Rename</button>
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" data-tone="danger" onClick={() => remove(t)}>Delete</button>
                </>
              )}
            </TemplateCard>
          ))}
        </div>
      )}

      {saving && (
        <SaveDialog
          initialEventId={saving.eventId}
          onClose={() => { setSaving(null); if (params.get('from')) router.replace('/organizer/templates'); }}
          onSaved={() => { setSaving(null); setTab('mine'); reload(); router.replace('/organizer/templates'); }}
        />
      )}
      {renaming && (
        <RenameDialog template={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); reload(); }} />
      )}
      {preview && (
        <TemplateDialog id="tpl-preview" title={preview.template.name} onClose={() => setPreview(null)} wide>
          {preview.full ? <TemplatePreview template={preview.full} /> : <Loading variant="card" />}
          <div className="fx-row flex-wrap gap-2 border-t border-border-base pt-3">
            <button type="button" className="es-btn es-btn--primary" onClick={() => use(preview.template)}>Use template</button>
            {preview.template.scope === 'platform' && (
              <button type="button" className="es-btn es-btn--secondary" onClick={() => { setPreview(null); copy(preview.template); }}>Copy to mine</button>
            )}
          </div>
        </TemplateDialog>
      )}
    </div>
  );
}

/** Save one of the organizer's events as a template. */
function SaveDialog({ initialEventId, onClose, onSaved }) {
  const { events = [] } = useOrganizerEvents() || {};
  const toast = useToast();
  const [eventId, setEventId] = useState(initialEventId || '');
  const chosen = events.find((e) => e.id === eventId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      await post('/organizer/templates', {
        eventId,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }, { noRedirect: true });
      toast.success('Start new events from it any time.', { title: 'Template saved' });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="tpl-save" title="Save an event as a template" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-event" className="text-sm text-ink">Event</label>
          <select id="tpl-event" className="es-input" value={eventId} onChange={(e) => setEventId(e.target.value)} required>
            <option value="">Choose an event</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-name" className="text-sm text-ink">Template name</label>
          <input id="tpl-name" className="es-input" maxLength={80} value={name} placeholder={chosen?.title || 'Summer gala'} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-desc" className="text-sm text-ink">Description (optional)</label>
          <textarea id="tpl-desc" className="es-input" rows={3} maxLength={500} value={description} placeholder="Our 40-table ballroom with VIP and standard seats." onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="text-xs text-subtle">
          Saves its details, ticket types, add-ons and seating map. Sales, buyers, dates and pictures stay with the event.
        </p>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || !eventId}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}

function RenameDialog({ template, onClose, onSaved }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await patch(`/organizer/templates/${template.id}`, { name: name.trim(), description: description.trim() || null }, { noRedirect: true });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="tpl-rename" title="Rename template" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-rename-name" className="text-sm text-ink">Name</label>
          <input id="tpl-rename-name" className="es-input" minLength={2} maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-rename-desc" className="text-sm text-ink">Description</label>
          <textarea id="tpl-rename-desc" className="es-input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}
