'use client';

import { useState } from 'react';
import { post, patch, del } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { Panel } from '../../components/ui/Page';
import FormError from '../../components/forms/FormError';
import { Loading, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import ImageField from './ImageField';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One editor for sponsors, testimonials and categories.
 *
 * All three are the same object from the console's point of view: an ordered
 * list of rows, each with a picture, a visibility switch and a delete. The
 * differences — which fields, what the switch is called, what an id looks like
 * — are data, in `KINDS` at the bottom of this file. Three near-identical
 * screens would be three places to fix the next reorder bug.
 *
 * ── Reordering is up/down buttons, not drag and drop ────────────────────────
 * Deliberate. Drag and drop needs a keyboard equivalent to be usable at all
 * (WCAG 2.1.1), and the keyboard equivalent IS a pair of buttons — so a
 * dragging implementation is the button implementation plus several hundred
 * lines of pointer handling, on a list of eight rows that is reordered twice a
 * year. The buttons work with a mouse, a keyboard and a screen reader on the
 * first try.
 *
 * The whole order is sent on every move, as ids in their new sequence. The API
 * writes positions 10, 20, 30… so a later single nudge has somewhere to land.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ListEditor({ kind }) {
  const spec = KINDS[kind];
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(`/admin/storefront/${kind}`);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);

  const rows = data?.[kind] || [];

  /** Every mutation funnels through here so the error handling, the reload and
   *  the busy flag exist once. */
  async function run(work, successMessage) {
    setBusy(true);
    setFormError(null);
    try {
      await work();
      reload();
      if (successMessage) toast.show(successMessage);
      return true;
    } catch (err) {
      // `meta.errors` first (every complaint at once), then `messageFor` —
      // which keeps the server's sentence but answers a dropped connection
      // with its recovery line rather than "Failed to fetch".
      setFormError(err?.meta?.errors?.join(' ') || messageFor(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function move(index, delta) {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await run(
      () => post(`/admin/storefront/${kind}/order`, { ids: next.map((r) => r[spec.idKey]) }),
      'Order saved.',
    );
  }

  async function remove(row) {
    const ok = await confirm({
      title: `Delete ${spec.describe(row)}?`,
      body: spec.deleteWarning,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await run(
      () => del(`/admin/storefront/${kind}/${row[spec.idKey]}`),
      `${spec.singular} deleted.`,
    );
  }

  if (loading) return <Loading label={`Loading ${kind}…`} />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;

  return (
    <div className="fx-stack">
      <Panel
        title={spec.title}
        description={spec.description}
        action={(
          <button
            type="button"
            className="es-btn es-btn--primary es-btn--sm"
            onClick={() => setCreating((c) => !c)}
          >
            {creating ? 'Cancel' : `Add ${spec.singular.toLowerCase()}`}
          </button>
        )}
      >
        {formError && <FormError message={formError} />}

        {creating && (
          <RowForm
            spec={spec}
            row={null}
            busy={busy}
            onCancel={() => setCreating(false)}
            onSubmit={async (values) => {
              const ok = await run(
                () => post(`/admin/storefront/${kind}`, values),
                `${spec.singular} added.`,
              );
              if (ok) setCreating(false);
            }}
          />
        )}

        {rows.length === 0 ? (
          <div className="es-empty">
            <p className="text-muted">{spec.empty}</p>
            <p className="mt-1 text-sm text-subtle">{spec.emptyHint}</p>
          </div>
        ) : (
          <ul className="fx-stack">
            {rows.map((row, index) => (
              <li key={row[spec.idKey]}>
                <Row
                  spec={spec}
                  row={row}
                  index={index}
                  total={rows.length}
                  busy={busy}
                  onMove={move}
                  onDelete={() => remove(row)}
                  onSave={(values) => run(
                    () => patch(`/admin/storefront/${kind}/${row[spec.idKey]}`, values),
                    `${spec.singular} saved.`,
                  )}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** One row: a summary line, the controls, and an expandable edit form. */
function Row({ spec, row, index, total, busy, onMove, onDelete, onSave }) {
  const [open, setOpen] = useState(false);
  const visible = row[spec.visibleKey];

  return (
    <div className="es-card p-4">
      <div className="fx-row fx-row--between items-center gap-3">
        <div className="fx-row items-center gap-3 fx-min0">
          {spec.imageKey && row[spec.imageKey] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row[spec.imageKey]}
              alt=""
              className="h-10 w-16 rounded-(--es-radius-sm) border border-border-base object-contain"
            />
          ) : null}
          <div className="fx-min0">
            <p className="fx-truncate font-medium text-ink">{spec.describe(row)}</p>
            <p className="fx-truncate text-sm text-muted">{spec.subtitle(row)}</p>
          </div>
        </div>

        <div className="fx-row items-center gap-1">
          <span className={`es-pill ${visible ? 'es-pill--accent' : ''}`}>
            {visible ? spec.visibleLabel : spec.hiddenLabel}
          </span>

          <button
            type="button"
            className="es-btn es-btn--ghost fx-touch--icon"
            disabled={busy || index === 0}
            onClick={() => onMove(index, -1)}
            aria-label={`Move ${spec.describe(row)} up`}
          >
            <span aria-hidden>↑</span>
          </button>
          <button
            type="button"
            className="es-btn es-btn--ghost fx-touch--icon"
            disabled={busy || index === total - 1}
            onClick={() => onMove(index, 1)}
            aria-label={`Move ${spec.describe(row)} down`}
          >
            <span aria-hidden>↓</span>
          </button>

          <button
            type="button"
            className="es-btn es-btn--ghost es-btn--sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            className="es-btn es-btn--ghost fx-touch--icon"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${spec.describe(row)}`}
          >
            <span aria-hidden><NavIcon name="trash" size={16} /></span>
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-border-base pt-4">
          <RowForm
            spec={spec}
            row={row}
            busy={busy}
            onCancel={() => setOpen(false)}
            onSubmit={async (values) => { await onSave(values); setOpen(false); }}
          />
        </div>
      )}
    </div>
  );
}

function RowForm({ spec, row, busy, onCancel, onSubmit }) {
  const creating = !row;
  const [draft, setDraft] = useState(() => {
    const base = {};
    for (const field of spec.fields) {
      if (creating && field.createOnly === false) continue;
      base[field.name] = row?.[field.name] ?? field.initial ?? '';
    }
    base[spec.visibleKey] = row ? row[spec.visibleKey] : spec.visibleDefault;
    if (spec.imageKey) {
      base[spec.imageKey] = row?.[spec.imageKey] || '';
      base[spec.imagePathKey] = row?.[spec.imagePathKey] || '';
    }
    return base;
  });

  const set = (name, value) => setDraft((d) => ({ ...d, [name]: value }));

  return (
    <form
      className="fx-stack"
      onSubmit={(e) => {
        e.preventDefault();
        // Fields the row cannot change after creation (a category's slug) are
        // dropped rather than sent — the API refuses them, and an error about a
        // field the operator never touched is a confusing way to learn that.
        const payload = { ...draft };
        if (!creating) for (const f of spec.fields) if (f.createOnly) delete payload[f.name];
        onSubmit(payload);
      }}
    >
      <div className="fx-grid fx-grid--2">
        {spec.fields
          .filter((f) => creating || !f.createOnly)
          .map((field) => (
            <div key={field.name} className="fx-stack fx-stack--sm">
              <label htmlFor={`f-${field.name}`} className="text-sm font-medium text-ink">
                {field.label}
                {field.optional && <span className="ms-1 text-subtle">(optional)</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  id={`f-${field.name}`}
                  rows={3}
                  maxLength={field.max}
                  value={draft[field.name] ?? ''}
                  onChange={(e) => set(field.name, e.target.value)}
                  className="es-input"
                />
              ) : (
                <input
                  id={`f-${field.name}`}
                  type={field.type || 'text'}
                  min={field.min}
                  max={field.max}
                  maxLength={field.type === 'number' ? undefined : field.max}
                  placeholder={field.placeholder}
                  value={draft[field.name] ?? ''}
                  onChange={(e) => set(
                    field.name,
                    // An empty number field means "no rating", which is a null
                    // the API understands — `Number('')` is 0, which it refuses.
                    field.type === 'number' && e.target.value === ''
                      ? null
                      : (field.type === 'number' ? Number(e.target.value) : e.target.value),
                  )}
                  className="es-input"
                />
              )}
              {field.hint && <p className="text-xs text-subtle">{field.hint}</p>}
            </div>
          ))}

        {spec.imageKey && (
          <div className="fx-stack fx-stack--sm">
            <span className="text-sm font-medium text-ink">{spec.imageLabel}</span>
            <ImageField
              url={draft[spec.imageKey]}
              path={draft[spec.imagePathKey]}
              scope={spec.scope}
              onChange={(result) => setDraft((d) => ({
                ...d,
                [spec.imageKey]: result?.url || '',
                [spec.imagePathKey]: result?.path || '',
              }))}
            />
          </div>
        )}
      </div>

      <label className="fx-row items-center gap-3">
        <input
          type="checkbox"
          checked={Boolean(draft[spec.visibleKey])}
          onChange={(e) => set(spec.visibleKey, e.target.checked)}
        />
        <span className="text-sm text-ink">{spec.visibleFieldLabel}</span>
      </label>

      <div className="fx-row fx-row--gap">
        <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>
          {creating ? `Add ${spec.singular.toLowerCase()}` : 'Save'}
        </button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The three lists, as data.
 *
 * `visibleDefault` differs on purpose. A sponsor or a category is created by the
 * operator from nothing and appearing immediately is what they meant; a
 * testimonial is a quotation attributed to a NAMED PERSON, and a half-typed
 * draft under somebody's real name on the front page is a failure the default
 * should prevent rather than one the operator has to remember to prevent. The
 * database carries the same asymmetry as a column default.
 */
const KINDS = {
  sponsors: {
    title: 'Sponsors',
    singular: 'Sponsor',
    idKey: 'id',
    description: 'The logo wall on the homepage. It is hidden entirely while there are none — a row of placeholder logos would be a claim that companies endorse Eventsli.',
    empty: 'No sponsors yet.',
    emptyHint: 'The homepage hides the whole section until one is added.',
    deleteWarning: 'The logo file is deleted with it. This cannot be undone.',
    visibleKey: 'isEnabled',
    visibleDefault: true,
    visibleLabel: 'Shown',
    hiddenLabel: 'Hidden',
    visibleFieldLabel: 'Show on the homepage',
    imageKey: 'logoUrl',
    imagePathKey: 'logoPath',
    imageLabel: 'Logo',
    scope: 'sponsors',
    describe: (r) => r.name,
    subtitle: (r) => r.linkUrl || (r.logoUrl ? 'No link' : 'No logo — hidden from the homepage'),
    fields: [
      { name: 'name', label: 'Name', max: 120 },
      { name: 'linkUrl', label: 'Website', optional: true, max: 2000, placeholder: 'https://', hint: 'Opens in a new tab.' },
      { name: 'blurb', label: 'Note', optional: true, max: 300, type: 'textarea', hint: 'Internal only — not shown on the homepage.' },
    ],
  },

  testimonials: {
    title: 'Testimonials',
    singular: 'Testimonial',
    idKey: 'id',
    description: 'Quotations on the homepage. New ones start UNPUBLISHED, because a half-typed draft under a real person’s name is the failure worth defaulting against.',
    empty: 'No testimonials yet.',
    emptyHint: 'The homepage hides the section until one is published.',
    deleteWarning: 'The photo is deleted with it. This cannot be undone.',
    visibleKey: 'isPublished',
    visibleDefault: false,
    visibleLabel: 'Published',
    hiddenLabel: 'Draft',
    visibleFieldLabel: 'Publish on the homepage',
    imageKey: 'avatarUrl',
    imagePathKey: 'avatarPath',
    imageLabel: 'Photo',
    scope: 'testimonials',
    describe: (r) => r.authorName,
    subtitle: (r) => r.authorRole || r.body?.slice(0, 60) || '',
    fields: [
      { name: 'authorName', label: 'Name', max: 120 },
      { name: 'authorRole', label: 'Role or detail', optional: true, max: 120, placeholder: 'Bride · Toronto' },
      { name: 'body', label: 'Quote', max: 1200, type: 'textarea' },
      { name: 'rating', label: 'Rating', optional: true, type: 'number', min: 1, max: 5, hint: '1 to 5, or leave empty for no stars.' },
    ],
  },

  categories: {
    title: 'Categories',
    singular: 'Category',
    idKey: 'slug',
    description: 'What an event can be filed under, and the browse rail on the homepage. A category with events in it cannot be deleted — switch it off instead.',
    empty: 'No categories.',
    emptyHint: 'Without one, no event can be filed anywhere.',
    deleteWarning: 'Only possible while no events are filed under it.',
    visibleKey: 'isEnabled',
    visibleDefault: true,
    visibleLabel: 'Shown',
    hiddenLabel: 'Hidden',
    visibleFieldLabel: 'Show in the browse rail',
    imageKey: 'imageUrl',
    imagePathKey: 'imagePath',
    imageLabel: 'Artwork',
    scope: 'categories',
    describe: (r) => r.label,
    subtitle: (r) => r.slug,
    fields: [
      {
        name: 'slug',
        label: 'Id',
        max: 40,
        createOnly: true,
        placeholder: 'food_drink',
        hint: 'Lowercase letters, numbers and underscores. It appears in the URL and cannot be changed later.',
      },
      { name: 'label', label: 'Name', max: 60 },
      { name: 'blurb', label: 'Description', optional: true, max: 300, type: 'textarea' },
    ],
  },
};
