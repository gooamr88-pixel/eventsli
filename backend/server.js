// Size the libuv threadpool BEFORE anything touches it — PBKDF2 password
// hashing runs on this pool and the default of 4 makes concurrent logins queue.
// pm2 sets this via ecosystem.config.js; this is the fallback for `node server.js`.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16';
}

// Load .env WITHOUT override so real environment variables always win. In
// production pm2 sets NODE_ENV and PORT; `override: true` would let a stale
// local .env flip NODE_ENV back to development and silently disable secure cookies.
require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`Eventsli API listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);

  // BACKEND_URL feeds absolute links inside outgoing email — the QR ticket image
  // most importantly. Unset in production it falls back to localhost, and every
  // buyer gets an image nobody outside this machine can load. Catch it at boot.
  if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_URL) {
    logger.error('BACKEND_URL is not set in production — emailed QR images will point at localhost and fail for every buyer.');
  }

  // Say once, at boot, whether we can actually take money. Otherwise the only
  // way to answer "are payments live?" is to read .env on the server.
  const paymentsOn = /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_STRIPE_ENABLED || ''));
  logger.info(`Payments: ${paymentsOn ? 'ENABLED (Stripe)' : 'disabled — manual only'}`);

  // Background jobs. Without these an abandoned checkout holds its seats
  // forever — three DB functions sat correct and uncalled until this existed.
  try {
    require('./services/scheduler').start();
  } catch (err) {
    logger.error({ err: err.message }, 'scheduler failed to start');
  }
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received — draining connections`);
  try { require('./services/scheduler').stop(); } catch { /* never block shutdown */ }
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  const forceTimer = setTimeout(() => {
    logger.warn(`Forced shutdown after 10s (${signal})`);
    process.exit(1);
  }, 10_000);
  if (forceTimer.unref) forceTimer.unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

module.exports = server;
