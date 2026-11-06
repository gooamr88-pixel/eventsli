const rateLimit = require('express-rate-limit');
const { sendFail } = require('../utils/responseEnvelope');
const logger = require('../utils/logger');

/**
 * A shared Redis store, so limits are GLOBAL across pm2 cluster workers.
 *
 * The default MemoryStore is PER PROCESS, and ecosystem.config.js runs the API
 * with `instances: 'max'`. Without Redis the effective limit is N× and — worse
 * — non-deterministic: the same client is allowed or throttled depending purely
 * on which worker answered. For a login limiter that is the difference between
 * 20 attempts and 160.
 *
 * Optional, and degrades to the in-memory store with a warning. A missing
 * optional dependency must never take the API down.
 */
let redisClient = null;
let RedisStore = null;

if (process.env.REDIS_URL && process.env.DISABLE_RATE_LIMIT !== 'true') {
  try {
    const IORedis = require('ioredis');
    redisClient = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    redisClient.on('error', (e) => logger.error({ err: e.message }, 'Redis (rate-limit) error'));
    ({ RedisStore } = require('rate-limit-redis'));
    logger.info('Rate limits are shared across workers (Redis)');
  } catch (e) {
    redisClient = null;
    RedisStore = null;
    logger.warn(
      `REDIS_URL is set but ioredis/rate-limit-redis are unavailable — falling back to `
      + `the per-process limiter, which is N× looser under pm2 cluster mode. (${e.message})`,
    );
  }
}

const NAMES = new Set();

/**
 * An email address as the ACCOUNT sees it, for keying a limiter.
 *
 * Registration and login normalise addresses (express-validator's
 * normalizeEmail: lower case; Gmail drops dots and `+tags`), so `V.ictim+1@
 * Gmail.com` and `victim@gmail.com` are one account. A limiter keyed on the raw
 * string gave each spelling its own budget. Erring towards merging is safe
 * here: the worst case is two people sharing an attempt budget.
 */
function accountKey(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 1) return raw;
  let local = raw.slice(0, at).split('+')[0];
  let domain = raw.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('.').join('');
  return `${local}@${domain}`;
}

/** A namespaced store, so two limiters do not share one counter. */
function storeFor(prefix) {
  if (!redisClient || !RedisStore) return undefined;
  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

/**
 * One factory for every rate limiter in the codebase.
 *
 * It exists because the route-level limiters were each built by hand and none
 * of them honoured `DISABLE_RATE_LIMIT` — the escape hatch app.js documents for
 * load testing. The result was an integration suite that could not exercise a
 * limited endpoint more than a handful of times without being throttled by its
 * own protection, which reads as a dozen failing tests and says nothing about
 * what is actually wrong.
 *
 * Anything that limits a request goes through here, so the flag means the same
 * thing everywhere and the failure shape is identical.
 */
function makeLimiter({ windowMs, max, keyGenerator, message, skip, name }) {
  // REQUIRED. An unnamed limiter used to fall back to one shared `default`
  // Redis keyspace, so with REDIS_URL set the seat-hold, promo and
  // password-reset limiters all incremented the same `rl:default:<ip>` counter
  // (TECH-AUDIT-LOG T-020). Refused at boot rather than shared at runtime.
  if (!name || typeof name !== 'string') {
    throw new Error('makeLimiter needs a unique `name` — it namespaces the shared store');
  }
  if (NAMES.has(name)) throw new Error(`makeLimiter: the name "${name}" is already in use`);
  NAMES.add(name);

  const disabled = process.env.DISABLE_RATE_LIMIT === 'true';

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Namespaced per limiter, or the login budget and the promo budget would
    // share one counter and exhaust each other.
    store: storeFor(name),
    ...(keyGenerator ? { keyGenerator } : {}),
    skip: (req, res) => {
      // Never in production, whatever the flag says: a limiter that can be
      // switched off by an environment variable someone copied from a test
      // config is not a limiter.
      if (disabled && process.env.NODE_ENV !== 'production') return true;
      return skip ? skip(req, res) : false;
    },
    handler: (req, res) => sendFail(res, {
      status: 429,
      error: 'RATE_LIMITED',
      message: message || 'Too many requests. Please try again in a few minutes.',
    }),
  });
}

module.exports = { makeLimiter, accountKey };
