import { readStudio, liveSections, tierPalette } from '../../components/venue/venueModel';

/**
 * The seat map → the legend and the blocks.
 * Exported for its test: which block is "sold out" and which "not available"
 * is a promise to a buyer, and easy to get backwards.
 */
export function buildModel({ map, tiers = [], tables = [], seats = [] }) {
  if (!map) return null;
  const palette = tierPalette(tiers, seats);
  const studio = readStudio(map.layout);

  // The legend: every ticket type a seat on this map belongs to, cheapest first.
  const tierPrice = new Map();
  for (const s of seats) {
    if (!s.tierId) continue;
    const p = Number(s.priceCents);
    if (Number.isFinite(p)) tierPrice.set(s.tierId, Math.min(tierPrice.get(s.tierId) ?? Infinity, p));
  }
  const legend = [...tierPrice.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id, cents]) => ({ key: id, color: palette.get(id) || 'var(--es-grey-400)', cents }));

  // The blocks: Venue Studio sections, else the tables.
  const tableByLabel = new Map(tables.map((t) => [t.label, t]));
  const seatsByTable = new Map();
  for (const s of seats) {
    if (!s.tableId) continue;
    if (!seatsByTable.has(s.tableId)) seatsByTable.set(s.tableId, []);
    seatsByTable.get(s.tableId).push(s);
  }
  const sections = liveSections(studio.sections, tables);
  const groups = sections.length > 0
    ? sections.map((sec) => ({
      key: sec.id,
      name: sec.name,
      seats: sec.rows.flatMap((r) => seatsByTable.get(tableByLabel.get(r.table)?.id) || []),
    }))
    : tables.map((t) => ({ key: t.id, name: `Table ${t.label}`, seats: seatsByTable.get(t.id) || [] }));

  const blocks = groups.map((g) => {
    const open = g.seats.filter((s) => s.available);
    const prices = new Map();
    for (const s of open) {
      const key = s.tierId || `p${s.priceCents}`;
      const cents = Number(s.priceCents);
      if (!Number.isFinite(cents)) continue;
      prices.set(key, { key, cents: Math.min(prices.get(key)?.cents ?? Infinity, cents), color: palette.get(s.tierId) || 'var(--es-grey-400)' });
    }
    return {
      key: g.key,
      name: g.name,
      prices: [...prices.values()].sort((a, b) => a.cents - b.cents),
      // "Sold out" when seats exist and are taken; "Not available" when there
      // is nothing to sell at all (no seats, no price, off sale).
      soldOut: open.length === 0 && g.seats.some((s) => s.reason === 'taken'),
    };
  });

  // Sections in their natural order (Block 101, 102, … 110).
  blocks.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  return { legend, blocks, picture: studio.venue.photo?.url || null };
}
