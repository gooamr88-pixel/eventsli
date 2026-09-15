'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, put } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { WORLD } from '../../../../components/seating/seatingGeometry';
import EditorCanvas from './EditorCanvas';
import TablePanel from './TablePanel';
import { useMapDraft, keyOf, MAX_TABLES } from './useMapDraft';
import { useUnsavedGuard } from './useUnsavedGuard';
import { Loading } from '../../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue map editor.
 *
 * Saving is a FULL REPLACE — `PUT /events/:id/venue-map` takes the whole table
 * list and reconciles it in ONE transaction. Anything still listed is created
 * or updated, anything dropped is deleted, and every deletion is checked
 * against live stock first. A refusal rolls the whole thing back.
 *
 * That last part is why this screen can be confident: the save either lands
 * completely or changes nothing. The alternative, which this API used to be, was
 * a loop of separate statements — a network blip halfway left the map half
 * saved, with no way to tell which half and no way back. For someone laying out
 * a two-hundred-table room, that is their afternoon.
 *
 * WHICH IS ALSO WHY LEAVING ASKS FIRST (useUnsavedGuard), why a table can be
 * added with a button as well as a double-click (which touch screens do not
 * reliably send), and why Ctrl+Z inside a text field undoes the typing rather
 * than the map.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MapEditor({ eventId }) {
  const draft = useMapDraft();
  const { tables, dirty, problems, reset, undo, redo, addTable, updateTable, removeTable } = draft;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [layout, setLayout] = useState({});

  useUnsavedGuard(dirty);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [map, tierList, categoryList] = await Promise.all([
          get(`/events/${eventId}/venue-map`, { cache: 'no-store' }),
          get(`/events/${eventId}/tiers`, { cache: 'no-store' }).catch(() => []),
          get(`/events/${eventId}/table-categories`, { cache: 'no-store' }).catch(() => []),
        ]);
        if (cancelled) return;

        reset((map?.tables || []).map(fromApi));
        setLayout(map?.layout || {});
        setTiers(Array.isArray(tierList) ? tierList : []);
        setCategories(Array.isArray(categoryList) ? categoryList : []);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reset]);

  // Ctrl/Cmd+Z and Shift+Z. On a canvas people expect it — but NOT while typing
  // in a field, where the browser's own undo is the one the person means.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await put(`/events/${eventId}/venue-map`, {
        // The layout blob is round-tripped untouched. It is ours to define and
        // nothing reads it yet; dropping it on save would silently discard
        // whatever a future version puts there.
        layout: { ...layout, world: { width: WORLD.width, height: WORLD.height } },
        tables: tables.map(toApi),
      }, { noRedirect: true });

      // Re-read rather than trusting local state: the save assigns ids to new
      // tables and generates their seat rows, and neither exists here. What
      // `reset` loads counts as saved, so "unsaved changes" clears.
      const map = await get(`/events/${eventId}/venue-map`, { cache: 'no-store' });
      reset((map?.tables || []).map(fromApi));
      setSelectedKey(null);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  const selected = tables.find((t) => keyOf(t) === selectedKey) || null;

  if (loading) return <Loading variant="card" />;

  if (loadError) {
    const { title, recovery } = describeError(loadError);
    return (
      <div className="fx-stack fx-stack--sm">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{recovery}</p>
        <Link href={`/organizer/events/${eventId}`} className="text-sm text-accent">
          Back to the event
        </Link>
      </div>
    );
  }

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <h2 className="text-xl">Seat map</h2>
          <p className="text-sm text-muted">
            {tables.length} of {MAX_TABLES} tables
            {dirty && <span className="text-warning"> · unsaved changes</span>}
          </p>
        </div>

        <div className="fx-row">
          <button
            type="button"
            onClick={() => addTable(nextSpot(tables.length))}
            disabled={tables.length >= MAX_TABLES}
            className="es-btn es-btn--secondary"
          >
            Add table
          </button>
          <button
            type="button" onClick={undo} disabled={!draft.canUndo}
            className="rounded-(--es-radius-md) border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button" onClick={redo} disabled={!draft.canRedo}
            className="rounded-(--es-radius-md) border border-border-strong px-3 py-2 text-sm text-ink disabled:opacity-40"
          >
            Redo
          </button>
          <button
            type="button" onClick={save}
            disabled={saving || !dirty || problems.length > 0}
            className="es-btn es-btn--primary"
          >
            {saving ? 'Saving…' : 'Save map'}
          </button>
        </div>
      </div>

      {/* Refused BEFORE the round trip. The API's messages for these are
          accurate but arrive after a save that looked like it was working. */}
      {problems.length > 0 && (
        <ul className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-warning/10 px-4 py-3 text-sm text-muted">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {saveError && <SaveError error={saveError} />}

      <div className="fx-grid fx-grid--2" style={{ '--fx-col': '640px' }}>
        <EditorCanvas
          className="h-[60vh] min-h-[380px]"
          tables={tables}
          categories={categories}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onMove={(key, position, options) => updateTable(
            key,
            { position: { ...position, rotation: rotationOf(tables, key) } },
            options,
          )}
          onAddAt={(position) => addTable(position)}
        />

        <TablePanel
          table={selected}
          tiers={tiers}
          categories={categories}
          // Consecutive edits to the same field of the same table are one undo
          // step: typing a name used to be one step per keystroke.
          onChange={(key, patch) => updateTable(key, patch, {
            mergeKey: `${key}:${Object.keys(patch).sort().join(',')}`,
          })}
          onRemove={(key) => { removeTable(key); setSelectedKey(null); }}
        />
      </div>
    </div>
  );
}

/** Where "Add table" puts the next one: near the middle, fanned out so new
 *  tables do not land exactly on top of each other. */
function nextSpot(count) {
  const step = count % 9;
  return { x: 40 + (step % 3) * 10, y: 40 + Math.floor(step / 3) * 10 };
}

/**
 * A save refusal is usually about STOCK, not about the map: a table with sold
 * seats cannot be deleted, and a table cannot be shrunk past its booked seats.
 * The API names which ones, and that message is the useful part — so it is
 * shown rather than replaced with a generic sentence.
 */
function SaveError({ error }) {
  const { title, recovery } = describeError(error);
  return (
    <div role="alert" className="rounded-(--es-radius-md) bg-danger/10 px-4 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-sm text-muted">{error?.message || recovery}</p>
      <p className="mt-1 text-xs text-subtle">
        Nothing was saved — the whole change was rolled back, so the map is exactly as it
        was.
      </p>
    </div>
  );
}

function rotationOf(tables, key) {
  return tables.find((t) => keyOf(t) === key)?.position?.rotation || 0;
}

/** The API's table → the editor's. `password` is never returned, only
 *  `hasPassword`, so the field starts empty and an untouched one means keep. */
function fromApi(t) {
  return {
    id: t.id,
    label: t.label,
    seatCount: t.seatCount,
    priceCents: t.priceCents,
    isPrivate: t.isPrivate,
    hasPassword: t.hasPassword,
    status: t.status,
    shape: t.shape,
    categoryId: t.categoryId,
    // Seats carry the tier, and every seat on a table shares it — so the first
    // one is the table's band. A table with no seats yet has none.
    tierId: t.seats?.[0]?.tierId || null,
    seatPriceCents: t.seats?.[0]?.priceOverrideCents ?? null,
    position: t.position,
  };
}

/** The editor's table → the API's. */
function toApi(t) {
  return {
    // Absent on a new table, which is how the API tells create from update.
    ...(t.id ? { id: t.id } : {}),
    label: String(t.label).trim(),
    seatCount: Number(t.seatCount),
    priceCents: t.priceCents ?? null,
    isPrivate: !!t.isPrivate,
    // Sent only when actually typed. Sending the editor's state back without a
    // password must not silently unprotect a table — the API keeps the existing
    // hash unless a new one arrives, and clears it only on `isPrivate: false`.
    ...(t.password ? { password: t.password } : {}),
    shape: t.shape,
    categoryId: t.categoryId || null,
    tierId: t.tierId || null,
    seatPriceCents: t.seatPriceCents ?? null,
    position: {
      x: t.position?.x ?? 0,
      y: t.position?.y ?? 0,
      rotation: t.position?.rotation ?? 0,
    },
  };
}
