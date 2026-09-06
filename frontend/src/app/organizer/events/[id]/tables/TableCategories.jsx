'use client';

import { useEffect, useState } from 'react';
import { get, post, del } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';

/**
 * Table categories. BRD §24 — presentation, not pricing.
 *
 * The distinction from a ticket type matters and is the reason deleting one is
 * SAFE where deleting a tier is refused: a category has no price, so removing
 * it uncategorises some tables and changes nothing about what anything costs. A
 * table keeps its own price either way.
 */
export default function TableCategories({ eventId }) {
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/events/${eventId}/table-categories`, { cache: 'no-store' });
        if (!cancelled) { setCategories(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  const refresh = () => setReload((n) => n + 1);

  if (error) return <p className="text-sm text-muted">{describeError(error).recovery}</p>;
  if (!categories) return <p className="text-sm text-subtle">Loading…</p>;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Table categories</h2>
        <p className="max-w-[60ch] text-muted">
          Labels and colours for the seat map — “Front row”, “Balcony”. They group tables
          visually. Each table keeps its own price.
        </p>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-8 text-center">
          <p className="text-muted">None yet. They are optional.</p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {categories.map((c) => (
            <CategoryRow key={c.id} eventId={eventId} category={c} onChanged={refresh} />
          ))}
        </ul>
      )}

      {creating ? (
        <CategoryForm
          eventId={eventId}
          onDone={() => { setCreating(false); refresh(); }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start rounded-[--es-radius-md] border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-bg-sunken"
        >
          Add a category
        </button>
      )}
    </div>
  );
}

function CategoryRow({ eventId, category, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      // The API reports how many tables it uncategorised. Saying so turns a
      // silent success into a confirmation the organizer can check.
      //
      // The field is `tablesUncategorised`. It was read as `uncategorised`
      // first, which is always undefined — so the message simply never
      // appeared, with nothing anywhere to say why. Verified against the live
      // response rather than guessed.
      const data = await del(`/events/${eventId}/table-categories/${category.id}`, {
        noRedirect: true,
      });
      if (typeof data?.tablesUncategorised === 'number') setResult(data.tablesUncategorised);
      onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-row fx-min0">
          {category.color && (
            <span
              className="inline-block h-4 w-4 flex-none rounded-full border border-border-base"
              style={{ background: category.color }}
              aria-hidden="true"
            />
          )}
          <span className="fx-break text-ink">{category.name}</span>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-sm text-muted hover:text-danger disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      {result !== null && (
        <p className="text-xs text-subtle">{result} table(s) left without a category.</p>
      )}
      <FormError error={error} />
    </li>
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
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4"
    >
      <Field
        label="Name" name="name" required maxLength={80} autoFocus
        hint="e.g. Front row"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />

      <div className="fx-stack fx-stack--sm gap-1.5">
        <label htmlFor="cat-color" className="text-sm text-ink">Colour</label>
        <input
          id="cat-color"
          type="color"
          value={form.color}
          onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
          // The column is TEXT with a 7-character limit, so `#RRGGBB` from a
          // native colour input fits exactly.
          className="h-10 w-20 cursor-pointer rounded-[--es-radius-md] border border-border-strong bg-surface"
        />
      </div>

      <FormError error={error} />

      <div className="fx-row fx-row--between">
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <SubmitButton busy={busy} busyLabel="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}
