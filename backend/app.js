const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { sendFail } = require('./utils/responseEnvelope');

// ─── Startup validation ─────────────────────────────────────────────────────
// Fail at boot, loudly, rather than at 2am on the first checkout. A missing
// JWT_SECRET does not surface until someone logs in; a missing STRIPE_SECRET_KEY
// does not surface until someone tries to pay.
const REQUIRED_ENV = [
  'JWT_SECRET', 'QR_JWT_SECRET',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'IP_HASH_SALT',
];

// Stripe keys are required only when card payments are turned ON. Keyed off the
// operator's INTENT (the flag), so enabling payments without keys fails loudly
// instead of silently staying disabled.
const stripeIntended = /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_STRIPE_ENABLED || '').trim());
if (stripeIntended) REQUIRED_ENV.push('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET');

// Every QR image in a ticket email is an absolute link back to this API. Unset,
// the src is relative, no mail client can resolve it, and every buyer gets a
// ticket with a broken image where the code should be — discovered at the door.
// Fatal in production; a laptop is allowed to run without it.
if (process.env.NODE_ENV === 'production') REQUIRED_ENV.push('BACKEND_URL');

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  logger.error(`FATAL: missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// A reservation shorter than the Stripe Checkout session lets a buyer pay for a
// seat that was already released and resold — two people, one chair. Refuse to
// boot rather than ship that.
const RESERVATION_TTL = parseInt(process.env.RESERVATION_TTL_MINUTES || '35', 10);
if (RESERVATION_TTL < 31) {
  logger.error(
    `FATAL: RESERVATION_TTL_MINUTES is ${RESERVATION_TTL}. A Stripe Checkout session lasts at ` +
    'least 30 minutes, so the seat hold must outlast it. Set 35 or more.',
  );
  process.exit(1);
}

/**
 * A LIVE Stripe key outside production. Warned about, never blocked.
 *
 * There is no technical difference between a test key and a live one at the
 * point of use, so nothing downstream can tell you that the checkout you just
 * ran on localhost created a real charge on a real card. The only moment that
 * fact is visible is here, at boot, before anyone has taken any money.
 *
 * It is deliberately NOT fatal. Running a live key locally is a legitimate and
 * necessary thing to do — verifying the money path end to end against the real
 * account is the one test that cannot be faked, and `scripts/probe-live-*` and
 * `verify-live-money-path.js` exist precisely to do it. Refusing to boot would
 * break the very workflow this warning is describing.
 *
 * So it says the thing and gets out of the way. The intent is that the line is
 * NOISY: if it scrolls past on every ordinary dev run, that is the signal, not
 * the annoyance.
 */
if (process.env.NODE_ENV !== 'production' && stripeIntended) {
  const live = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY']
    .filter((key) => /^(sk|pk)_live_/.test(String(process.env[key] || '')));
  if (live.length > 0) {
    logger.warn(
      `LIVE Stripe credentials in a NODE_ENV=${process.env.NODE_ENV || 'undefined'} process `
      + `(${live.join(', ')}). Card payments are ENABLED, so any checkout run against this `
      + 'server charges a real card on the live account — there is no test-mode net under it. '
      + 'Intentional for a live money-path check; otherwise switch to sk_test/pk_test keys.',
    );
  }
}

const app = express();

// Behind nginx every request arrives from 127.0.0.1 with the real client IP in
// X-Forwarded-For. Trust exactly ONE hop — a numeric count, not `true`, so a
// spoofed XFF cannot impersonate an address and dodge the rate limiter.
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// ─── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = String(process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // No origin: server-to-server, curl, or a same-origin navigation.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    logger.warn({ origin }, 'CORS rejected an origin');
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(compression({ threshold: 1024 }));
app.use(cookieParser());

// ─── Body parsing ───────────────────────────────────────────────────────────
// Stripe signs the RAW bytes. Once express.json() has parsed and re-serialised
// the body the signature no longer verifies, so the buffer is captured here.
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/v1/payments/webhook')) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Rate limiting ──────────────────────────────────────────────────────────
const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';

// An optional shared store so limits are GLOBAL across pm2 cluster workers.
// The default MemoryStore is per-process: with `instances: 'max'` the effective
// limit becomes N× and, worse, non-deterministic — the same client is allowed or
// throttled depending purely on which worker answered.
let redisClient = null;
let RedisStore = null;
if (!RATE_LIMIT_DISABLED && process.env.REDIS_URL) {
  try {
    const IORedis = require('ioredis');
    redisClient = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    redisClient.on('error', (e) => logger.error({ err: e.message }, 'Redis (rate-limit) error'));
    ({ RedisStore } = require('rate-limit-redis'));
    logger.info('Rate limiting backed by Redis (shared across workers)');
  } catch (e) {
    // A missing optional dependency must degrade to the in-memory store with a
    // warning, never take the API down.
    redisClient = null;
    RedisStore = null;
    logger.warn(`REDIS_URL is set but the optional deps are unavailable — falling back to the per-process limiter. (${e.message})`);
  }
}
const storeFor = (prefix) => (redisClient && RedisStore
  ? new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix: `rl:${prefix}:` })
  : undefined);

// The Next.js server renders public event pages by calling this API from the
// box itself, so every SSR request would collapse onto ONE rate-limit key.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const skipInternal = (req) => LOOPBACK.has(req.ip);

// Stripe retries a failed webhook with backoff and can burst on a busy event.
// Exempt it: it is authenticated by HMAC signature, not by volume.
const isStripeWebhook = (req) => (req.originalUrl || '').startsWith('/api/v1/payments/webhook');

// The door's scans are device-authenticated and share one venue IP. They get a
// per-device limit in routes/scanRoutes.js instead — see utils/gateRoutes.js.
const { isGateScanRequest } = require('./utils/gateRoutes');

if (RATE_LIMIT_DISABLED) {
  logger.warn('Rate limiting is DISABLED. Never run production like this.');
} else {
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => skipInternal(req) || isStripeWebhook(req) || isGateScanRequest(req),
    store: storeFor('api'),
    handler: (req, res) => sendFail(res, {
      status: 429, error: 'RATE_LIMITED',
      message: 'Too many requests. Please try again in a few minutes.',
    }),
  }));
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/v1', require('./routes/healthRoutes'));
app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/organizer', require('./routes/organizerRoutes'));
app.use('/api/v1/events', require('./routes/eventRoutes'));
app.use('/api/v1/public', require('./routes/publicRoutes'));
app.use('/api/v1/tickets', require('./routes/ticketRoutes'));
app.use('/api/v1/payments', require('./routes/paymentRoutes'));
app.use('/api/v1/scan', require('./routes/scanRoutes'));
// One guard for all three admin routers — see routes/admin/index.js.
app.use('/api/v1/admin', require('./routes/admin'));

// ─── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => sendFail(res, {
  status: 404, error: 'NOT_FOUND',
  message: `No route matches ${req.method} ${req.path}`,
}));

// ─── Error handler ──────────────────────────────────────────────────────────
// Four arguments, or Express does not treat it as an error handler.
app.use((err, req, res, _next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return sendFail(res, { status: 403, error: 'FORBIDDEN', message: 'Origin not allowed.' });
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  // Never leak an internal message to a client: stack traces and driver errors
  // name tables and columns.
  return sendFail(res, {
    status: 500, error: 'INTERNAL_ERROR',
    message: 'Something went wrong on our side. Please try again.',
  });
});

module.exports = app;
