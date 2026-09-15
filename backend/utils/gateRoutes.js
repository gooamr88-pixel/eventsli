/**
 * The door's own requests — a scan, an offline sync, an undo, the status poll.
 *
 * Every one is authenticated by a device token, and a venue's tablets usually
 * share ONE public IP (venue Wi-Fi, carrier NAT). The site-wide per-IP ceiling
 * therefore counted every door in the building as a single client and refused
 * the queue with a 429 at exactly the busiest moment. These requests are exempt
 * from it and get a per-DEVICE limit instead, in routes/scanRoutes.js.
 *
 * Only these four paths. Device sign-in (`/scan/login`) and the door-team
 * routes stay under the IP ceiling — they are where guessing happens.
 *
 * Pure, so app.js can load it before any route and a unit test can pin it
 * without a database.
 */
const GATE_PATHS = new Set([
  '/api/v1/scan/verify',
  '/api/v1/scan/sync',
  '/api/v1/scan/undo',
  '/api/v1/scan/status',
]);

function isGateScanRequest(req) {
  const path = String(req?.originalUrl || req?.url || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return GATE_PATHS.has(path);
}

module.exports = { isGateScanRequest, GATE_PATHS };
