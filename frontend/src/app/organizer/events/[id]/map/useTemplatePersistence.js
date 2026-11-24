'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { get, put } from '../../../../utils/apiClient';
import { worldOf } from '../../../../components/seating/seatingGeometry';
import { readZones, writeZones } from '../../../../components/seating/layoutZones';
import {
  readLook, readTableStyles, writeLook, writeTableStyles,
} from '../../../../components/seating/mapStyle';
import { frameFor } from './mapApi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VENUE BUILDER ON A LIBRARY MAP (owner, 2026-11-24: "add ability to edit
 * the Eventsli library … the map"). The same editor organizers draw events
 * in — tables, rows, sections, walls, areas, colours, 3D — loading an
 * Eventsli venue map (`GET /admin/venue-maps/:id`) and saving it back into the
 * library (`PUT /admin/venue-maps/:id/map`, venueMapTemplateService.replaceMap),
 * never into an event.
 *
 * The same shape `useMapPersistence` returns, so MapEditor needs no second
 * code path. A library map is the ROOM only (the owner's rule): no ticket
 * types, prices, passwords or sales — so there are none to load, and the
 * map's colour GROUPS ("VIP", "Floor") stand in for the table categories.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useTemplatePersistence({ templateId, draft, studioDraft, onFrame }) {
  const { reset } = draft;
  const { load: loadStudio } = studioDraft;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [layout, setLayout] = useState({});
  const [groups, setGroups] = useState([]);
  const [title, setTitle] = useState('');
  // Called on load only; held in a ref so a caller's new function each render
  // never re-runs the load (which would wipe the draft).
  const frameRef = useRef(onFrame);
  useEffect(() => { frameRef.current = onFrame; });

  const apply = useCallback((template) => {
    const data = template?.data || {};
    const lay = data.layout || {};
    const styles = readTableStyles(lay);
    const tables = (data.tables || []).map((t, i) => ({
      // No database rows behind a library map: every table is keyed locally.
      localKey: `tpl-${i}-${String(t.label).toLowerCase()}`,
      label: t.label,
      seatCount: t.seatCount,
      shape: t.shape,
      position: t.position,
      categoryId: t.groupKey || null,
      tierId: null,
      priceCents: null,
      seatPriceCents: null,
      isPrivate: false,
      style: styles.get(String(t.label).trim().toLowerCase()) || null,
    }));
    const zones = readZones(lay);
    const world = worldOf(lay);
    reset(tables, zones, world, readLook(lay));
    loadStudio({ layout: lay, tables: [] });
    setLayout(lay);
    setGroups((data.groups || []).map((g) => ({ id: g.key, name: g.name, color: g.color })));
    setTitle(template?.name || template?.venue?.name || 'Venue map');
    return { tables, zones, world };
  }, [reset, loadStudio]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const template = await get(`/admin/venue-maps/${templateId}`, { cache: 'no-store', noRedirect: true });
        if (cancelled) return;
        const { tables, zones, world } = apply(template);
        frameRef.current?.(frameFor(tables, zones, world));
        setLoadError(null);
        setSaveError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, apply, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** The draft as library data, the way `cleanData` on the server reads it. */
  function toData() {
    const sent = draft.current();
    const sections = studioDraft.sectionsFor(sent.tables);
    const nextLayout = studioDraft.toLayout(
      writeLook(
        writeTableStyles(
          writeZones({ ...layout, world: { width: sent.world.width, height: sent.world.height } }, sent.zones),
          sent.tables,
        ),
        sent.look,
      ),
      sent.tables,
    );
    const used = new Set(sent.tables.map((t) => t.categoryId).filter(Boolean));
    return {
      layout: nextLayout,
      groups: groups.filter((g) => used.has(g.id)).map((g) => ({ key: g.id, name: g.name, color: g.color })),
      tables: sent.tables.map((t) => {
        const where = sections.get(String(t.label).trim()) || null;
        return {
          label: String(t.label).trim(),
          seatCount: Number(t.seatCount),
          shape: t.shape,
          position: { x: t.position?.x ?? 0, y: t.position?.y ?? 0, rotation: t.position?.rotation ?? 0 },
          ...(where ? { section: where.section, row: where.row } : {}),
          ...(t.categoryId ? { groupKey: t.categoryId } : {}),
        };
      }),
    };
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await put(`/admin/venue-maps/${templateId}/map`, { data: toData(), edited: true }, { noRedirect: true });
      // Re-read, so what is on screen is exactly what the library now holds.
      const template = await get(`/admin/venue-maps/${templateId}`, { cache: 'no-store', noRedirect: true });
      apply(template);
      return true;
    } catch (err) {
      setSaveError(err);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    loading, loadError, saveError, saving, saveNote: null,
    // A library map sells nothing: no ticket types, and its colour groups
    // are the categories the inspector offers.
    tiers: [], addTier: () => {}, categories: groups, layout,
    eventTitle: title,
    eventInfo: { currency: null, purchaseMode: 'seat_and_table', admissionType: 'reserved' },
    lookupFailed: [],
    reload, save,
    vendor: null, boothImport: null, importBooths: () => [], boothInfo: null,
  };
}
