'use client';

import { minZoneSize, zoneColor, zoneLabel, zoneMeta } from '../../../../components/seating/venueZones';
import ZoneStyleSection, { ZoneSublabel } from './style/ZoneStyleSection';
import { METRES_PER_UNIT, worldOf } from '../../../../components/seating/seatingGeometry';
import ZonePreview from './ZonePreview';
import { Inspector, InspectorSection, InspectorAction } from '../../../../components/inspector/Inspector';
import { NumberField, Pair, TextField } from '../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything about one venue zone — a stage, a bar, a wall, a door, a word on
 * the floor.
 *
 * Deliberately calmer than `TablePanel`. A table is stock: its seat count
 * generates rows, its price is money, and shrinking it can destroy a seat
 * somebody holds a ticket for. A zone is a labelled shape in a JSON blob;
 * nothing it can be set to can hurt anyone, and nothing about it is refused by
 * the API. So it gets plain controls and no warnings.
 *
 * SIZES ARE IN METRES (2026-11-21), like the Venue size card. They used to be
 * "map units — the venue is 1000 by 700", a number only the code knew how to
 * read. Stored as units, as before; converted at the field.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ZonePanel({
  zone, onChange, onRotate, onResetSize, onDuplicate, onRemove, world = worldOf(null),
}) {
  const meta = zoneMeta(zone.kind);
  const colour = zoneColor(zone);
  const min = minZoneSize(zone.kind);
  const set = (patch, options) => onChange(zone.id, patch, options);
  const isWall = zone.kind === 'wall';
  // A text label draws a second line too (StyledZoneShape), so it gets the field.
  const hasWords = !['wall', 'door_gap'].includes(zone.kind);
  const m = metres;

  return (
    <Inspector
      label={meta.label}
      icon={<ZonePreview kind={zone.kind} size={22} color={colour} />}
      title={zoneLabel(zone)}
      meta={`${m(zone.w)} × ${m(zone.h)} m · turned ${Math.round(zone.rotation || 0)}° · never sold`}
      actions={(
        <>
          <InspectorAction icon="rotate" onClick={() => onRotate(90)} title="Turn 90°">Rotate</InspectorAction>
          <InspectorAction icon="copy" onClick={onDuplicate}>Duplicate</InspectorAction>
          <InspectorAction icon="trash" tone="danger" onClick={() => onRemove(zone.id)}>Delete</InspectorAction>
        </>
      )}
    >
      <InspectorSection id="zone-basics" title={isWall ? 'Wall' : 'Details'} summary={`${m(zone.w)} × ${m(zone.h)} m`}>
        {!isWall && (
          <TextField
            label={zone.kind === 'text' ? 'Text' : 'Name'} value={zone.label || ''} maxLength={40} placeholder={meta.label}
            // One undo step for a typed name, not one per keystroke.
            onChange={(label) => set({ label }, { mergeKey: `${zone.id}:label` })}
          />
        )}
        {hasWords && <ZoneSublabel zone={zone} onChange={set} />}
        <Pair>
          <MetreField
            label={isWall ? 'Length' : 'Width'} units={zone.w} min={min.w} max={world.width}
            onChange={(w) => set({ w }, { mergeKey: `${zone.id}:w` })}
          />
          <MetreField
            label={isWall ? 'Thickness' : 'Depth'} units={zone.h} min={min.h} max={world.height}
            onChange={(h) => set({ h }, { mergeKey: `${zone.id}:h` })}
          />
        </Pair>
        <button type="button" className="es-linkbtn self-start text-xs" onClick={() => onResetSize(zone.id)}>
          Reset to the default size
        </button>
      </InspectorSection>

      <InspectorSection id="zone-look" title="Appearance" summary={zone.fill || zone.color ? 'Own colours' : 'Default colours'}>
        <ZoneStyleSection zone={zone} colour={colour} onChange={set} />
      </InspectorSection>
    </Inspector>
  );
}

/** Units as metres: centimetres under 2 m (a wall is a few units thick), else decimetres. */
export function metres(units) {
  const v = units * METRES_PER_UNIT;
  return v < 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
}

/**
 * A size typed in metres and stored in units, clamped to what `layoutZones`
 * accepts. The shared NumberField does the typing: a size inside the bounds
 * applies as it is typed, anything else waits for blur and is clamped then —
 * so "0.4" no longer jumps to the minimum half-way through being typed.
 */
export function MetreField({ label, units, min, max, onChange }) {
  const lo = Math.ceil(min * METRES_PER_UNIT * 100) / 100;
  const hi = Math.floor(max * METRES_PER_UNIT * 100) / 100;
  return (
    <NumberField
      label={label} value={metres(units)} min={lo} max={hi} step={0.01} suffix="m"
      onChange={(m) => onChange(Math.min(max, Math.max(min, Math.round(m / METRES_PER_UNIT))))}
    />
  );
}
