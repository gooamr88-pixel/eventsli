'use client';

import { useRef, useState } from 'react';
import { useModal } from '../../../../hooks/useModal';
import { METRES_PER_UNIT, worldOf } from '../../../../components/seating/seatingGeometry';
import { boothRowSize, boothRowSpecs, nextBoothNumber } from '../../../../components/seating/boothZones';
import { NumberField, Pair, Segmented, SelectField, TextField } from '../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A ROW OF VENDOR BOOTHS on the venue map (2026-11-22) — the touching rows of
 * an expo hall: how many, how big in metres, across or down, the code's
 * letters and where the numbers start, and one booth type for the lot.
 *
 * The numbers continue the series already on the map (a second "A" row starts
 * after the highest A). The row lands in the middle of the view at the nearest
 * free spot (mapApi.freeSpot), selected, as one undo step.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const toUnits = (m) => Math.max(8, Math.round(Number(m) / METRES_PER_UNIT));
const toMetres = (u) => Math.round(u * METRES_PER_UNIT * 10) / 10;

export default function BoothRowDialog({ zones, boothTypes = [], world = worldOf(null), placeAt, roomForBooths = 60, onAdd, onClose }) {
  const dialogRef = useRef(null);
  useModal(dialogRef, onClose, { stopEscape: true });
  const [form, setForm] = useState({ count: 6, width: 3, depth: 3, gap: 0, direction: 'right', prefix: 'A', boothTypeId: '' });
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const start = nextBoothNumber(zones, form.prefix.trim());
  const count = Math.max(1, Math.min(60, roomForBooths, Math.floor(Number(form.count) || 1)));
  const lastCode = `${form.prefix.trim()}${start + count - 1}`;
  const tooLong = lastCode.length > 12;

  function submit(e) {
    e.preventDefault();
    if (tooLong || count < 1) return;
    const spec = {
      count, w: toUnits(form.width), h: toUnits(form.depth),
      gap: Number(form.gap) > 0 ? Math.round(Number(form.gap) / METRES_PER_UNIT) : 0,
      direction: form.direction, prefix: form.prefix.trim(), start, boothTypeId: form.boothTypeId || null,
    };
    const centre = placeAt(boothRowSize(spec));
    onAdd(boothRowSpecs({ ...spec, centre }, world));
    onClose();
  }

  return (
    <div className="es-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        ref={dialogRef} tabIndex={-1} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="es-boothrow-title"
        className="es-backdrop__panel fx-stack"
      >
        <h2 id="es-boothrow-title" className="text-lg">Add a row of booths</h2>
        <p className="text-sm text-muted">Booths touch side by side, as in an expo hall. Drag the row where it belongs once it is on the map.</p>

        <Pair>
          <NumberField label="How many" value={form.count} min={1} max={Math.min(60, roomForBooths)} onChange={set('count')} />
          <Segmented stacked
            label="Direction" value={form.direction} onChange={set('direction')}
            options={[['right', 'Across'], ['down', 'Down']]}
          />
        </Pair>
        <Pair>
          <NumberField label="Width" value={form.width} min={toMetres(8)} max={60} step={0.5} suffix="m" onChange={set('width')} />
          <NumberField label="Depth" value={form.depth} min={toMetres(8)} max={60} step={0.5} suffix="m" onChange={set('depth')} />
        </Pair>
        <NumberField label="Space between booths" value={form.gap} min={0} max={20} step={0.5} suffix="m" onChange={set('gap')} />
        <Pair>
          <TextField label="Code letters" value={form.prefix} maxLength={8} placeholder="A" onChange={set('prefix')} />
          <SelectField
            label="Booth type" value={form.boothTypeId} onChange={set('boothTypeId')}
            options={[['', 'No type yet'], ...boothTypes.map((t) => [t.id, t.name])]}
          />
        </Pair>

        {tooLong && <p className="text-sm text-danger">A booth code can be at most 12 characters. Use fewer letters.</p>}

        <div className="fx-row fx-row--between flex-wrap gap-2 border-t border-border-base pt-4">
          <p className="text-sm text-muted">
            {count === 1 ? `Adding booth ${form.prefix.trim()}${start}.` : `Adding ${count} booths, ${form.prefix.trim()}${start} to ${lastCode}.`}
          </p>
          <div className="fx-row gap-2">
            <button type="button" onClick={onClose} className="es-btn es-btn--ghost">Cancel</button>
            <button type="submit" disabled={tooLong || count < 1} className="es-btn es-btn--primary">Add to map</button>
          </div>
        </div>
      </form>
    </div>
  );
}
