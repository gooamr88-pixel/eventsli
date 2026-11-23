'use client';

import { useMemo } from 'react';
import SeatMapCanvas from '../seating/SeatMapCanvas';
import { worldOf } from '../seating/seatingGeometry';
import { readZones } from '../seating/layoutZones';
import { readLook, withTableStyles } from '../seating/mapStyle';
import { tierPalette } from '../venue/venueModel';
import { formatMoney } from '../../utils/money';

/**
 * What a template sets up, in full (2026-11-19): the event's details, its
 * ticket types and add-ons, and its seating map drawn by the buyer's own map —
 * so "what you see here" is what the new event starts with.
 */
export default function TemplatePreview({ template }) {
  const data = useMemo(() => template?.data || {}, [template]);
  const event = data.event || {};
  const currency = data.currency || null;

  const map = useMemo(() => {
    if (!data.map || !(data.map.tables || []).length) return null;
    const layout = data.map.layout || {};
    const tables = withTableStyles(data.map.tables.map((t, i) => ({
      ...t, id: `tpl-${i}`, canBookWhole: false,
    })), layout);
    const seats = tables.flatMap((t) => Array.from({ length: Number(t.seatCount) || 0 }, (_, n) => ({
      id: `${t.id}-${n}`, tableId: t.id, number: String(n + 1), available: true, tierId: t.tierKey || null,
    })));
    const look = readLook(layout);
    const palette = tierPalette((data.tiers || []).map((x) => ({ id: x.key, priceCents: x.priceCents })), [], look);
    return {
      tables, seats, look, zones: readZones(layout), world: worldOf(layout),
      seatFill: (s) => palette.get(s.tierId) || null, palette,
    };
  }, [data]);

  const facts = [
    event.venueName && ['Venue', [event.venueName, event.city].filter(Boolean).join(', ')],
    event.startTime && ['Starts', `${event.startTime}, for ${Math.round((event.durationMinutes || 0) / 60 * 10) / 10} hours`],
    ['Admission', event.listingType === 'display_only' ? 'Display only' : event.admissionType === 'general' ? 'General admission' : 'Reserved seating'],
    event.maxTicketsPerOrder && ['Per order', `Up to ${event.maxTicketsPerOrder} tickets`],
  ].filter(Boolean);

  return (
    <div className="fx-stack gap-5">
      <dl className="es-tplfacts">
        {facts.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

      {map && (
        <section className="fx-stack fx-stack--sm gap-2" aria-label="Event map">
          <h3 className="text-sm font-semibold text-ink">Event map</h3>
          <SeatMapCanvas
            className="h-[22rem]"
            tables={map.tables} seats={map.seats} zones={map.zones} world={map.world} look={map.look}
            seatFill={map.seatFill} showcase purchaseMode="seat_only" onSelectSeat={() => {}}
          />
        </section>
      )}

      {(data.tiers || []).length > 0 && (
        <section className="fx-stack fx-stack--sm gap-2" aria-label="Ticket types">
          <h3 className="text-sm font-semibold text-ink">Ticket types</h3>
          <ul className="es-tpllist">
            {data.tiers.map((t) => (
              <li key={t.key}>
                <span className="fx-row items-center gap-2 fx-min0">
                  {map && <span className="es-tpllist__dot" style={{ background: map.palette.get(t.key) || '#ff414b' }} aria-hidden="true" />}
                  <span className="fx-truncate">{t.name}{t.isHidden ? ' (hidden)' : ''}</span>
                </span>
                <b className="es-nums">{currency ? (t.priceCents ? formatMoney(t.priceCents, currency) : 'Free') : ''}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.addons || []).length > 0 && (
        <section className="fx-stack fx-stack--sm gap-2" aria-label="Add-ons">
          <h3 className="text-sm font-semibold text-ink">Add-ons</h3>
          <ul className="es-tpllist">
            {data.addons.map((a, i) => (
              <li key={`${a.name}-${i}`}><span className="fx-truncate">{a.name}</span><b className="es-nums">{currency ? formatMoney(a.priceCents || 0, currency) : ''}</b></li>
            ))}
          </ul>
        </section>
      )}

      {event.description && (
        <section className="fx-stack fx-stack--sm gap-2" aria-label="Description">
          <h3 className="text-sm font-semibold text-ink">Description</h3>
          <p className="whitespace-pre-line text-sm text-muted">{event.description}</p>
        </section>
      )}

      <p className="text-xs text-subtle">
        A new event gets everything above as a draft. Dates, pictures, sales and private-table passwords are never copied.
      </p>
    </div>
  );
}
