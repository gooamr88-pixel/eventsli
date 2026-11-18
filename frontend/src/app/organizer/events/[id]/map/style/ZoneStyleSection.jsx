'use client';

import { Outline } from '../../../../../components/seating/StyledZoneShape';
import { ZONE_SHAPES } from '../../../../../components/seating/mapStyle';
import { ColourField, RangeField, Segmented } from './StyleFields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * How one area looks (2026-11-18): its shape, fill, border and words — the
 * "Area style" card of the owner's reference. Walls, doors and text show only
 * what applies to them.
 *
 * The zone's existing `color` stays what it always was — the border, icon and
 * the wash when there is no fill — so a map styled before this keeps its look.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SHAPE_NAMES = { rect: 'Square corners', rounded: 'Rounded', ellipse: 'Circle or oval', pill: 'Pill', d: 'D-shape', rings: 'Rings' };

export default function ZoneStyleSection({ zone, colour, onChange }) {
  const set = (patch, key) => onChange(patch, { mergeKey: `${zone.id}:${key}` });
  const isWall = zone.kind === 'wall';
  const isDoor = zone.kind === 'door_gap';
  const isText = zone.kind === 'text';

  if (isWall) {
    return (
      <div className="fx-stack fx-stack--sm gap-3 border-t border-border-base pt-3">
        <h4 className="text-sm font-semibold text-ink">Wall</h4>
        <RangeField
          label="Thickness" min={2} max={30} step={1} value={zone.h}
          onChange={(h) => set({ h }, 'h')}
        />
        <p className="text-xs text-subtle">
          Leave a gap between walls for a door, or lay a Door over a wall — it shows the floor through it, with its name.
        </p>
      </div>
    );
  }

  if (isDoor) {
    return (
      <div className="fx-stack fx-stack--sm gap-3 border-t border-border-base pt-3">
        <h4 className="text-sm font-semibold text-ink">Door</h4>
        <ColourField id={`zs-text-${zone.id}`} label="Name colour" value={zone.textColor} fallback="#10303d" onChange={(v) => set({ textColor: v }, 'textColor')} />
        <p className="text-xs text-subtle">
          Lay it across a wall and turn it to match: it paints the gap in the floor&apos;s colour and puts its name beside it.
        </p>
      </div>
    );
  }

  const shape = zone.shape || (zone.kind === 'decor' ? 'rings' : 'rounded');

  return (
    <div className="fx-stack fx-stack--sm gap-3 border-t border-border-base pt-3">
      <h4 className="text-sm font-semibold text-ink">{isText ? 'Text style' : 'Area style'}</h4>

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

      <ColourField
        id={`zs-fill-${zone.id}`} label="Fill" value={zone.fill} fallback={colour}
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
          />
          {(zone.strokeStyle || 'solid') !== 'none' && (
            <RangeField
              label="Border thickness" min={0.5} max={12} step={0.5} value={zone.strokeWidth ?? 1.5}
              onChange={(v) => set({ strokeWidth: v }, 'strokeWidth')}
            />
          )}
        </>
      )}

      <div className="fx-stack fx-stack--sm gap-1.5">
        <label htmlFor={`zs-sub-${zone.id}`} className="text-sm text-ink">Second line</label>
        <input
          id={`zs-sub-${zone.id}`} className="es-input" maxLength={60}
          value={zone.sublabel || ''} placeholder="Tea and coffee · Drinks"
          onChange={(e) => set({ sublabel: e.target.value || null }, 'sublabel')}
        />
        <p className="text-xs text-subtle">Smaller words under the name. A · starts a new line.</p>
      </div>

      <Segmented
        label="Text size" value={zone.textSize || 'm'}
        options={[['s', 'S'], ['m', 'M'], ['l', 'L']]}
        onChange={(v) => set({ textSize: v }, 'textSize')}
      />
      <ColourField
        id={`zs-text-${zone.id}`} label="Text colour" value={zone.textColor} fallback="#10303d"
        onChange={(v) => set({ textColor: v }, 'textColor')}
      />
      {!isText && (
        <label className="fx-row items-center justify-between gap-2 text-sm text-ink">
          Show name
          <input
            type="checkbox"
            checked={zone.showLabel !== false}
            onChange={(e) => set({ showLabel: e.target.checked ? null : false }, 'showLabel')}
          />
        </label>
      )}
      {!isText && (
        <label className="fx-row items-center justify-between gap-2 text-sm text-ink">
          Show icon
          <input
            type="checkbox"
            checked={zone.showIcon ?? (!zone.sublabel && shape !== 'rings')}
            onChange={(e) => set({ showIcon: e.target.checked }, 'showIcon')}
          />
        </label>
      )}
    </div>
  );
}
