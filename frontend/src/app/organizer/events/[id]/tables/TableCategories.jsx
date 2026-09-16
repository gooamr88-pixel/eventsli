'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../../utils/apiClient';
import { messageFor } from '../../../../utils/errors';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import DataTable from '../../../../components/ui/DataTable';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, Empty, ErrorNotice } from '../../../../components/Feedback';

/**
 * Table categories. BRD §24 — presentation, not pricing.
 *
 * The distinction from a ticket type matters and is the reason deleting one is
 * SAFE where deleting a tier is refused: a category has no price, so removing
 * it uncategorises some tables and changes nothing about what anything costs.
 *
 * Renaming and recolouring are offered — the API always allowed both.
 */
const DEFAULT_COLOR = '#2c62bd';

export default function TableCategories({ eventId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(`/events/${eventId}/table-categories`);
  const [editing, setEditing] = useState(null);   // null · 'new' · a category

  async function remove(category) {
    const ok = await confirm({
      title: `Delete “${category.name}”?`,
      body: <p>Tables in it keep their price and simply lose the label. Nothing about what anything costs changes.</p>,
      confirmLabel: 'Delete category',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const result = await del(`/events/${eventId}/table-categories/${category.id}`, { noRedirect: true });
      const n = result?.tablesUncategorised;
      toast.success(typeof n === 'number'
        ? `Deleted. ${n} ${n === 1 ? 'table is' : 'tables are'} now without a category.`
        : 'Deleted.');
      reload();
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  const categories = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Table categories"
        lede="Labels and colours for the seat map — “Front row”, “Balcony”. Optional, and each table keeps its own price."
        actions={!editing && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing('new')}>
            Add a category
          </button>
        )}
      />

      {editing && (
        <CategoryForm
          key={editing === 'new' ? 'new' : editing.id}
          eventId={eventId}
          category={editing === 'new' ? null : editing}
          onDone={(message) => { setEditing(null); toast.success(message); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={2} label="Loading categories" />
      ) : categories.length === 0 ? (
        !editing && <Empty title="No categories yet." hint="They are optional — use them to group tables on a large map." />
      ) : (
        <DataTable
          caption="Table categories"
          rows={categories}
          columns={[
            {
              key: 'name',
              label: 'Category',
              primary: true,
              render: (c) => (
                <span className="fx-row">
                  {c.color && <Swatch color={c.color} />}
                  <span className="fx-break text-ink">{c.name}</span>
                </span>
              ),
            },
            {
              key: 'tables',
              label: 'Tables',
              align: 'end',
              render: (c) => <span className="es-nums">{c.tableCount ?? '—'}</span>,
            },
            {
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (c) => (
                <span className="fx-row justify-end">
                  <button type="button" onClick={() => setEditing(c)} className="es-btn es-btn--ghost es-btn--sm">Edit</button>
                  <button type="button" onClick={() => remove(c)} className="es-btn es-btn--ghost es-btn--sm">Delete</button>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

/** The organizer's own colour, drawn as an SVG fill attribute rather than an inline style. */
function Swatch({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill={color} className="es-chart__grid" strokeWidth="1" />
    </svg>
  );
}

function CategoryForm({ eventId, category, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: category?.name || '',
    color: category?.color || DEFAULT_COLOR,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (category) {
        const body = {};
        if (form.name.trim() !== category.name) body.name = form.name.trim();
        if (form.color !== (category.color || DEFAULT_COLOR)) body.color = form.color;
        if (Object.keys(body).length === 0) { onCancel(); return; }
        await patch(`/events/${eventId}/table-categories/${category.id}`, body, { noRedirect: true });
        onDone(`“${form.name.trim()}” was updated.`);
      } else {
        await post(`/events/${eventId}/table-categories`, { name: form.name.trim(), color: form.color }, { noRedirect: true });
        onDone(`“${form.name.trim()}” was added.`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title={category ? `Edit “${category.name}”` : 'New category'}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <Field
          label="Name" name="name" required maxLength={80} autoFocus
          hint="e.g. Front row"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="cat-color" className="text-sm text-ink">Colour on the map</label>
          <input
            id="cat-color"
            type="color"
            value={form.color}
            onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
            // The column is TEXT(7), so `#RRGGBB` from a native colour input fits exactly.
            className="es-input h-11 w-20 cursor-pointer p-1"
          />
        </div>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} busyLabel="Saving…">{category ? 'Save changes' : 'Add category'}</SubmitButton>
          <button type="button" onClick={onCancel} className="es-btn es-btn--ghost">Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
