'use client';

import { Outline } from '../../../../../components/seating/StyledZoneShape';
import { ZONE_SHAPES } from '../../../../../components/seating/mapStyle';
import { ColourField, RangeField, Segmented, TextField, Toggle } from '../../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How one area looks (2026-11-18): its shape, colours, border and words — the
 * "Area style" card of the owner's reference. Walls, doors and text show only
 * what applies to them.
 *
 * The zone's `color` stays what it always was — the outline, icon and the wash
 * when there is no fill — so a map styled before this keeps its look. It used
 * to be a separate picker above this section with its own "Use the default"
 * button; it is now the first colour here, with the same reset as the rest
 * (2026-11-21). A wall's thickness, which was a number field AND a slider, is
 * now only the number beside its length (ZonePanel).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SHAPE_NAMES = { rect: 'Square corners', rounded: 'Rounded', ellipse: 'Circle or oval', pill: 'Pill', d: 'D-shape', rings: 'Rings' };

/** The words on an area: its second line. Sits with the label in ZonePanel. */
export function ZoneSublabel({ zone, onChange }) {
  return (
    <TextField
      label="Second line" maxLength={60}
      value={zone.sublabel || ''} placeholder="Tea and coffee · Drinks"
      hint="Smaller words under the name. A · starts a new line."
      onChange={(v) => onChange({ sublabel: v || null }, { mergeKey: `${zone.id}:sublabel` })}
    />
  );
}

export default function ZoneStyleSection({ zone, colour, onChange }) {
  const set = (patch, key) => onChange(patch, { mergeKey: `${zone.id}:${key}` });
  const isWall = zone.kind === 'wall';
  const isDoor = zone.kind === 'door_gap';
  const isText = zone.kind === 'text';

  const outline = (
    <ColourField
      label={isWall ? 'Wall colour' : 'Outline colour'} value={zone.color || null} fallback={colour}
      emptyText={isWall ? 'Map look' : 'Default'} onChange={(v) => set({ color: v }, 'color')}
    />
  );

  if (isWall) return outline;

  if (isDoor) {
    return (
      <ColourField label="Name colour" value={zone.textColor} fallback="#10303d" onChange={(v) => set({ textColor: v }, 'textColor')} emptyText="Map look" />
    );
  }

  const shape = zone.shape || (zone.kind === 'decor' ? 'rings' : 'rounded');

  return (
    <>
      {!isText && (
        <div role="group" aria-label="Area shape" className="es-shapegrid es-shapegrid--6">
          {ZONE_SHAPES.map((s) => (
            <button
              key={s} type="button" className="es-shapegrid__tile" aria-pressed={shape === s} title={SHAPE_NAMES[s]}
              onClick={() => set({ shape: s }, 'shape')}
            >
              <svg width={26} height={20} viewBox="-13 -10 26 20" aria-hidden="true">
                {s === 'rings' ? (
                  <>
                    <circle r={9} fill={colour} fillOpacity={0.25} />
                    <circle r={6} fill={colour} fillOpacity={0.8} />
                    <circle r={3} fill="#356e45" />
                  </>
                ) : (
                  <Outline shape={s} w={22} h={15} fill={zone.fill || colour} fillOpacity={zone.fill ? 1 : 0.25} stroke={colour} strokeWidth={1.2} />
                )}
              </svg>
              <span className="sr-only">{SHAPE_NAMES[s]}</span>
            </button>
          ))}
        </div>
      )}

      {!isText && outline}
      <ColourField
        label="Fill" value={zone.fill} fallback={colour}
        emptyText={isText ? 'None' : 'Light wash'} onChange={(v) => set({ fill: v }, 'fill')}
      />
      {zone.fill && (
        <RangeField
          label="Fill strength" min={0} max={100} step={5} value={Math.round((zone.fillOpacity ?? 1) * 100)}
          format={(v) => `${v}%`} onChange={(v) => set({ fillOpacity: v / 100 }, 'fillOpacity')}
        />
      )}

      {!isText && (
        <>
          <Segmented
            label="Border"
            value={zone.strokeStyle || 'solid'}
            options={[['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['none', 'None']]}
            onChange={(v) => set({ strokeStyle: v }, 'strokeStyle')}
            stacked
          />
          {(zone.strokeStyle || 'solid') !== 'none' && (
            <RangeField
              label="Border thickness" min={0.5} max={12} step={0.5} value={zone.strokeWidth ?? 1.5}
              onChange={(v) => set({ strokeWidth: v }, 'strokeWidth')}
            />
          )}
        </>
      )}

      <Segmented
        label="Text size" value={zone.textSize || 'm'}
        options={[['s', 'S'], ['m', 'M'], ['l', 'L']]}
        onChange={(v) => set({ textSize: v }, 'textSize')}
      />
      <ColourField
        label="Text colour" value={zone.textColor} fallback="#10303d"
        onChange={(v) => set({ textColor: v }, 'textColor')}
      />
      {!isText && (
        <Toggle
          label="Show name"
          checked={zone.showLabel !== false}
          onChange={(on) => set({ showLabel: on ? null : false }, 'showLabel')}
        />
      )}
      {!isText && (
        <Toggle
          label="Show icon"
          checked={zone.showIcon ?? (!zone.sublabel && shape !== 'rings')}
          onChange={(on) => set({ showIcon: on }, 'showIcon')}
        />
      )}
    </>
  );
}
