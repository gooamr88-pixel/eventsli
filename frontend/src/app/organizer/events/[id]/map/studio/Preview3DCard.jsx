'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import VenueScene3D from '../../../../../components/venue/VenueScene3D';
import { buildSceneModel } from '../../../../../components/venue/sceneModel';
import { tierPalette } from '../../../../../components/venue/venueModel';
import { keyOf } from '../useMapDraft';
import NavIcon from '../../../../../components/shell/NavIcon';

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
    id: keyOf(t), label: t.label, shape: t.shape, seatCount: t.seatCount, position: t.position, tierId: t.tierId, style: t.style,
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
    // The same head as the inspector above it (2026-11-21): a small label and
    // a quiet action, not a second large title competing with the panel's.
    <section className="es-dcard es-preview3d" aria-labelledby="preview3d-title">
      <div className="es-preview3d__head">
        <h2 id="preview3d-title" className="es-preview3d__title">3D preview</h2>
        <button type="button" className="es-textbtn" onClick={onOpen}>
          Open 3D <NavIcon name="arrow" size={15} />
        </button>
      </div>
      <div className="es-preview3d__view">
        <VenueScene3D
          className="h-full w-full" compact model={model} scene={scene} buildKey={model} colorKey={colorFor}
          colorFor={colorFor} ariaLabel="A small 3D preview of the room"
        />
      </div>
    </section>
  );
}
