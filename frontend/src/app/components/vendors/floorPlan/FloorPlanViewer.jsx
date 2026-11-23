'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePanZoom } from '../../seating/usePanZoom';
import MapGestureHint from '../../seating/MapGestureHint';
import NavIcon from '../../shell/NavIcon';
import { formatMoney } from '../../../utils/money';
import { Booth, Decor, FloorPlanDefs, paintOrder } from './FloorPlanShapes';
import { INK, typeColor } from './floorPlanModel';
import VenueUnderlay, { venueWorld } from './VenueUnderlay';
import { alignPlan } from '../../seating/boothZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The vendor floor plan, to look at (2026-11-20): the public "who is where",
 * the vendor's own booking ("your booth" outlined), and the organizer's booth
 * picker when sending an offer (`pickable`).
 *
 * THE MAP STAYS STILL (owner, 2026-11-19): a bare wheel and a one-finger
 * swipe scroll the page; Ctrl/⌘ + wheel, a pinch, or two fingers move it —
 * the shared `usePanZoom` in cooperative mode, exactly as the seat map.
 *
 * Tapping a booth shows what it is under the map: its code, type, size and
 * price, and — where the audience may see it — the vendor in it.
 *
 * ON THE SEAT MAP (2026-11-22): a reserved-seating event's booths are drawn
 * on its venue map, and `floorPlan.venue` carries that map — the room, its
 * zones and its tables are drawn first (VenueUnderlay), then the booths.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function FloorPlanViewer({
  floorPlan, currency = 'USD', pickable = false, canPick = null, onPick = null, pickedKey = null, title = 'Floor plan',
  // The public vendor page (2026-11-23): tapping a free booth offers to book
  // it. `book` = { href: '/e/<slug>/vendors/booths', label, types: [ids
  // open for booking] } — plain data, since the page is a server component.
  book = null,
}) {
  const { plan: rawPlan, booths: states = {}, boothTypes = [], venue = null } = floorPlan;
  // Booths on the seat map are scaled to the venue as it is now (boothZones.alignPlan).
  const plan = useMemo(() => (venue ? alignPlan(rawPlan, venueWorld(venue)) : rawPlan), [rawPlan, venue]);
  const bounds = useMemo(() => ({ x: 0, y: 0, width: plan.width, height: plan.height }), [plan.width, plan.height]);
  const { svgRef, view, fit, zoomIn, zoomOut, wasDragged, handlers, hint, touchAction } = usePanZoom(bounds);
  const [focus, setFocus] = useState(null);
  const ordered = useMemo(() => paintOrder(plan.elements), [plan.elements]);
  const byId = useMemo(() => new Map(plan.elements.map((e) => [e.id, e])), [plan.elements]);

  const counts = useMemo(() => {
    const c = { available: 0, sold: 0, held: 0, blocked: 0 };
    for (const s of Object.values(states)) c[s.status] = (c[s.status] || 0) + 1;
    return c;
  }, [states]);

  const allowed = (e) => (canPick ? canPick(e, states[e.id]) : (states[e.id]?.status || 'available') === 'available');

  function tap(e) {
    if (wasDragged()) return;
    setFocus(e.id);
    if (pickable && onPick && allowed(e)) onPick(e);
  }

  const focused = focus ? byId.get(focus) : null;
  const focusedState = focused ? states[focused.id] : null;
  const focusedType = focused ? boothTypes.find((t) => t.id === focused.boothTypeId) : null;
  const usedTypes = boothTypes.filter((t) => plan.elements.some((e) => e.kind === 'booth' && e.boothTypeId === t.id));

  return (
    <div className="es-fp">
      <div className="es-fp__frame" style={{ aspectRatio: `${plan.width} / ${plan.height}` }}>
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          className="es-fp__svg"
          style={{ touchAction }}
          role="group"
          aria-label={title}
          {...handlers}
        >
          <FloorPlanDefs />
          {venue ? <VenueUnderlay venue={venue} /> : <rect x={0} y={0} width={plan.width} height={plan.height} fill="#ffffff" />}
          {ordered.map((e) => (e.kind === 'booth' ? (
            <Booth key={e.id} e={e} state={states[e.id]} boothTypes={boothTypes}
              interactive highlight={pickedKey === e.id} selected={focus === e.id && pickedKey !== e.id}
              onClick={() => tap(e)} />
          ) : <Decor key={e.id} e={e} />))}
        </svg>
        <MapGestureHint hint={hint} />
        <div className="es-fp__zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={zoomIn} aria-label="Zoom in"><NavIcon name="plus" size={18} /></button>
          <button type="button" onClick={zoomOut} aria-label="Zoom out"><span aria-hidden="true">−</span></button>
          <button type="button" onClick={fit} aria-label="Show the whole floor plan"><NavIcon name="grid" size={16} /></button>
        </div>
      </div>

      <ul className="es-fp__legend" aria-label="Key">
        {usedTypes.map((t, i) => (
          <li key={t.id}>
            <span className="es-fp__swatch" style={{ background: typeColor(boothTypes, t.id) || INK.boothFree }} data-i={i} />
            {t.name}{t.priceCents !== undefined ? ` · ${t.priceCents ? formatMoney(t.priceCents, currency) : 'Free'}` : ''}
          </li>
        ))}
        {usedTypes.length === 0 && counts.available > 0 && <li><span className="es-fp__swatch" style={{ background: INK.boothFree }} />Available</li>}
        {counts.held > 0 && <li><span className="es-fp__swatch es-fp__swatch--held" />Reserved</li>}
        <li><span className="es-fp__swatch es-fp__swatch--sold"><span /></span>Sold</li>
        {counts.blocked > 0 && <li><span className="es-fp__swatch es-fp__swatch--blocked"><span /></span>Unavailable</li>}
      </ul>

      {focused && (
        <div className="es-fp__info" role="status" aria-live="polite">
          <p className="es-fp__info-title">
            {focused.code ? `Booth ${focused.code}` : 'Booth'}
            {focusedState?.mine && <span className="es-pill es-pill--accent">Your booth</span>}
          </p>
          <p className="text-sm text-muted">
            {[focusedType?.name, focusedType?.sizeLabel, focusedType && focusedType.priceCents !== undefined ? (focusedType.priceCents ? formatMoney(focusedType.priceCents, currency) : 'Free') : null].filter(Boolean).join(' · ') || 'No booth type'}
          </p>
          <p className="text-sm">
            {focusedState?.vendor ? <><b>{focusedState.vendor.name}</b>{focusedState.vendor.category ? ` · ${focusedState.vendor.category}` : ''}</>
              : focusedState?.status === 'sold' ? 'Sold'
                : focusedState?.status === 'held' ? 'Reserved'
                  : focusedState?.status === 'blocked' ? 'Unavailable' : 'Available'}
          </p>
          {pickable && !allowed(focused) && <p className="text-xs text-danger">This booth cannot be chosen.</p>}
          {book && (focusedState?.status || 'available') === 'available' && (
            focusedType && book.types.includes(focusedType.id) ? (
              <Link
                href={`${book.href}/${focusedType.id}?spot=${encodeURIComponent(focused.id)}`}
                className="es-btn es-btn--primary es-btn--sm es-fp__book"
              >
                {book.label}
              </Link>
            ) : (
              // A booth with no type has no price, so it cannot be sold yet.
              <p className="text-xs text-muted">Not open for booking yet — ask the organizer about this spot.</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
