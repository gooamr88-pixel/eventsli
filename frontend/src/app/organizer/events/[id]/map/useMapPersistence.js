'use client';

import { useCallback, useEffect, useState } from 'react';
import { get, put } from '../../../../utils/apiClient';
import { worldOf } from '../../../../components/seating/seatingGeometry';
import { readZones, writeZones } from '../../../../components/seating/layoutZones';
import {
  readLook, writeLook, withTableStyles, writeTableStyles,
} from '../../../../components/seating/mapStyle';
import { fromApi, toApi, frameFor } from './mapApi';
import {
  boothsToZones, planBooths, samePlan, zonesToPlan,
} from '../../../../components/seating/boothZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Loading and saving the map — split out of MapEditor.jsx (2026-11-10), which
 * had grown past the 500-line cap while owning the viewport, the gestures, the
 * panels AND the round trips. This is the round trips.
 *
 * ONE SAVE carries everything on the screen: tables, zones, the Studio's
 * settings, the sections' rows (as each table's section and row, S-19) and the
 * seats blocked or released in the Preview. `PUT /events/:id/venue-map` applies
 * all of it in one transaction or none of it.
 *
 * THE VERSION (TECH-AUDIT-LOG S-03). Every save says which version of the map
 * it was made from, and the server refuses one made from a stale copy — a save
 * is a full replace, so without it a second tab silently deleted the first
 * tab's work. `reload` is the way forward after that refusal.
 *
 * THE RE-READ keeps what was drawn while the request was in flight: the draft
 * is rebased onto the server's copy only where nothing changed meanwhile
 * (`useMapDraft.rebase`, `useStudioDraft.afterSave`).
 *
 * VENDOR BOOTHS (2026-11-22, boothZones.js). The event's vendor floor plan is
 * read beside the map, and a plan "on the seat map" joins the draft as booth
 * zones. Save sends the booths to `PUT /events/:id/vendors/floor-plan`
 * FIRST — it refuses to drop a booth a vendor holds, and that refusal must
 * stop the whole save — then the map, with the booths left out of
 * `layout_json`. Each store keeps its own version check, and the booths are
 * sent only when they changed. A separate plan with booths of its own is not
 * touched until the organizer chooses to bring it onto this map.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useMapPersistence({ eventId, draft, studioDraft, selection, onFrame }) {
  const { reset } = draft;
  const { load: loadStudio } = studioDraft;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  // After a save that could not apply every block or release: a buyer held or
  // bought some of those seats in the meantime, and they were left alone.
  const [saveNote, setSaveNote] = useState(null);
  const [mapVersion, setMapVersion] = useState(0);   // 0: there was no map yet
  const [reloadKey, setReloadKey] = useState(0);
  // Lists that failed to load. They used to become empty lists in silence, so
  // a failed ticket-type read looked exactly like an event with none (S-17).
  const [lookupFailed, setLookupFailed] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [layout, setLayout] = useState({});
  const [eventTitle, setEventTitle] = useState('');
  const [eventInfo, setEventInfo] = useState({ currency: null, purchaseMode: 'seat_only', admissionType: null });
  // The vendor floor plan: { version, plan, states, boothTypes, linked, savedPlan },
  // or null where it could not be read (then the map edits no booths).
  const [vendor, setVendor] = useState(null);
  // A separate floor plan whose booths are not on this map yet: { plan, count, extras }.
  const [boothImport, setBoothImport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const failed = [];
        const [map, tierList, categoryList, event, floorPlan] = await Promise.all([
          get(`/events/${eventId}/venue-map`, { cache: 'no-store' }),
          get(`/events/${eventId}/tiers`, { cache: 'no-store' }).catch(() => { failed.push('ticket types'); return []; }),
          get(`/events/${eventId}/table-categories`, { cache: 'no-store' }).catch(() => { failed.push('table categories'); return []; }),
          // Only the printed pack's letterhead and the currency need this, so a
          // failure here must not gate the editor.
          get(`/events/${eventId}`, { cache: 'no-store' }).catch(() => null),
          // Vendor booths are optional here: a failed read edits no booths.
          get(`/events/${eventId}/vendors/floor-plan`, { cache: 'no-store' }).catch(() => null),
        ]);
        if (cancelled) return;

        // Each table's colours and seats per side ride in the layout blob,
        // keyed by label (mapStyle.js).
        const loadedTables = withTableStyles((map?.tables || []).map(fromApi), map?.layout);
        const loadedZones = readZones(map?.layout);
        const loadedWorld = worldOf(map?.layout);
        const fp = floorPlan?.plan ? floorPlan : null;
        const linked = !!fp?.plan?.onSeatMap;
        const loadedBooths = linked ? boothsToZones(fp.plan, loadedWorld) : [];
        reset(loadedTables, [...loadedZones, ...loadedBooths], loadedWorld, readLook(map?.layout));
        setVendor(fp ? vendorState(fp, linked ? zonesToPlan(loadedBooths, loadedWorld) : null) : null);
        const separate = !linked && fp ? planBooths(fp.plan).length : 0;
        setBoothImport(separate ? { plan: fp.plan, count: separate, extras: fp.plan.elements.length - separate } : null);
        loadStudio(map);
        setEventInfo({
          currency: event?.currency || event?.event?.currency || null,
          purchaseMode: event?.purchaseMode || event?.event?.purchaseMode || 'seat_only',
          // General admission draws the room without seats (2026-11-23).
          admissionType: event?.admissionType || event?.event?.admissionType || null,
        });
        onFrame(frameFor(loadedTables, loadedZones, loadedWorld));
        setLayout(map?.layout || {});
        setTiers(Array.isArray(tierList) ? tierList : []);
        setCategories(Array.isArray(categoryList) ? categoryList : []);
        setEventTitle(event?.title || event?.event?.title || '');
        setMapVersion(Number(map?.version) || 0);
        setLookupFailed(failed);
        setSaveError(null);
        setSaveNote(null);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reset, loadStudio, onFrame, reloadKey]);

  /** Re-runs the load. Replaces the draft, so callers offer it only when that is the point. */
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /**
   * "Bring them onto this map": the separate floor plan's booths join the
   * draft as booth zones, scaled into this venue, as one undo step. Nothing is
   * saved until Save; its walls and labels stay behind (this map has its own).
   */
  const importBooths = useCallback(() => {
    if (!boothImport) return [];
    const current = draft.current();
    const have = new Set(current.zones.map((z) => z.id));
    const fresh = boothsToZones(boothImport.plan, current.world).filter((z) => !have.has(z.id));
    draft.apply((p) => ({ ...p, zones: [...p.zones, ...fresh] }));
    // The offer stays until a save links the plan: an undo brings it back.
    return fresh.map((z) => z.id);
  }, [boothImport, draft]);

  /** A ticket type made from inside the editor (NewTierInline) joins the lists at once. */
  const addTier = useCallback((tier) => setTiers((list) => [...list, tier]), []);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaveNote(null);
    // What this save sends. Compared after the re-read, so edits made while
    // the request was in flight survive it (see `rebase`).
    const sent = draft.current();
    const sentStudio = studioDraft.studio;
    const sentHolds = studioDraft.availability();
    const sections = studioDraft.sectionsFor(sent.tables);
    // The booths, as the vendor floor plan stores them — sent only when they
    // changed, and only once this map holds the event's booths.
    const sentPlan = vendor ? zonesToPlan(sent.zones, sent.world) : null;
    const sendBooths = !!vendor && (vendor.linked || sentPlan.elements.length > 0)
      && !samePlan(sentPlan, vendor.savedPlan);
    let savedVendor = vendor;
    try {
      if (sendBooths) {
        const fp = await put(`/events/${eventId}/vendors/floor-plan`, { plan: sentPlan, version: vendor.version }, { noRedirect: true });
        savedVendor = vendorState(fp, sentPlan);
        setVendor(savedVendor);
        setBoothImport(null);
      }
      const result = await put(`/events/${eventId}/venue-map`, {
        // The rest of the blob is round-tripped untouched: `writeZones` and
        // `writeStudio` each replace their own keys and preserve every other, so
        // an editor that predates a future key cannot destroy it on a
        // full-replace save. Sections are pruned to rows still on the map.
        layout: studioDraft.toLayout(
          writeLook(
            writeTableStyles(
              writeZones({ ...layout, world: { width: sent.world.width, height: sent.world.height } }, sent.zones),
              sent.tables,
            ),
            sent.look,
          ),
          sent.tables,
        ),
        tables: sent.tables.map((t) => toApi(t, sections)),
        expectedVersion: mapVersion,
        ...(sentHolds ? { availability: sentHolds } : {}),
      }, { noRedirect: true });

      const a = result?.availability;
      if (a && a.blocked + a.released < a.requested) {
        const missed = a.requested - a.blocked - a.released;
        setSaveNote(`${missed} of the seats you blocked or released ${missed === 1 ? 'was' : 'were'} held or bought by a buyer before the save, and ${missed === 1 ? 'was' : 'were'} left as ${missed === 1 ? 'it was' : 'they were'}.`);
      }

      // Re-read rather than trusting local state: the save assigns ids to new
      // tables and generates their seat rows, and neither exists here. What
      // `reset` loads counts as saved, so "unsaved changes" clears.
      const map = await get(`/events/${eventId}/venue-map`, { cache: 'no-store' });
      const untouched = draft.current() === sent;
      const savedWorld = worldOf(map?.layout);
      const savedBooths = savedVendor?.linked && savedVendor.plan ? boothsToZones(savedVendor.plan, savedWorld) : [];
      draft.rebase(
        withTableStyles((map?.tables || []).map(fromApi), map?.layout),
        [...readZones(map?.layout), ...savedBooths], sent, savedWorld, readLook(map?.layout),
      );
      setLayout(map?.layout || {});
      setMapVersion(Number(map?.version) || 0);
      studioDraft.afterSave(map, sentStudio, sentHolds);
      // Only when nothing moved meanwhile — clearing would drop whatever the
      // organizer selected to keep working on.
      if (untouched) selection.clear();
      return true;
    } catch (err) {
      setSaveError(err);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    loading, loadError, saveError, saving, saveNote,
    tiers, addTier, categories, layout, eventTitle, eventInfo, lookupFailed,
    reload, save,
    vendor, boothImport, importBooths,
    boothInfo: vendor ? { states: vendor.states, boothTypes: vendor.boothTypes } : null,
  };
}

/** The editor's copy of the vendor floor plan, from `GET` or `PUT …/vendors/floor-plan`. */
function vendorState(fp, savedPlan) {
  const plan = fp?.plan || { elements: [] };
  return {
    version: Number(fp?.version) || 0,
    plan,
    states: fp?.booths || {},
    boothTypes: Array.isArray(fp?.boothTypes) ? fp.boothTypes : [],
    linked: !!plan.onSeatMap,
    savedPlan: plan.onSeatMap ? savedPlan : null,
  };
}
