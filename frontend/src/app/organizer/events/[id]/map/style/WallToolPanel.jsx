'use client';

import { RangeField } from './StyleFields';

/**
 * The side panel while Draw wall is on: how to draw, the wall's thickness, the
 * 45° snap, and Finish / Cancel for anyone who cannot double-click.
 */
export default function WallToolPanel({ tool }) {
  const { options, setOptions, points, finish, cancel } = tool;
  return (
    <aside className="es-dcard fx-stack fx-stack--sm gap-3" aria-labelledby="wall-tool">
      <div>
        <h2 id="wall-tool" className="es-dcard__title">Draw walls</h2>
        <p className="es-ovcard__desc">
          Click each corner of the room. Double-click or press Enter to finish; Escape stops, Backspace takes back a corner.
          Leave a gap where a door goes, or add a Door over a wall afterwards.
        </p>
      </div>
      <RangeField
        label="Thickness" min={2} max={20} step={1} value={options.thickness}
        onChange={(thickness) => setOptions((o) => ({ ...o, thickness }))}
      />
      <label className="fx-row items-center justify-between gap-2 text-sm text-ink">
        Snap corners to 45°
        <input
          type="checkbox"
          checked={options.snap45}
          onChange={(e) => setOptions((o) => ({ ...o, snap45: e.target.checked }))}
        />
      </label>
      <p className="text-xs text-subtle">Hold Alt for a free angle. A click near a wall&apos;s end joins it.</p>
      <div className="fx-row flex-wrap gap-2 border-t border-border-base pt-3">
        <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={finish} disabled={points.length < 2}>
          Finish walls
        </button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={cancel}>
          Cancel
        </button>
      </div>
    </aside>
  );
}
