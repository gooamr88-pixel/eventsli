const crypto = require('node:crypto');
const logger = require('../../../utils/logger');
const { mask } = require('../phone');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The provider registry.
 *
 * ADDING A PROVIDER: write an adapter beside these two with the same shape —
 *   configured(), credentialStatus(), send(), parseStatus(), parseInbound(),
 *   verifyWebhook(), inboundReply(), lookup(), pricing(), docs()
 * — register it below, and insert its row into `sms_providers`. Routing,
 * fallback, webhooks, analytics and the console pick it up from there; the
 * webhook routes are already parameterised by provider id.
 *
 * DRY RUN (SMS_DRY_RUN=true) swaps every adapter's `send` for a logger, so the
 * whole pipeline — routing, policy, receipts, analytics — can be exercised
 * without texting anyone. Refused in production: a production process that
 * silently pretends to send is worse than one that refuses.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ADAPTERS = {
  twilio: require('./twilio'),
  vonage: require('./vonage'),
};

const dryRun = () => process.env.NODE_ENV !== 'production'
  && /^(1|true|yes|on)$/i.test(String(process.env.SMS_DRY_RUN || ''));

function dryRunAdapter(real) {
  return {
    ...real,
    configured: () => true,
    async send({ to, body, sender }) {
      logger.info({ provider: real.id, to: mask(to), from: sender?.value, chars: body.length }, 'SMS DRY RUN: not sent');
      return { outcome: 'accepted', providerMessageId: `dry-${crypto.randomUUID()}`, segments: null, providerHealthy: true };
    },
    lookup: async () => ({ found: null }),
  };
}

function adapters() {
  if (!dryRun()) return ADAPTERS;
  return Object.fromEntries(Object.entries(ADAPTERS).map(([id, a]) => [id, dryRunAdapter(a)]));
}

const get = (id) => adapters()[id] || null;

module.exports = { adapters, get, dryRun, ADAPTERS };
