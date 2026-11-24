/**
 * The website's seating modules, with the types this app reads them by.
 *
 * They are plain JavaScript (frontend/src/app/components/seating, /venue),
 * imported through the `@shared` alias — never copied (see metro.config.js).
 * TypeScript would otherwise infer their parameters from defaults like
 * `style = null` and refuse a real style; these signatures say what the
 * functions actually accept and return.
 */
import * as boothZonesJs from '@shared/seating/boothZones';
import * as layoutZonesJs from '@shared/seating/layoutZones';
import * as mapStyleJs from '@shared/seating/mapStyle';
import * as geometryJs from '@shared/seating/seatingGeometry';
import * as venueZonesJs from '@shared/seating/venueZones';
import * as zoneIconsJs from '@shared/seating/zoneIcons';
import * as sectionPlatesJs from '@shared/venue/sectionPlates';
import * as venueModelJs from '@shared/venue/venueModel';

export type World = { width: number; height: number };
export type Box = { x: number; y: number; width: number; height: number };
type Layout = Record<string, unknown> | null | undefined;
type Style = Record<string, unknown> | null | undefined;
type Positioned = { position: { x: number; y: number; rotation?: number }; shape: string; seatCount: number; style?: Style };
type AnyZone = { kind: string } & Record<string, unknown>;
export type Look = { floor?: string; wall?: string; table?: string; label?: string; seat?: string; accent?: string; font?: string } | null;
export type Body = { kind: 'ellipse' | 'rect' | 'path' | 'none'; width: number; height: number; rx: number; d?: string; labelY?: number };
export type Paint = { fill: string | null; stroke: string | null; strokeWidth: number | null; label: string | null; seat: string | null };
type Section = { id: string; name: string; rows: { table: string; row: string }[] };

export const geometry = geometryJs as unknown as {
  SEAT_RADIUS: number;
  worldOf(layout: Layout): World;
  contentBounds(tables: Positioned[], zones: AnyZone[], world: World): Box;
  normaliseShape(shape: unknown): string;
  tableBody(shape: string, seatCount: number, style?: Style): Body;
  tableScale(style?: Style): number;
  tableLabelSize(shape: string, body: Body, style?: Style): number;
  seatPositions(shape: string, seatCount: number, style?: Style): { x: number; y: number; angle: number }[];
  toWorld(position: unknown, world: World): { x: number; y: number; rotation: number };
};

export const layoutZones = layoutZonesJs as unknown as { readZones(layout: Layout): AnyZone[] };

export const boothZones = boothZonesJs as unknown as {
  boothsToZones(plan: unknown, world: World, opts: { withState: { states: Record<string, unknown>; boothTypes: unknown[] } }): AnyZone[];
};

export const mapStyle = mapStyleJs as unknown as {
  readLook(layout: Layout): Look;
  withTableStyles<T>(tables: T[], layout: Layout): (T & { style?: Style })[];
  tablePaint(table: { style?: Style }, look: Look): Paint;
};

export const venueZones = venueZonesJs as unknown as {
  paintOrder<T extends AnyZone>(zones: T[]): T[];
  zoneBox(zone: AnyZone, world: World): { cx: number; cy: number; w: number; h: number; rotation: number };
  zoneColor(zone: AnyZone): string;
  zoneInk(color: string): string;
  zoneLabel(zone: AnyZone): string;
  zoneMeta(kind: string): { label: string; icon: string; color: string };
};

export const zoneIcons = zoneIconsJs as unknown as { ZONE_ICON_VIEWBOX: number; iconPaths(name: string): string[] };

export const sectionPlates = sectionPlatesJs as unknown as {
  sectionPlates(sections: Section[], tables: { id: string; label: string }[], colorOf: (tableId: string) => string, world: World): { key: string; name: string; d: string; color: string }[];
};

export const venueModel = venueModelJs as unknown as {
  readStudio(layout: Layout): { sections: Section[] };
  liveSections(sections: Section[], tables: { label: string }[]): Section[];
  sectionIndex(sections: Section[]): Map<string, { section: string; row: string }>;
  tierPalette(tiers: { id: string; priceCents: number }[], seats: { tierId: string | null; priceCents: number | null }[], look: Look): Map<string, string>;
};
