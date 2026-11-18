'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useCategories } from '../../hooks/useCategories';
import { get, post, patch, del } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox } from '../../components/ui/Filters';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import TemplateCard from '../../components/templates/TemplateCard';
import TemplatePreview from '../../components/templates/TemplatePreview';
import TemplateDialog from '../../components/templates/TemplateDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Event templates, from the console (owner, 2026-11-19): "templates of Eventsli
 * shared with all organizers with complete control from the super admin".
 *
 *   Eventsli templates   made from any event; a draft until published; hidden
 *                        takes one away without deleting it; featured ones
 *                        lead the list, then the order number
 *   Organizers'          every organizer's own library, to look at, copy into
 *                        Eventsli's (as a draft) or remove
 *
 * Every admin can look; changes are a super admin's, enforced by the API
 * (routes/admin/templateRoutes.js) as well as by hiding the buttons here.
 * `?from=<eventId>` opens "New template" on that event.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS = { draft: ['Draft', 'neutral'], published: ['Published', 'success'], hidden: ['Hidden', 'warning'] };

export default function AdminTemplates() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const confirm = useConfirm();
  const toast = useToast();
  const [scope, setScope] = useState('platform');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi(`/admin/templates?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [creating, setCreating] = useState(params.get('from') ? { eventId: params.get('from') } : null);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);

  const list = data?.templates || [];

  async function run(fn, done) {
    try {
      await fn();
      if (done) toast.success(done);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  const setStatus = (t, status) => run(() => patch(`/admin/templates/${t.id}`, { status }, { noRedirect: true }),
    status === 'published' ? 'Published to every organizer.' : status === 'hidden' ? 'Hidden from organizers.' : 'Moved back to drafts.');

  async function remove(t) {
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      body: <p>{t.scope === 'platform' ? 'Organizers stop seeing it. Copies they made and events already created stay as they are.' : `It leaves ${t.organizerName || 'the organizer'}’s library.`}</p>,
      confirmLabel: 'Delete template',
      tone: 'danger',
    });
    if (ok) run(() => del(`/admin/templates/${t.id}`, { noRedirect: true }), 'Template deleted.');
  }

  async function openPreview(t) {
    setPreview({ template: t, full: null });
    try {
      setPreview({ template: t, full: await get(`/admin/templates/${t.id}`, { cache: 'no-store', noRedirect: true }) });
    } catch (err) {
      setPreview(null);
      toast.error(messageFor(err));
    }
  }

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Storefront"
        title="Event templates"
        lede="Ready-made templates every organizer can start events from — ticket types, add-ons and seating map included — and a look at the templates organizers keep for themselves."
        actions={canEdit && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setCreating({ eventId: '' })}>New template from an event</button>
        )}
      />
      {!canEdit && <p className="es-notice es-notice--info" role="status">You can look at templates. Changing them is for super admins.</p>}
      {data && data.enabled === false && (
        <p className="es-notice es-notice--warning" role="status">Templates need migration 20261129090000 on this database.</p>
      )}

      <div className="fx-row flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Which templates" value={scope} onChange={setScope}
          options={[{ value: 'platform', label: 'Eventsli templates' }, { value: 'organizer', label: 'Organizers’ templates' }]}
        />
        <SearchBox label="Search templates" value={q} onSearch={setQ} placeholder="Search by name" />
      </div>

      {error && !data ? <ErrorNotice error={error} onRetry={reload} />
        : loading && !data ? <Loading variant="list" rows={3} label="Loading templates" />
          : list.length === 0 ? (
            <Empty
              icon="copy"
              title={scope === 'platform' ? 'No Eventsli templates yet' : 'No organizer templates'}
              hint={scope === 'platform' ? 'Make one from any event: its ticket types, add-ons and seating map become a template every organizer can use once you publish it.' : 'Templates organizers save for themselves appear here.'}
            />
          ) : (
            <div className="es-tplgrid">
              {list.map((t) => {
                const [label, tone] = STATUS[t.status] || STATUS.draft;
                return (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onOpen={() => openPreview(t)}
                    badges={[
                      ...(t.scope === 'platform' ? [{ label, tone }] : [{ label: t.organizerName || 'Organizer' }]),
                      ...(t.featured ? [{ label: 'Featured', tone: 'highlight' }] : []),
                    ]}
                  >
                    <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => openPreview(t)}>Preview</button>
                    {canEdit && t.scope === 'platform' && (
                      <>
                        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setEditing(t)}>Edit</button>
                        {t.status !== 'published'
                          ? <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => setStatus(t, 'published')}>Publish</button>
                          : <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setStatus(t, 'hidden')}>Hide</button>}
                        {t.sourceEventId && (
                          <button type="button" className="es-btn es-btn--ghost es-btn--sm" title="Take a fresh copy of the event it was made from"
                            onClick={() => run(() => post(`/admin/templates/${t.id}/refresh`, {}, { noRedirect: true }), 'Updated from its event.')}>Refresh</button>
                        )}
                      </>
                    )}
                    {canEdit && t.scope === 'organizer' && (
                      <button type="button" className="es-btn es-btn--secondary es-btn--sm"
                        onClick={() => run(() => post(`/admin/templates/${t.id}/promote`, {}, { noRedirect: true }), 'Copied into Eventsli templates as a draft.')}>
                        Make Eventsli template
                      </button>
                    )}
                    {canEdit && <button type="button" className="es-btn es-btn--ghost es-btn--sm" data-tone="danger" onClick={() => remove(t)}>Delete</button>}
                  </TemplateCard>
                );
              })}
            </div>
          )}

      {creating && (
        <CreateDialog
          initialEventId={creating.eventId}
          onClose={() => { setCreating(null); if (params.get('from')) router.replace('/admin/templates'); }}
          onCreated={(t) => { setCreating(null); setScope('platform'); reload(); setEditing(t); router.replace('/admin/templates'); }}
        />
      )}
      {editing && <EditDialog template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {preview && (
        <TemplateDialog id="admin-tpl-preview" title={preview.template.name} onClose={() => setPreview(null)} wide>
          {preview.full ? <TemplatePreview template={preview.full} /> : <Loading variant="card" />}
          {preview.template.sourceEventId && (
            <Link href={`/admin/events/${preview.template.sourceEventId}`} className="text-sm text-accent">Open the event it was made from</Link>
          )}
        </TemplateDialog>
      )}
    </div>
  );
}

/** A new Eventsli template from any event, found by name. */
function CreateDialog({ initialEventId, onClose, onCreated }) {
  const [search, setSearch] = useState('');
  const [eventId, setEventId] = useState(initialEventId || '');
  const { data } = useApi(!initialEventId && search.trim().length >= 2 ? `/admin/events?limit=8&q=${encodeURIComponent(search.trim())}` : null, { raw: true });
  const results = data?.data || [];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await post('/admin/templates', {
        eventId, ...(name.trim() ? { name: name.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}),
      }, { noRedirect: true });
      onCreated(t);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="admin-tpl-new" title="New Eventsli template" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        {!initialEventId && (
          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="tpl-search" className="text-sm text-ink">Event to copy</label>
            <input id="tpl-search" className="es-input" value={search} placeholder="Search events by title" onChange={(e) => { setSearch(e.target.value); setEventId(''); }} />
            {results.length > 0 && (
              <ul className="es-tplpick" aria-label="Matching events">
                {results.map((ev) => (
                  <li key={ev.id}>
                    <button type="button" className="es-tplpick__item" aria-pressed={eventId === ev.id} onClick={() => setEventId(ev.id)}>
                      <b className="fx-truncate">{ev.title}</b>
                      <small>{[ev.organizer?.name, ev.city, ev.status].filter(Boolean).join(' · ')}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-new-name" className="text-sm text-ink">Template name</label>
          <input id="tpl-new-name" className="es-input" maxLength={80} value={name} placeholder="Wedding — 20 round tables" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="tpl-new-desc" className="text-sm text-ink">Description</label>
          <textarea id="tpl-new-desc" className="es-input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="text-xs text-subtle">It starts as a draft only admins see. Publish it when it is ready for organizers.</p>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || !eventId}>{busy ? 'Creating…' : 'Create draft'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}

/** Everything an Eventsli template carries besides its contents. */
function EditDialog({ template, onClose, onSaved }) {
  const { list: categories } = useCategories();
  const [form, setForm] = useState({
    name: template.name, description: template.description || '', category: template.category || '',
    status: template.status, featured: Boolean(template.featured), sortOrder: template.sortOrder || 0, coverUrl: template.coverUrl || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch(`/admin/templates/${template.id}`, {
        name: form.name.trim(), description: form.description.trim() || null, category: form.category || null,
        status: form.status, featured: form.featured, sortOrder: Number(form.sortOrder) || 0, coverUrl: form.coverUrl.trim() || null,
      }, { noRedirect: true });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="admin-tpl-edit" title="Edit Eventsli template" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="ate-name" className="text-sm text-ink">Name</label>
          <input id="ate-name" className="es-input" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="ate-desc" className="text-sm text-ink">Description</label>
          <textarea id="ate-desc" className="es-input" rows={3} maxLength={500} value={form.description} onChange={set('description')} />
        </div>
        <div className="es-tplform-grid">
          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="ate-cat" className="text-sm text-ink">Category</label>
            <select id="ate-cat" className="es-input" value={form.category} onChange={set('category')}>
              <option value="">None</option>
              {(categories || []).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </div>
          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="ate-status" className="text-sm text-ink">Who sees it</label>
            <select id="ate-status" className="es-input" value={form.status} onChange={set('status')}>
              <option value="draft">Draft — admins only</option>
              <option value="published">Published — every organizer</option>
              <option value="hidden">Hidden — kept, not offered</option>
            </select>
          </div>
          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="ate-order" className="text-sm text-ink">Order</label>
            <input id="ate-order" type="number" min={0} max={9999} className="es-input" value={form.sortOrder} onChange={set('sortOrder')} />
          </div>
        </div>
        <label className="fx-row items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.featured} onChange={set('featured')} /> Featured — shown first, with a badge
        </label>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="ate-cover" className="text-sm text-ink">Cover picture address</label>
          <input id="ate-cover" type="url" className="es-input" maxLength={1000} placeholder="https://…" value={form.coverUrl} onChange={set('coverUrl')} />
          <p className="text-xs text-subtle">Starts as the event&apos;s own cover. Leave empty for a plain card.</p>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || form.name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}
