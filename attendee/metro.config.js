// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * THE SEAT MAP'S GEOMETRY IS THE WEBSITE'S OWN FILES, NOT A COPY.
 *
 * `frontend/src/app/components/seating/seatingGeometry.js` says it must never
 * be copied or re-implemented "just for this view": a forked catalogue once
 * drew a buffet table as a round one, and a printed map read a centre as a
 * corner. So the app imports the same plain-JS modules (geometry, table
 * sides, zones, map style, section plates) through the `@shared/*` alias in
 * tsconfig.json, and Metro is allowed to read that one folder outside the app.
 *
 * Only pure modules are imported — no React, no DOM. The drawing is the app's
 * own (src/seating/SeatMapView.tsx); where a seat or a table IS comes from here.
 * EAS uploads the whole repository, so the folder is there in a cloud build too.
 */
const shared = path.resolve(__dirname, '../frontend/src/app/components');
config.watchFolders = [...(config.watchFolders || []), shared];

module.exports = config;
