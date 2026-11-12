#!/usr/bin/env node
/**
 * Prints the webhook URLs to paste into the Twilio and Vonage dashboards.
 *
 *   node scripts/sms-webhook-urls.js
 *
 * Run ON THE SERVER, with its .env: the inbound URL for Vonage carries a token
 * derived from SMS_WEBHOOK_SECRET (or JWT_SECRET), which is why the console
 * shows these URLs without it. Delivery-receipt URLs are per message and are
 * sent to the provider with each message, so there is nothing to configure for
 * those — the status URL below is only for providers or accounts that want a
 * default.
 */
require('dotenv').config();
const auth = require('../services/sms/webhookAuth');

const base = auth.webhookBase();
if (!base) {
  console.error('Set SMS_WEBHOOK_BASE_URL (or BACKEND_URL) to the public API origin first, e.g. https://api.eventsli.com');
  process.exit(1);
}

console.log(`
Twilio  (Phone number or Messaging Service → "A message comes in", HTTP POST)
  ${auth.inboundUrl('twilio', { withToken: false })}
  Authenticated by X-Twilio-Signature with TWILIO_AUTH_TOKEN. No token needed.

Vonage  (Dashboard → Settings → SMS → Inbound SMS webhook, POST JSON or GET)
  ${auth.inboundUrl('vonage')}
  Keep this URL private: the t= parameter authenticates it. Set VONAGE_SIGNATURE_SECRET
  as well if signed webhooks are on for the account.

Delivery receipts are requested per message (callback URL with its own token):
  ${base}/api/v1/sms/webhooks/<provider>/status?mid=<message id>&t=<token>
`);
