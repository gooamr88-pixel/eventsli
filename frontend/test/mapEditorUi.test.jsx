import { describe, test, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditorCanvas, { EDITOR_BOUNDS } from '../src/app/organizer/events/[id]/map/EditorCanvas';
import EditorToolbar from '../src/app/organizer/events/[id]/map/EditorToolbar';
import { useMapDraft } from '../src/app/organizer/events/[id]/map/useMapDraft';
import { useSelection } from '../src/app/organizer/events/[id]/map/useSelection';
import { useCanvasInteraction } from '../src/app/organizer/events/[id]/map/useCanvasInteraction';
import { useEditorKeys } from '../src/app/organizer/events/[id]/map/useEditorKeys';
import { usePanZoom } from '../src/app/components/seating/usePanZoom';
import { makeZone } from '../src/app/components/seating/layoutZones';
import { WORLD } from '../src/app/components/seating/seatingGeometry';
import { useEffect, useRef, useState } from 'react';

/**
 * The editor, wired the way `MapEditor` wires it.
 *
 * A harness rather than `MapEditor` itself, because that component's first act
 * is four network calls — and mocking them would test the mock. Everything
 * below the fetch is real: the same draft, the same selection, the same
 * gesture machine and the same keyboard, connected in the same order.
 *
 * WHICH IS THE POINT. Each of these hooks passes its own unit tests in
 * isolation; what this file catches is the wiring between them — a selection
 * the toolbar writes and the canvas does not read, a keyboard shortcut that
 * acts on a stale selection, a zone that has no way to be clicked.
 */

// jsdom gives every element a zero-sized box, and a zero-sized viewport is the
// one case the pan clamp deliberately refuses to work with. The gestures need a
// real rectangle to convert screen pixels through.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON() { return this; },
    };
  };
});

function Harness({ initialTables = [], initialZones = [] }) {
  const draft = useMapDraft();
  const selection = useSelection();
  const panzoom = usePanZoom(EDITOR_BOUNDS, { wheelMode: 'pan' });
  const [tool, setTool] = useState('select');
  const [snapToGrid, setSnapToGrid] = useState(false);
  const toolRef = useRef('select');
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    draft.reset(initialTables, initialZones);
  }, [draft, initialTables, initialZones]);

  const setToolBoth = (next) => { toolRef.current = next; setTool(next); };

  const { spacePan, spacePanRef, onElementKeyDown } = useEditorKeys({
    draft,
    selection,
    snapToGrid,
    setTool: setToolBoth,
    panByScreen: panzoom.panByScreen,
    onDuplicate: () => {
      const next = draft.duplicateSelection(selection.selection);
      if (next) selection.replace(next.tables, next.zones);
    },
    onRemove: () => { draft.removeSelection(selection.selection); selection.clear(); },
  });

  const interaction = useCanvasInteraction({
    svgRef: panzoom.svgRef,
    view: panzoom.view,
    panByScreen: panzoom.panByScreen,
    draft,
    selection,
    snapToGrid,
    toolRef,
    spacePanRef,
  });

  return (
    <div>
      <EditorToolbar
        tables={draft.tables} zones={draft.zones} selection={selection}
        tool={tool} onToolChange={setToolBoth}
        snapToGrid={snapToGrid} onSnapChange={setSnapToGrid}
        canUndo={draft.canUndo} canRedo={draft.canRedo}
        onUndo={draft.undo} onRedo={draft.redo} onAdd={() => {}}
        zoom={{ scale: WORLD.width / panzoom.view.width, in: panzoom.zoomIn, out: panzoom.zoomOut, fit: panzoom.fit }}
      />
      <EditorCanvas
        className="h-96"
        tables={draft.tables} zones={draft.zones} categories={[]} soldByTable={new Map()}
        selection={selection} panzoom={panzoom} interaction={interaction}
        tool={tool} spacePan={spacePan} snapToGrid={snapToGrid}
        onAddAt={(position) => draft.addTables([{ position }])}
        onNudge={onElementKeyDown}
      />
      <output data-testid="state">
        {`tables=${draft.tables.length} zones=${draft.zones.length} selected=${selection.count}`}
      </output>
    </div>
  );
}

const table = (id, x, y) => ({
  id, label: id.toUpperCase(), seatCount: 8, shape: 'round',
  position: { x, y, rotation: 0 },
});

const state = () => screen.getByTestId('state').textContent;

describe('the canvas draws both kinds of thing', () => {
  test('tables and zones both render, and both are reachable', () => {
    render(<Harness initialTables={[table('a', 30, 30)]} initialZones={[makeZone('stage', { x: 60, y: 20 })]} />);

    expect(screen.getByRole('button', { name: /^Table A, 8 seats/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Stage, Stage/ })).toBeInTheDocument();
  });

  test('zones are painted BEFORE tables, or a dance floor covers its own seats', () => {
    // SVG has no z-index. Paint order is the only thing deciding this, so it is
    // asserted on the document order rather than trusted to stay right.
    render(<Harness initialTables={[table('a', 30, 30)]} initialZones={[makeZone('dance_floor', { x: 60, y: 20 })]} />);

    const svg = screen.getByRole('application', { name: 'Seat map editor' });
    const nodes = [...svg.querySelectorAll('[data-zone-id], [data-table-key]')];
    expect(nodes[0].hasAttribute('data-zone-id')).toBe(true);
    expect(nodes[1].hasAttribute('data-table-key')).toBe(true);
  });

  test('the alignment grid appears only while Snap is on', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    const svg = screen.getByRole('application', { name: 'Seat map editor' });
    const grid = () => svg.querySelector('rect[fill="url(#es-map-grid)"]');

    expect(grid()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /snap to grid/i }));
    expect(grid()).not.toBeNull();
  });

  test('an empty map says what to do rather than showing blank floor', () => {
    render(<Harness />);
    expect(screen.getByText(/double-click the floor/i)).toBeInTheDocument();
  });
});

describe('selection reaches every surface that needs it', () => {
  test('clicking a table selects it, and the toolbar counts it', async () => {
    render(<Harness initialTables={[table('a', 30, 30), table('b', 60, 60)]} />);
    expect(state()).toContain('selected=0');

    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    expect(state()).toContain('selected=1');
    expect(screen.getByRole('button', { name: /1 selected/ })).toBeInTheDocument();
  });

  /**
   * `userEvent.setup()`, not the bare `userEvent.click`.
   *
   * The direct API starts a fresh session on every call, so a modifier held by
   * one call is forgotten by the next and the click arrives with `ctrlKey`
   * false — which reads here exactly like the feature being broken, because a
   * plain click is a valid gesture that replaces the selection. A session
   * carries the held key across calls.
   */
  test('Ctrl-click adds a second, and removes it again', async () => {
    const user = userEvent.setup();
    render(<Harness initialTables={[table('a', 30, 30), table('b', 60, 60)]} />);

    await user.click(screen.getByRole('button', { name: /^Table A/ }));
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('button', { name: /^Table B/ }));
    expect(state()).toContain('selected=2');

    // Toggling, not just adding — which is what makes a marquee correctable.
    await user.click(screen.getByRole('button', { name: /^Table B/ }));
    await user.keyboard('{/Control}');
    expect(state()).toContain('selected=1');
  });

  test('a zone and a table can be selected together', async () => {
    const user = userEvent.setup();
    render(<Harness initialTables={[table('a', 30, 30)]} initialZones={[makeZone('bar', { x: 70, y: 70 })]} />);

    await user.click(screen.getByRole('button', { name: /^Table A/ }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: /^Bar, Bar/ }));
    await user.keyboard('{/Shift}');
    expect(state()).toContain('selected=2');
  });

  test('Deselect clears it', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    await userEvent.click(screen.getByRole('button', { name: /Deselect/ }));
    expect(state()).toContain('selected=0');
  });
});

describe('Select all, narrowed', () => {
  test('"Everything" takes tables and zones alike', async () => {
    render(<Harness initialTables={[table('a', 30, 30), table('b', 60, 60)]} initialZones={[makeZone('bar', { x: 70, y: 70 })]} />);

    await userEvent.click(screen.getByRole('button', { name: /select all/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Everything/ }));
    expect(state()).toContain('selected=3');
  });

  test('narrowing by type takes only that type', async () => {
    render(<Harness initialTables={[table('a', 30, 30), table('b', 60, 60)]} initialZones={[makeZone('bar', { x: 70, y: 70 })]} />);

    await userEvent.click(screen.getByRole('button', { name: /select all/i }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'tables');
    await userEvent.click(screen.getByRole('button', { name: /select 2 elements/i }));
    expect(state()).toContain('selected=2');
  });

  test('a seat-capacity filter cannot sweep up the furniture', async () => {
    // Otherwise "select the 10-seaters" also grabs the bar, which has no seats
    // at all and is not what anybody meant.
    const tables = [table('a', 30, 30), { ...table('b', 60, 60), seatCount: 10 }];
    render(<Harness initialTables={tables} initialZones={[makeZone('bar', { x: 70, y: 70 })]} />);

    await userEvent.click(screen.getByRole('button', { name: /select all/i }));
    await userEvent.selectOptions(screen.getByLabelText(/seats per table/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /select 1 element/i }));
    expect(state()).toContain('selected=1');
  });

  test('the count is shown before the click, so an empty filter is visibly empty', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    await userEvent.click(screen.getByRole('button', { name: /select all/i }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'zones');

    const button = screen.getByRole('button', { name: /select 0 elements/i });
    expect(button).toBeDisabled();
  });
});

describe('the keyboard', () => {
  test('V and H switch tools', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    const move = screen.getByRole('button', { name: 'Move' });
    const select = screen.getByRole('button', { name: 'Select' });

    expect(select).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('h');
    expect(move).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('v');
    expect(select).toHaveAttribute('aria-pressed', 'true');
  });

  test('Delete removes the selection; Ctrl+Z brings it back', async () => {
    render(<Harness initialTables={[table('a', 30, 30), table('b', 60, 60)]} />);

    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    await userEvent.keyboard('{Delete}');
    expect(state()).toContain('tables=1');
    expect(state()).toContain('selected=0');

    await userEvent.keyboard('{Control>}z{/Control}');
    expect(state()).toContain('tables=2');
  });

  test('Ctrl+D duplicates and leaves the COPY selected', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);

    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    await userEvent.keyboard('{Control>}d{/Control}');
    expect(state()).toContain('tables=2');
    expect(state()).toContain('selected=1');

    // A second press works on the copy, so repeated duplication lays out a row.
    await userEvent.keyboard('{Control>}d{/Control}');
    expect(state()).toContain('tables=3');
  });

  test('Escape clears the selection', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    await userEvent.keyboard('{Escape}');
    expect(state()).toContain('selected=0');
  });

  test('Ctrl+A selects the whole room', async () => {
    render(<Harness initialTables={[table('a', 30, 30), table('b', 60, 60)]} initialZones={[makeZone('bar', { x: 70, y: 70 })]} />);
    await userEvent.keyboard('{Control>}a{/Control}');
    expect(state()).toContain('selected=3');
  });

  test('arrows nudge the selection rather than panning', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');

    const svg = screen.getByRole('application', { name: 'Seat map editor' });
    const g = svg.querySelector('[data-table-key]');
    // 30% + 2 percentage points of a 1000-unit world = 320.
    expect(g.getAttribute('transform')).toContain('translate(320');
  });

  test('nothing fires while somebody is typing in a field', async () => {
    // This handler claims two bare letters, Delete and the arrows — every one
    // of them a legitimate keystroke in the inspector's name field.
    render(
      <>
        <input aria-label="name" />
        <Harness initialTables={[table('a', 30, 30)]} />
      </>,
    );

    await userEvent.click(screen.getByRole('button', { name: /^Table A/ }));
    await userEvent.click(screen.getByLabelText('name'));
    await userEvent.keyboard('hv{Delete}');

    expect(screen.getByLabelText('name')).toHaveValue('hv');
    expect(state()).toContain('tables=1');
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('zoom', () => {
  test('the readout tracks the actual viewport', async () => {
    render(<Harness initialTables={[table('a', 30, 30)]} />);
    const toolbar = screen.getByRole('button', { name: 'Zoom in' }).closest('div');

    expect(within(toolbar).getByText('100%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(within(toolbar).queryByText('100%')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /frame the whole room/i }));
    expect(within(toolbar).getByText('100%')).toBeInTheDocument();
  });
});
