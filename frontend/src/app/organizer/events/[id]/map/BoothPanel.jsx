'use client';

import Link from 'next/link';
import { BOOTH_META, minZoneSize } from '../../../../components/seating/venueZones';
import { boothColor, boothStatus } from '../../../../components/seating/boothZones';
import { worldOf } from '../../../../components/seating/seatingGeometry';
import { Inspector, InspectorSection, InspectorAction, InspectorNote } from '../../../../components/inspector/Inspector';
import { Pair, SelectField, TextField, Toggle } from '../../../../components/inspector/fields';
import { MetreField, metres } from './ZonePanel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE VENDOR BOOTH, on the venue map (2026-11-22).
 *
 * Its code (A1, DB7), its booth type — which sets its colour and the price a
 * vendor is offered — whether it is held back, and its size in metres. Above
 * them, who holds it: a booth offered to or booked by a vendor names them and
 * links to the application, and cannot be deleted (the floor plan save refuses
 * that too, naming the vendor), only moved.
 *
 * Booth types themselves — names, prices, inclusions — are made in
 * Vendors › Booths; this panel only picks one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS_TEXT = { available: 'Available', held: 'Reserved for a vendor', sold: 'Booked', blocked: 'Unavailable' };

export default function BoothPanel({
  zone, eventId, boothInfo = null, onChange, onRotate, onDuplicate, onRemove, world = worldOf(null),
}) {
  const boothTypes = boothInfo?.boothTypes || [];
  const state = boothInfo?.states?.[zone.id] || null;
  const status = boothStatus(zone, state);
  const claimed = status === 'held' || status === 'sold';
  const type = boothTypes.find((t) => t.id === zone.boothTypeId) || null;
  const colour = boothColor(boothTypes, zone.boothTypeId);
  const min = minZoneSize(zone.kind);
  const set = (patch, options) => onChange(zone.id, patch, options);
  const code = String(zone.label || '').trim();

  return (
    <Inspector
      label="Vendor booth"
      icon={<span className="es-boothchip" style={{ background: colour }} />}
      title={code ? `Booth ${code}` : 'Booth'}
      meta={`${metres(zone.w)} × ${metres(zone.h)} m · ${type ? type.name : 'no booth type'}`}
      status={(
        <div className="es-insp__status" data-tone={claimed ? 'accent' : status === 'blocked' ? 'muted' : 'success'}>
          <b>{STATUS_TEXT[status]}</b>
          {state?.vendor?.name && <span> · {state.vendor.name}</span>}
          {state?.applicationId && (
            <Link className="es-linkbtn text-xs" href={`/organizer/events/${eventId}/vendors/${state.applicationId}`}>
              Open application
            </Link>
          )}
        </div>
      )}
      actions={(
        <>
          <InspectorAction icon="rotate" onClick={() => onRotate(90)} title="Turn 90°">Rotate</InspectorAction>
          <InspectorAction icon="copy" onClick={onDuplicate}>Duplicate</InspectorAction>
          <InspectorAction
            icon="trash" tone="danger" onClick={() => onRemove(zone.id)} disabled={claimed}
            title={claimed ? 'A vendor holds this booth. Move it instead, or close the offer first.' : null}
          >
            Delete
          </InspectorAction>
        </>
      )}
    >
      <InspectorSection id="booth-basics" title="Booth" summary={code || 'No code'}>
        <TextField
          label="Code" value={zone.label || ''} maxLength={12} placeholder="A1"
          hint="Shown on the booth and in the vendor's offer."
          onChange={(label) => set({ label }, { mergeKey: `${zone.id}:label` })}
        />
        <SelectField
          label="Booth type"
          value={zone.boothTypeId || ''}
          onChange={(v) => set({ boothTypeId: v || null })}
          options={[['', 'No type yet'], ...boothTypes.map((t) => [t.id, t.name])]}
          hint={boothTypes.length ? 'Sets its colour and the price offered.' : 'Make booth types in Vendors › Booths.'}
        />
        <Toggle
          label="Unavailable" hint="Kept off sale — for the organizer, a sponsor, or a fire exit."
          checked={zone.blocked === true} disabled={claimed}
          onChange={(blocked) => set({ blocked })}
        />
      </InspectorSection>

      <InspectorSection id="booth-size" title="Size" summary={`${metres(zone.w)} × ${metres(zone.h)} m`}>
        <Pair>
          <MetreField label="Width" units={zone.w} min={min.w} max={world.width} onChange={(w) => set({ w }, { mergeKey: `${zone.id}:w` })} />
          <MetreField label="Depth" units={zone.h} min={min.h} max={world.height} onChange={(h) => set({ h }, { mergeKey: `${zone.id}:h` })} />
        </Pair>
        <button type="button" className="es-linkbtn self-start text-xs" onClick={() => set({ w: BOOTH_META.w, h: BOOTH_META.h })}>
          Standard 3 × 3 m
        </button>
      </InspectorSection>

      {claimed && (
        <InspectorNote>
          A vendor holds this booth, so it can be moved or resized but not deleted.
        </InspectorNote>
      )}
      <Link className="es-linkbtn self-start text-xs" href={`/organizer/events/${eventId}/vendors`}>
        Manage booth types and vendors
      </Link>
    </Inspector>
  );
}
