'use client';

import { useEffect, useState } from 'react';
import { get, put } from '../../../../../utils/apiClient';
import { describeError } from '../../../../../utils/errors';
import { LOOK_PRESETS, cleanLook, presetLook } from '../../../../../components/seating/mapStyle';
import { ColourField, Segmented } from '../../../../../components/inspector/fields';
import NavIcon from '../../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Map look (2026-11-18): the whole map's theme — floor, walls, tables, labels,
 * the two seat colours and the label font — from a preset, from one of the
 * organizer's saved looks, or colour by colour.
 *
 * Since 2026-11-21 it is a section of the Map inspector rather than a card of
 * its own, and the seven colour-by-colour fields fold under "Custom colours":
 * most organizers pick a look, and the fields were a wall of pickers under it.
 *
 * The look is part of the map's draft (one undo step, saved with Save map).
 * Saved looks belong to the organizer's account (`/organizer/map-looks`), so a
 * look made for one event is there for the next. A table's or area's own
 * colours still win over the look; "Apply to all tables" clears the tables'
 * own fills so the look shows everywhere.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const FIELDS = [
  ['floor', 'Floor', '#ffffff'],
  ['wall', 'Walls', '#0e3a4a'],
  ['table', 'Tables', '#eaeaea'],
  ['label', 'Names', '#111018'],
  ['seat', 'Seats, first ticket type', '#ff414b'],
  ['accent', 'Seats, second ticket type', '#ffcc00'],
];

export default function MapLookCard({ look, onChange, onApplyToTables, tableCount = 0 }) {
  const [saved, setSaved] = useState([]);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  // The name being typed for a new saved look, or null when not saving.
  const [naming, setNaming] = useState(null);
  // Open from the start when the look was edited colour by colour; after that
  // the reader's own clicks decide (it used to be stuck open once edited).
  const [custom, setCustom] = useState(() => !!look && !look.name);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await get('/organizer/map-looks', { cache: 'no-store', noRedirect: true });
        if (!cancelled) setSaved(Array.isArray(res?.looks) ? res.looks : []);
      } catch {
        // No saved looks to offer; the presets still work.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (key, value) => onChange((current) => cleanLook({ ...(current || {}), [key]: value || undefined, name: undefined }));

  const startSave = () => {
    if (!cleanLook(look)) { setNote('Pick a look or a colour first.'); return; }
    setNote(null);
    setNaming(look?.name && !LOOK_PRESETS.some((p) => p.name === look.name) ? look.name : 'My look');
  };

  const saveLook = async (e) => {
    e.preventDefault();
    const clean = cleanLook(look);
    const name = String(naming || '').trim();
    if (!clean || !name) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await put('/organizer/map-looks', { looks: [...saved, { ...clean, name: name.slice(0, 40) }] }, { noRedirect: true });
      setSaved(res?.looks || []);
      setNaming(null);
      onChange({ ...clean, name: name.slice(0, 40) });
      setNote(`Saved “${name.slice(0, 40)}” to your account.`);
    } catch (err) {
      setNote(describeError(err).title);
    } finally {
      setBusy(false);
    }
  };

  const removeLook = async (id) => {
    setBusy(true);
    try {
      const res = await put('/organizer/map-looks', { looks: saved.filter((l) => l.id !== id) }, { noRedirect: true });
      setSaved(res?.looks || []);
    } catch (err) {
      setNote(describeError(err).title);
    } finally {
      setBusy(false);
    }
  };

  const activeName = look?.name || null;
  // A look edited colour by colour has no name; say so instead of showing no tile chosen.
  const customised = !!look && !activeName;

  return (
    <>
      <ul className="es-lookgrid" aria-label="Looks">
        <li className="es-lookgrid__item">
          <button type="button" className="es-lookgrid__tile" aria-pressed={!look} onClick={() => onChange(null)}>
            <LookSwatch look={{}} />
            <span className="fx-truncate">Plain</span>
          </button>
        </li>
        {[...LOOK_PRESETS.map((p) => ({ ...presetLook(p), id: p.id, preset: true })), ...saved].map((l) => (
          <li key={l.id} className="es-lookgrid__item">
            <button
              type="button"
              className="es-lookgrid__tile" title={l.name}
              aria-pressed={activeName === l.name}
              onClick={() => onChange(cleanLook(l))}
            >
              <LookSwatch look={l} />
              <span className="fx-truncate">{l.name}</span>
            </button>
            {!l.preset && (
              <button type="button" className="es-lookgrid__remove" aria-label={`Delete saved look ${l.name}`} disabled={busy} onClick={() => removeLook(l.id)}>×</button>
            )}
          </li>
        ))}
        <li className="es-lookgrid__item">
          <button type="button" className="es-lookgrid__tile es-lookgrid__tile--add" onClick={startSave} disabled={busy}>
            <span className="es-lookgrid__plus" aria-hidden="true">+</span>
            <span>Save look</span>
          </button>
        </li>
      </ul>
      {naming !== null && (
        <form className="fx-row items-center gap-2" onSubmit={saveLook}>
          <label htmlFor="look-name" className="sr-only">Name this look</label>
          <input id="look-name" className="es-input es-input--dense fx-min0 flex-1" maxLength={40} value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
          <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || !naming.trim()}>Save</button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      {note && <p className="es-field__hint" role="status">{note}</p>}

      <button
        type="button" className="es-insp__sub" aria-expanded={custom} onClick={() => setCustom((v) => !v)}
      >
        <span>Custom colours</span>
        {customised && <span className="es-insp__subtag">Edited</span>}
        <NavIcon name="chevronDown" size={15} className="es-insp__subchev" />
      </button>
      {custom && (
        <div className="es-insp__subbody">
          {FIELDS.map(([key, label, fallback]) => (
            <ColourField key={key} label={label} value={look?.[key] || null} fallback={fallback} onChange={(v) => set(key, v)} />
          ))}
          <Segmented
            label="Name font" value={look?.font || 'sans'}
            options={[['sans', 'Plain'], ['bold', 'Bold'], ['serif', 'Serif']]}
            onChange={(v) => set('font', v)}
          />
        </div>
      )}

      {/* A quiet text action, not a second big button under the tiles. */}
      <button
        type="button" className="es-textbtn" disabled={!tableCount} onClick={onApplyToTables}
        title="Clears the colours set on single tables, so this look shows everywhere"
      >
        <NavIcon name="refresh" size={15} />Use this look on every table
      </button>
    </>
  );
}

/** A thumbnail of a look: its floor, a table and two seats. */
function LookSwatch({ look }) {
  return (
    <svg width="100%" height={28} viewBox="0 0 60 28" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="es-lookgrid__swatch">
      <rect width={60} height={28} fill={look.floor || '#ffffff'} />
      <rect x={10} y={13} width={40} height={9} rx={2} fill={look.table || '#eaeaea'} />
      <circle cx={20} cy={7} r={3} fill={look.seat || '#ff414b'} />
      <circle cx={30} cy={7} r={3} fill={look.accent || look.seat || '#ffcc00'} />
      <circle cx={40} cy={7} r={3} fill={look.seat || '#ff414b'} />
    </svg>
  );
}
