'use client';

import { useState } from 'react';
import { post, del } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
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
 */
export default function TableCategories({ eventId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(`/events/${eventId}/table-categories`);
  const [creating, setCreating] = useState(false);

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
      // The field is `tablesUncategorised` — verified against the live response.
      const n = result?.tablesUncategorised;
      toast.success(typeof n === 'number'
        ? `Deleted. ${n} ${n === 1 ? 'table is' : 'tables are'} now without a category.`
        : 'Deleted.');
      reload();
    } catch (err) {
      toast.error(describeError(err).recovery);
    }
  }

  const categories = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Table categories"
        lede="Labels and colours for the seat map — “Front row”, “Balcony”. Optional, and each table keeps its own price."
        actions={!creating && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setCreating(true)}>
            Add a category
          </button>
        )}
      />

      {creating && (
        <CategoryForm
          eventId={eventId}
          onDone={(name) => { setCreating(false); toast.success(`“${name}” was added.`); reload(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={2} label="Loading categories" />
      ) : categories.length === 0 ? (
        !creating && <Empty title="No categories yet." hint="They are optional — use them to group tables on a large map." />
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
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (c) => (
                <button type="button" onClick={() => remove(c)} className="text-sm text-muted hover:text-ink">Delete</button>
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

function CategoryForm({ eventId, onDone, onCancel }) {
  const [form, setForm] = useState({ name: '', color: '#059669' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/table-categories`, form, { noRedirect: true });
      onDone(form.name);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title="New category">
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
            className="h-11 w-20 cursor-pointer rounded-[--es-radius-md] border border-border-strong bg-surface"
          />
        </div>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} busyLabel="Adding…">Add category</SubmitButton>
          <button type="button" onClick={onCancel} className="es-btn es-btn--ghost">Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
