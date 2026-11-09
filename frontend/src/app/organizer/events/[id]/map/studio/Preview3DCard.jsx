'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import VenueScene3D from '../../../../../components/venue/VenueScene3D';
import { buildSceneModel } from '../../../../../components/venue/sceneModel';
import { tierPalette } from '../../../../../components/venue/venueModel';
import { keyOf } from '../useMapDraft';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The room in 3D, small, beside the 2D editor: every row drawn shows up in the
 * stands a moment later.
 *
 * DEBOUNCED. A drag moves a table on every pointer frame, and rebuilding a
 * WebGL room sixty times a second while the organizer is still dragging is
 * wasted work that also makes the drag stutter. The preview takes the layout
 * once it has been still for 450 ms.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Preview3DCard({ tables, zones, world, scene, tiers, onOpen }) {
  const [snapshot, setSnapshot] = useState({ tables, zones });
  useEffect(() => {
    const t = setTimeout(() => setSnapshot({ tables, zones }), 450);
    return () => clearTimeout(t);
  }, [tables, zones]);

  const plain = useMemo(() => snapshot.tables.map((t) => ({
    id: keyOf(t), label: t.label, shape: t.shape, seatCount: t.seatCount, position: t.position, tierId: t.tierId,
  })), [snapshot.tables]);
  const model = useMemo(
    () => buildSceneModel({ tables: plain, zones: snapshot.zones, scene, world }),
    [plain, snapshot.zones, scene, world],
  );
  const palette = useMemo(() => tierPalette(tiers, []), [tiers]);
  const tierOf = useMemo(() => new Map(plain.map((t) => [t.id, t.tierId])), [plain]);
  const colorFor = useCallback((entry) => palette.get(tierOf.get(entry.tableId)) || '#8fa3a8', [palette, tierOf]);

  if (tables.length === 0 && zones.length === 0) return null;
  return (
    <section className="es-dcard es-preview3d" aria-labelledby="preview3d-title">
      <div className="fx-row fx-row--between">
        <h2 id="preview3d-title" className="es-dcard__title">Preview (3D)</h2>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onOpen}>Open 3D</button>
      </div>
      <div className="es-preview3d__view">
        <VenueScene3D
          className="h-full w-full" model={model} scene={scene} buildKey={model} colorKey={colorFor}
          colorFor={colorFor} ariaLabel="A small 3D preview of the room"
        />
      </div>
    </section>
  );
}
