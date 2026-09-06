const express = require('express');
const { sendOk } = require('../utils/responseEnvelope');

const router = express.Router();

/**
 * Liveness. Deliberately does NOT touch the database.
 *
 * nginx and pm2 use this to decide whether to keep sending traffic. If it
 * queried Postgres, a slow database would take the whole API out of rotation
 * instead of just returning slow responses — turning a degradation into an
 * outage. Readiness (is the DB reachable?) is a separate concern.
 */
router.get('/health', (req, res) => sendOk(res, {
  status: 'ok',
  service: 'eventsli-api',
  env: process.env.NODE_ENV || 'development',
  uptimeSeconds: Math.floor(process.uptime()),
  paymentsEnabled: /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_STRIPE_ENABLED || '')),
}));

module.exports = router;
