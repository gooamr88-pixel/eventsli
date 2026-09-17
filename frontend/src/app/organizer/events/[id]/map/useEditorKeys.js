'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WORLD } from '../../../../components/seating/seatingGeometry';
import { SNAP_WORLD } from './useCanvasInteraction';
import { keyOf } from './useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The editor's keyboard.
 *
 * Two jobs that have to agree with each other, which is why they are one hook:
 * the WINDOW shortcuts (tools, delete, duplicate, undo, arrows) and the
 * per-element handler the canvas hands to each table and zone. Split across two
 * files they drift — the classic result being arrows that nudge when the canvas
 * has focus and pan when an element does, which is exactly backwards.
 *
 *
 * NOTHING FIRES WHILE SOMEBODY IS TYPING.
 *
 * This handler claims two bare letters, V and H, plus Delete and the arrows.
 * Every one of those is a legitimate keystroke in the inspector's name field
 * two hundred pixels away, so an active INPUT, TEXTAREA, SELECT or
 * contenteditable takes precedence over all of it. SELECT is in that list and
 * is easy to leave out: the category and price-band dropdowns are select
 * elements, and arrow keys are how you operate one.
 *
 *
 * ARROWS DO TWO DIFFERENT THINGS, AND THAT IS DELIBERATE.
 *
 * With a selection they NUDGE it — a precision act on known elements, one
 * percent at a time. With nothing selected they PAN, by a large screen-space
 * step, because then they are the keyboard's only way to travel the room.
 * Screen space rather than world space: a fixed world step crawls when zoomed
 * out and flies when zoomed in.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Nudge distance in percentage points of the world, and its Shift version. */
const NUDGE = 1;
const NUDGE_FAST = 5;

/** Arrow-pan distance in screen pixels, and its Shift version. */
const PAN_STEP = 70;
const PAN_STEP_FAST = 280;

const ARROWS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export function useEditorKeys({
  draft, selection, snapToGrid, setTool, panByScreen, onDuplicate, onRemove,
}) {
  /**
   * Whether the space bar is down, and the fact of it.
   *
   * Both, because they are read by different things at different times: the ref
   * gates the gesture from inside a pointer handler bound once, and the state
   * drives the cursor and the toolbar hint. A ref cannot re-render anything and
   * a state value read inside that handler would be whatever it was when the
   * handler was created.
   */
  const spacePanRef = useRef(false);
  const [spacePan, setSpacePan] = useState(false);

  /**
   * Everything the window handler needs, kept current without re-binding it.
   *
   * Synced in an effect rather than in the render body: React's compiler
   * refuses a ref write during render, because a render has to be pure for it
   * to be safe to re-run. An effect runs after the commit and long before any
   * keystroke can arrive, so the handler never reads a stale value.
   */
  const latest = useRef({});
  useEffect(() => {
    latest.current = { draft, selection, snapToGrid, setTool, panByScreen, onDuplicate, onRemove };
  });

  /**
   * Moves the current selection by whole steps.
   *
   * Reads the CURRENT positions, so a run of arrow presses accumulates
   * correctly — and writes them all in one call with a shared `mergeKey`, so
   * holding an arrow down is one undo step rather than one per repeat.
   */
  const nudge = useCallback((dxUnits, dyUnits, fast) => {
    const { draft: d, selection: sel, snapToGrid: snap } = latest.current;
    const sl = sel.ref.current;
    if (sl.tables.size + sl.zones.size === 0) return false;

    // With Snap on, an arrow steps one grid cell — so the keyboard lands on the
    // same lattice the drag does, instead of walking off it one percent at a
    // time and looking misaligned next to everything that was snapped.
    const stepX = snap ? (SNAP_WORLD / WORLD.width) * 100 : (fast ? NUDGE_FAST : NUDGE);
    const stepY = snap ? (SNAP_WORLD / WORLD.height) * 100 : (fast ? NUDGE_FAST : NUDGE);
    const dx = dxUnits * stepX;
    const dy = dyUnits * stepY;

    const entries = [
      ...d.tables.filter((t) => sl.tables.has(keyOf(t))).map((t) => ({
        kind: 'table', id: keyOf(t), x: (t.position?.x || 0) + dx, y: (t.position?.y || 0) + dy,
      })),
      ...d.zones.filter((z) => sl.zones.has(z.id)).map((z) => ({
        kind: 'zone', id: z.id, x: z.x + dx, y: z.y + dy,
      })),
    ];

    d.setPositions(entries, { mergeKey: 'nudge' });
    return true;
  }, []);

  /* ── the window shortcuts ───────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      const { selection: sel, setTool: tool, panByScreen: pan, onDuplicate: dup, onRemove: rm, draft: d } = latest.current;

      // Space: hold to pan. Guarded on repeat, because a held key fires
      // continuously and the `preventDefault` is what stops the page scrolling
      // underneath the map for as long as it is down.
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spacePanRef.current) { spacePanRef.current = true; setSpacePan(true); }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) d.redo(); else d.undo();
        return;
      }
      // Ctrl+Y as well as Ctrl+Shift+Z: the two conventions, and an organizer
      // has no reason to know which one this editor picked.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        d.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        dup();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        sel.replace(d.tables.map(keyOf), d.zones.map((z) => z.id));
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (sel.ref.current.tables.size + sel.ref.current.zones.size > 0) {
          e.preventDefault();
          sel.clear();
        }
        return;
      }

      // The tool letters, after every modifier combination above has had its
      // turn — so they can never fire as part of Ctrl+V.
      if (typeof e.key === 'string') {
        const k = e.key.toLowerCase();
        if (k === 'v') { e.preventDefault(); tool('select'); return; }
        if (k === 'h') { e.preventDefault(); tool('hand'); return; }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.ref.current.tables.size + sel.ref.current.zones.size > 0) {
          e.preventDefault();
          rm();
        }
        return;
      }

      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        if (nudge(arrow[0], arrow[1], e.shiftKey)) return;
        const step = e.shiftKey ? PAN_STEP_FAST : PAN_STEP;
        pan(-arrow[0] * step, -arrow[1] * step);
      }
    };

    const onKeyUp = (e) => {
      if (e.code === 'Space') { spacePanRef.current = false; setSpacePan(false); }
    };
    // A window that loses focus mid-pan never sees the keyup, and the map is
    // then stuck in pan mode with nothing on screen explaining why.
    const onBlur = () => { spacePanRef.current = false; setSpacePan(false); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [nudge]);

  /* ── the handler each table and zone gets ───────────────────────────────── */

  /**
   * A focused element's own keys.
   *
   * Enter or Space selects it, which is the keyboard equivalent of the click
   * that opens the inspector. Arrows are handled by the window listener above —
   * NOT duplicated here — because by the time an element has focus it is also
   * selected, so the window handler's nudge branch is already the right
   * behaviour. Handling them in both places moved everything twice.
   */
  const onElementKeyDown = useCallback((e, kind, id) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    const { selection: sel } = latest.current;
    if (e.ctrlKey || e.metaKey || e.shiftKey) sel.toggle(kind, id);
    else sel.selectOnly(kind, id);
  }, []);

  return { spacePan, spacePanRef, onElementKeyDown };
}

/** True where a keystroke belongs to a form control rather than to the map. */
function isTyping(node) {
  if (!node || !node.tagName) return false;
  return node.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
}
