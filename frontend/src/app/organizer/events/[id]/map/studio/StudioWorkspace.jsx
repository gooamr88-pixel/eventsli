'use client';

import VenuePanel from './VenuePanel';
import Studio3D from './Studio3D';
import Studio360 from './Studio360';
import StudioPreview from './StudioPreview';

/**
 * The four Venue Studio workspaces that are not the 2D editor. The editor
 * stays in MapEditor, which owns its viewport and gestures; these only need
 * the draft and the studio's own state, handed in.
 */
export default function StudioWorkspace({
  workspace, eventId, tables, zones, world, onResizeWorld, layout, sections, tiers, eventTitle, eventInfo, draft,
  // Edits a zone on the map (useMapDraft.updateZone): the 3D settings' stage size.
  onZone = null,
  // The table categories and the map look: the 3D and 360° views paint
  // tables as the 2D map does (mapStyle.js, THE MAP'S COLOUR RULES).
  categories = [], look = null,
}) {
  const { studio, edit, savedSeats, holds, toggleHold, clearHolds } = draft;
  if (workspace === 'venue') {
    return (
      <VenuePanel
        eventId={eventId} venue={studio.venue} onChange={(patch) => edit('venue', patch)}
        tables={tables} zones={zones} sections={sections} world={world} onResizeWorld={onResizeWorld}
      />
    );
  }
  if (workspace === '3d') {
    return (
      <Studio3D
        tables={tables} zones={zones} world={world} scene={studio.scene} onScene={(patch) => edit('scene', patch)}
        sections={sections} tiers={tiers} eventTitle={eventTitle} categories={categories} look={look}
        eventId={eventId} screenFeed={eventInfo.screenFeed || null} onZone={onZone}
      />
    );
  }
  if (workspace === '360') {
    return (
      <Studio360
        eventId={eventId} tables={tables} zones={zones} world={world} scene={studio.scene}
        views={studio.views} onViews={(views) => edit('views', views)}
        sections={sections} tiers={tiers} eventTitle={eventTitle} categories={categories} look={look}
        screenFeed={eventInfo.screenFeed || null}
      />
    );
  }
  if (workspace === 'preview') {
    return (
      <StudioPreview
        tables={tables} zones={zones} world={world} layout={layout} studio={studio} tiers={tiers}
        savedSeats={savedSeats} currency={eventInfo.currency} purchaseMode={eventInfo.purchaseMode}
        eventTitle={eventTitle} holds={holds} onToggleHold={toggleHold} onClearHolds={clearHolds}
        categories={categories} screenFeed={eventInfo.screenFeed || null}
      />
    );
  }
  return null;
}
