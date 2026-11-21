'use client';

import NavIcon from '../../../../../components/shell/NavIcon';
import { Inspector, InspectorAction, InspectorNote } from '../../../../../components/inspector/Inspector';
import { RangeField, Toggle } from '../../../../../components/inspector/fields';

/**
 * The inspector while Draw walls is on: how to draw (as keys, not a paragraph),
 * the wall's thickness, the 45° snap, and Finish / Cancel for anyone who
 * cannot double-click.
 */
const KEYS = [
  ['Click', 'add a corner'],
  ['Double-click or Enter', 'finish'],
  ['Backspace', 'take back a corner'],
  ['Esc', 'stop drawing'],
  ['Alt', 'draw at any angle'],
];

export default function WallToolPanel({ tool }) {
  const { options, setOptions, points, finish, cancel } = tool;
  return (
    <Inspector
      label="Tool"
      icon={<NavIcon name="pencil" size={22} />}
      title="Draw walls"
      meta={points.length ? `${points.length} corner${points.length === 1 ? '' : 's'} placed` : 'Click the room’s first corner on the map'}
      actions={(
        <>
          <InspectorAction icon="tick" primary onClick={finish} disabled={points.length < 2}>Finish walls</InspectorAction>
          <InspectorAction icon="close" onClick={cancel}>Cancel</InspectorAction>
        </>
      )}
    >
      <dl className="es-keys">
        {KEYS.map(([k, v]) => (
          <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
        ))}
      </dl>
      <RangeField
        label="Thickness" min={2} max={20} step={1} value={options.thickness}
        onChange={(thickness) => setOptions((o) => ({ ...o, thickness }))}
      />
      <Toggle
        label="Snap corners to 45°"
        checked={options.snap45}
        onChange={(snap45) => setOptions((o) => ({ ...o, snap45 }))}
      />
      <InspectorNote>Leave a gap where a door goes, or add a Door over the wall afterwards. A click near a wall’s end joins it.</InspectorNote>
    </Inspector>
  );
}
