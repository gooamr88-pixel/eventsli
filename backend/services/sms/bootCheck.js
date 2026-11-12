/**
 * Production configuration checks for SMS, run once at boot by app.js. Pure:
 * it reads the environment passed to it and returns warnings, so it is tested
 * without a database and can never stop the API from starting.
 */
/** At boot: configuration that would quietly break SMS in production. Warns, never exits. */
function bootWarnings(env = process.env) {
  const warnings = [];
  const prod = env.NODE_ENV === 'production';
  if (prod && /^(1|true|yes|on)$/i.test(String(env.SMS_DRY_RUN || ''))) {
    warnings.push('SMS_DRY_RUN is set in production and is IGNORED: messages will really be sent.');
  }
  if (prod && !env.SMS_WEBHOOK_SECRET) {
    warnings.push('SMS_WEBHOOK_SECRET is not set: SMS webhook and unsubscribe tokens fall back to JWT_SECRET, and rotating JWT_SECRET would break every outstanding unsubscribe link and receipt callback.');
  }
  const base = env.SMS_WEBHOOK_BASE_URL || env.BACKEND_URL || '';
  if (prod && base && !/^https:\/\//.test(base)) {
    warnings.push(`SMS webhook base URL is not HTTPS (${base}): providers will deliver receipts in clear, and Twilio may refuse.`);
  }
  if (env.SMS_CREDENTIALS_KEY) {
    const raw = String(env.SMS_CREDENTIALS_KEY).trim();
    const len = /^[0-9a-fA-F]{64}$/.test(raw) ? 32 : Buffer.from(raw, 'base64').length;
    if (len !== 32) warnings.push('SMS_CREDENTIALS_KEY is set but is not 32 bytes (base64 or hex): stored credentials cannot be used.');
  }
  return warnings;
}

module.exports = { bootWarnings };
