'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import SeatMapCanvas from '../../components/seating/SeatMapCanvas';
import { readZones } from '../../components/seating/layoutZones';
import { readLook } from '../../components/seating/mapStyle';
import { worldOf } from '../../components/seating/seatingGeometry';
import { boothsToZones } from '../../components/seating/boothZones';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A GENERAL-ADMISSION EVENT'S MAP, on its page (2026-11-23, the event map).
 *
 * The room as the organizer drew it — stage, bars, entrances, areas, decor —
 * with the vendor booths in it, through the same canvas as the seat page and
 * the same steps (readZones, boothsToZones), so the room looks the same on
 * every screen. Nothing here is for sale: guests stand or sit where they like.
 *
 * Where vendors are being taken, a line under the map sends a would-be vendor
 * to the booking page — the map is where they see the spots.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventMapView({ map, slug, vendorsOpen = false }) {
  const world = useMemo(() => worldOf(map.layout), [map.layout]);
  const look = useMemo(() => readLook(map.layout), [map.layout]);
  const zones = useMemo(() => {
    const base = readZones(map.layout);
    const vb = map.vendorBooths;
    if (!vb?.plan) return base;
    return [...base, ...boothsToZones(vb.plan, world, {
      withState: { states: vb.booths || {}, boothTypes: vb.boothTypes || [] },
    })];
  }, [map, world]);
  const hasBooths = zones.some((z) => z.kind === 'booth');

  return (
    <section id="event-map" aria-labelledby="event-map-title" className="fx-stack fx-stack--sm">
      <div className="fx-row fx-row--between flex-wrap items-baseline gap-2">
        <h2 id="event-map-title" className="text-lg">Event map</h2>
        <p className="text-sm text-muted">General admission — stand or sit where you like.</p>
      </div>
      <SeatMapCanvas
        className="h-[22rem] md:h-[28rem]"
        tables={[]} seats={[]} zones={zones} world={world} look={look}
        showcase purchaseMode="seat_only" onSelectSeat={() => {}}
      />
      {hasBooths && vendorsOpen && (
        <Link href={`/e/${slug}/vendors#floor-plan`} className="fx-row items-center gap-1.5 text-sm text-accent">
          <NavIcon name="store" size={16} /> Are you a vendor? Choose a booth on the floor plan
        </Link>
      )}
    </section>
  );
}
