'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import NavIcon from '../../../../../components/shell/NavIcon';
import { messageFor } from '../../../../../utils/errors';
import VenueScene3D from '../../../../../components/venue/VenueScene3D';
import PanoramaViewer from '../../../../../components/venue/PanoramaViewer';
import { buildSceneModel, eyeFor } from '../../../../../components/venue/sceneModel';
import { VIEW_KINDS, MAX_VIEWS, studioId, tierPalette } from '../../../../../components/venue/venueModel';
import { keyOf } from '../useMapDraft';
import { uploadStudioImage, aspectOf } from './uploadStudioImage';
import { TextField, SelectField, RangeField } from './fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 360° views: what a buyer sees from where they would sit.
 *
 * EVERY SEAT ALREADY HAS ONE. The view is generated from the layout — height,
 * angle and distance to the stage from that exact chair — so a venue with no
 * photos still answers "can I see from here?" for every seat on the map.
 *
 * PHOTOS ARE BETTER WHERE THEY EXIST, so an organizer can upload real 360°
 * panoramas and link each to the rows it was taken from. A buyer looking from
 * a linked row sees the photo; everyone else sees the generated view. Linking
 * is by row, not by seat: one photo honestly represents its neighbours, and
 * nobody photographs 8,000 chairs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Studio360({ eventId, tables, zones, world, scene, views, onViews, sections, tiers, eventTitle }) {
  const [selected, setSelected] = useState(views[0]?.id || 'generated');
  const [fromTable, setFromTable] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const fileRef = useRef(null);

  const plain = useMemo(() => tables.map((t) => ({
    id: keyOf(t), label: t.label, shape: t.shape, seatCount: t.seatCount, position: t.position, tierId: t.tierId,
  })), [tables]);
  const model = useMemo(() => buildSceneModel({ tables: plain, zones, scene, world }), [plain, zones, scene, world]);
  const palette = useMemo(() => tierPalette(tiers, []), [tiers]);
  const tierOf = useMemo(() => new Map(plain.map((t) => [t.id, t.tierId])), [plain]);
  // The function is its own colour key: it changes exactly when the colours do.
  const colorFor = useCallback((entry) => palette.get(tierOf.get(entry.tableId)) || '#8fa3a8', [palette, tierOf]);
  const colorKey = colorFor;
  const buildKey = useMemo(() => ({}), [model, eventTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = views.find((v) => v.id === selected) || null;
  const tableLabel = fromTable || plain[Math.floor(plain.length / 2)]?.label || '';
  const rowSeats = model.seats.filter((s) => s.tableLabel === tableLabel);
  const seat = rowSeats[Math.floor(rowSeats.length / 2)] || null;
  const eye = seat ? eyeFor(seat, model, scene) : null;

  const update = (id, patch) => onViews(views.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const remove = (id) => { onViews(views.filter((v) => v.id !== id)); setSelected('generated'); };

  async function onFile(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setWarning(null);
    try {
      const ratio = await aspectOf(file).catch(() => 2);
      if (Math.abs(ratio - 2) > 0.15) {
        setWarning(`This image is ${ratio.toFixed(2)}:1. A 360° panorama is 2:1, so this one will look stretched. Export it as an "equirectangular" panorama.`);
      }
      const asset = await uploadStudioImage(eventId, file, 'panorama');
      const id = studioId('v');
      const name = file.name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 60) || 'Seat view';
      onViews([...views, { id, path: asset.path, url: asset.url, name, kind: 'seat', tables: [], heading: 0 }]);
      setSelected(id);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const toggleRows = (labels, on) => {
    const set = new Set(view.tables);
    for (const l of labels) { if (on) set.add(l); else set.delete(l); }
    update(view.id, { tables: [...set] });
  };
  const sectioned = new Set(sections.flatMap((s) => s.rows.map((r) => r.table)));
  const loose = plain.filter((t) => !sectioned.has(t.label));

  return (
    <div className="es-studio-split es-studio-split--wide">
      <div className="es-dcard es-studio-stagecard">
        <div className="relative es-studio-viewport">
          {view ? (
            <PanoramaViewer key={view.id + view.heading} className="h-full w-full" url={view.url} heading={view.heading} label={view.name} />
          ) : plain.length === 0 ? (
            <div className="es-studio-empty">
              <p className="font-medium text-ink">No seats yet</p>
              <p className="text-sm text-muted">Every seat you draw gets a 360° view automatically.</p>
            </div>
          ) : (
            <VenueScene3D
              className="h-full w-full" model={model} scene={scene} title={eventTitle}
              buildKey={buildKey} colorKey={colorKey} colorFor={colorFor}
              mode="eye" eye={eye} ariaLabel={`The view from ${tableLabel}`}
            />
          )}
        </div>
        {!view && plain.length > 0 && (
          <div className="fx-row gap-3">
            <div className="fx-min0" style={{ flex: '1 1 14rem' }}>
              <SelectField
                label="See the view from" value={tableLabel} onChange={setFromTable}
                options={plain.map((t) => [t.label, t.label])}
              />
            </div>
            <p className="text-xs text-subtle" style={{ flex: '2 1 16rem' }}>
              Generated from your layout and 3D settings. Buyers get this for every seat that has no photo.
            </p>
          </div>
        )}
      </div>

      <aside className="es-dcard fx-stack" aria-labelledby="views-title">
        <div>
          <h2 id="views-title" className="es-dcard__title">360° views</h2>
          <p className="es-ovcard__desc">Upload real panoramas and link them to the rows they were taken from.</p>
        </div>

        <ul className="es-viewlist">
          <li>
            <button type="button" aria-pressed={selected === 'generated'} className="es-viewlist__item" onClick={() => setSelected('generated')}>
              <span className="es-viewlist__thumb es-viewstrip__img--seat" aria-hidden="true" />
              <span className="fx-min0"><b>Every seat</b><small>Automatic, from your layout</small></span>
            </button>
          </li>
          {views.map((v) => (
            <li key={v.id}>
              <button type="button" aria-pressed={selected === v.id} className="es-viewlist__item" onClick={() => setSelected(v.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.url} alt="" className="es-viewlist__thumb" />
                <span className="fx-min0">
                  <b className="fx-truncate">{v.name}</b>
                  <small>{v.tables.length ? `${v.tables.length} ${v.tables.length === 1 ? 'row' : 'rows'} linked` : 'Not linked to seats yet'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button" className="es-btn es-btn--secondary" disabled={uploading || views.length >= MAX_VIEWS}
          onClick={() => fileRef.current?.click()}
        >
          <NavIcon name="plus" size={18} />{uploading ? 'Uploading…' : 'Upload a 360° photo'}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="360° photo" onChange={(e) => onFile(e.target.files?.[0])} />
        {warning && <p className="text-sm text-warning" role="status">{warning}</p>}
        {error && <p className="text-sm text-danger" role="alert">{messageFor(error)}</p>}

        {view && (
          <div className="fx-stack border-t border-border-base pt-3">
            <TextField label="Name" value={view.name} onChange={(name) => update(view.id, { name })} maxLength={60} />
            <SelectField label="Kind" value={view.kind} onChange={(kind) => update(view.id, { kind })} options={VIEW_KINDS.map((k) => [k.key, k.label])} />
            <RangeField
              label="Opens facing" value={view.heading} min={-180} max={180} step={5}
              onChange={(heading) => update(view.id, { heading })} format={(v) => `${v}°`}
              hint="Turn it until the stage is in front when the view opens."
            />
            <fieldset className="fx-stack gap-2">
              <legend className="mb-1 text-sm text-ink">Shown for these rows</legend>
              <div className="es-viewlinks">
                {sections.map((s) => {
                  const labels = s.rows.map((r) => r.table);
                  const all = labels.every((l) => view.tables.includes(l));
                  return (
                    <label key={s.id} className={`es-chip ${all ? 'es-chip--on' : ''}`}>
                      <input type="checkbox" className="sr-only" checked={all} onChange={(e) => toggleRows(labels, e.target.checked)} />
                      Section {s.name}
                    </label>
                  );
                })}
                {loose.map((t) => {
                  const on = view.tables.includes(t.label);
                  return (
                    <label key={t.id} className={`es-chip ${on ? 'es-chip--on' : ''}`}>
                      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => toggleRows([t.label], e.target.checked)} />
                      {t.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <button type="button" className="es-btn es-btn--ghost es-btn--sm self-start text-danger" onClick={() => remove(view.id)}>
              <NavIcon name="trash" size={16} />Remove this view
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
