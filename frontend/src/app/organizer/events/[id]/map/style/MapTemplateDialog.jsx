'use client';

import { useState } from 'react';
import { get } from '../../../../../utils/apiClient';
import { messageFor } from '../../../../../utils/errors';
import { useApi } from '../../../../../hooks/useApi';
import { worldOf } from '../../../../../components/seating/seatingGeometry';
import { readZones } from '../../../../../components/seating/layoutZones';
import { readLook, readTableStyles } from '../../../../../components/seating/mapStyle';
import { readStudio } from '../../../../../components/venue/venueModel';
import TemplateDialog from '../../../../../components/templates/TemplateDialog';
import TemplatePreview from '../../../../../components/templates/TemplatePreview';
import { templateFacts } from '../../../../../components/templates/TemplateCard';
import { Loading, Empty } from '../../../../../components/Feedback';

/**
 * A seating map from a template, inside the Venue Builder (2026-11-19).
 *
 * Only the map: tables, areas, walls, the venue's size and look. Each table
 * keeps its ticket type when this event has one of the same name (and its
 * table category likewise); the rest are left for the organizer to assign.
 * It lands in the unsaved draft — one Ctrl+Z puts the old map back, and
 * nothing is saved until Save map.
 */
export default function MapTemplateDialog({ tiers = [], categories = [], replacing, blocked = null, onApply, onClose }) {
  const { data, loading } = useApi('/organizer/templates');
  const [chosen, setChosen] = useState(null);
  const [error, setError] = useState(null);

  const all = [...(data?.mine || []), ...(data?.eventsli || [])].filter((t) => t.summary?.hasMap);

  async function open(t) {
    setError(null);
    setChosen({ card: t, full: null });
    try {
      setChosen({ card: t, full: await get(`/organizer/templates/${t.id}`, { cache: 'no-store', noRedirect: true }) });
    } catch (err) {
      setChosen(null);
      setError(messageFor(err));
    }
  }

  function use() {
    const d = chosen.full.data;
    const layout = d.map.layout || {};
    const tierByName = new Map(tiers.map((t) => [String(t.name).trim().toLowerCase(), t.id]));
    const catByName = new Map(categories.map((c) => [String(c.name).trim().toLowerCase(), c.id]));
    const tierName = new Map((d.tiers || []).map((t) => [t.key, String(t.name).trim().toLowerCase()]));
    const catName = new Map((d.categories || []).map((c) => [c.key, String(c.name).trim().toLowerCase()]));
    const styles = readTableStyles(layout);
    const tables = d.map.tables.map((t) => ({
      label: t.label,
      seatCount: t.seatCount,
      priceCents: t.priceCents ?? null,
      shape: t.shape,
      position: t.position,
      tierId: t.tierKey ? tierByName.get(tierName.get(t.tierKey)) || null : null,
      categoryId: t.categoryKey ? catByName.get(catName.get(t.categoryKey)) || null : null,
      seatPriceCents: t.seatPriceCents ?? null,
      style: styles.get(String(t.label).trim().toLowerCase()) || null,
    }));
    onApply({
      tables,
      zones: readZones(layout),
      world: worldOf(layout),
      look: readLook(layout),
      sections: readStudio(layout).sections,
    });
  }

  if (chosen) {
    return (
      <TemplateDialog id="map-tpl" title={chosen.card.name} onClose={onClose} wide>
        {chosen.full ? <TemplatePreview template={chosen.full} /> : <Loading variant="card" />}
        {blocked && <p className="es-notice es-notice--warning" role="alert">{blocked}</p>}
        {!blocked && replacing && (
          <p className="es-notice es-notice--warning" role="status">
            This replaces the map you have now. Undo puts it back, and nothing is saved until Save map.
          </p>
        )}
        <div className="fx-row fx-row--between gap-2 border-t border-border-base pt-3">
          <button type="button" className="es-btn es-btn--ghost" onClick={() => setChosen(null)}>Back</button>
          <button type="button" className="es-btn es-btn--primary" disabled={!chosen.full || Boolean(blocked)} onClick={use}>Use this map</button>
        </div>
      </TemplateDialog>
    );
  }

  return (
    <TemplateDialog id="map-tpl" title="Start from a template’s map" onClose={onClose}>
      <p className="text-sm text-muted">
        Tables keep their ticket type when this event has one with the same name.
      </p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {loading && !data ? <Loading variant="list" rows={3} /> : all.length === 0 ? (
        <Empty icon="map" title="No templates with a seating map yet" hint="Save an event with a map as a template from Templates, or ask Eventsli for one." />
      ) : (
        <ul className="es-tplpick">
          {all.map((t) => (
            <li key={t.id}>
              <button type="button" className="es-tplpick__item" onClick={() => open(t)}>
                <b className="fx-truncate">{t.name}</b>
                <small>{[t.scope === 'platform' ? 'Eventsli' : 'Yours', ...templateFacts(t.summary)].join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </TemplateDialog>
  );
}
