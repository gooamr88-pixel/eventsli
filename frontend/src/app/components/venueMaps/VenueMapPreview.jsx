'use client';

import { useMemo } from 'react';
import SeatMapCanvas from '../seating/SeatMapCanvas';
import { worldOf, worldMetres } from '../seating/seatingGeometry';
import { readZones } from '../seating/layoutZones';
import { readLook, withTableStyles } from '../seating/mapStyle';
import NavIcon from '../shell/NavIcon';
import { kindLabel, mapFacts, placeLine } from './venueMapData';

/**
 * A venue map in full (2026-11-24): drawn by the buyer's own seat map, so
 * what is seen here is what lands in the Venue Builder — with the venue, its
 * figures, the colour groups and where the layout came from.
 */
export default function VenueMapPreview({ template, children }) {
  const data = useMemo(() => template?.data || {}, [template]);
  const v = template?.venue || {};

  const map = useMemo(() => {
    const layout = data.layout || {};
    const color = new Map((data.groups || []).map((g) => [g.key, g.color]));
    const tables = withTableStyles((data.tables || []).map((t, i) => ({
      ...t, id: `vm-${i}`, canBookWhole: false,
    })), layout);
    const seats = tables.flatMap((t) => Array.from({ length: Number(t.seatCount) || 0 }, (_, n) => ({
      id: `${t.id}-${n}`, tableId: t.id, number: String(n + 1), available: true, group: t.groupKey || null,
    })));
    const world = worldOf(layout);
    return {
      tables, seats, world, zones: readZones(layout), look: readLook(layout),
      seatFill: (s) => (s.group ? color.get(s.group) || null : null),
    };
  }, [data]);

  const size = worldMetres(map.world);
  const facts = [
    ['Venue', [v.name, v.address].filter(Boolean).join(' — ')],
    ['Where', placeLine(v) || '—'],
    ['Kind', kindLabel(v.kind)],
    ['Capacity', mapFacts(template?.summary).slice(0, 2).join(' · ') || '—'],
    ['Floor', `${size.width} × ${size.depth} m`],
  ];

  return (
    <div className="fx-stack gap-4">
      <dl className="es-tplfacts">
        {facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd className="fx-break">{val}</dd></div>)}
      </dl>

      <SeatMapCanvas
        className="h-[24rem]"
        tables={map.tables} seats={map.seats} zones={map.zones} world={map.world} look={map.look}
        seatFill={map.seatFill} showcase purchaseMode="seat_only" onSelectSeat={() => {}}
      />

      {(data.groups || []).length > 0 && (
        <section className="fx-stack fx-stack--sm gap-2" aria-label="Seat groups">
          <h3 className="text-sm font-semibold text-ink">Seat groups</h3>
          <ul className="es-vmgroups">
            {data.groups.map((g) => (
              <li key={g.key}><span className="es-tpllist__dot" style={{ background: g.color || 'var(--es-brand-coral)' }} aria-hidden="true" />{g.name}</li>
            ))}
          </ul>
          <p className="text-xs text-subtle">Each group joins your table category of the same name, if you have one.</p>
        </section>
      )}

      <p className="es-vmnote">
        <NavIcon name="info" size={15} />
        <span>The map only: tables arrive without prices or ticket types, so you set those for your own event. Change anything after it lands — nothing is saved until Save map.</span>
      </p>
      {template?.sourceNote && <p className="text-xs text-subtle">Source: {template.sourceNote}</p>}
      {children}
    </div>
  );
}
