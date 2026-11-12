const crypto = require('node:crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider credentials: environment variables, or encrypted rows managed from
 * the console. Never both silently — the console shows which one is in use.
 *
 * PRECEDENCE: an environment variable always wins over a stored value, field
 * by field. Operators who manage secrets on the server keep full control, and
 * the console cannot override them.
 *
 * AT REST: AES-256-GCM with SMS_CREDENTIALS_KEY (32 bytes, base64 or hex),
 * which lives only on the server. Without it, storing is refused. Rows record
 * which key encrypted them (`key_id`, a hash prefix), so a rotated or wrong
 * key reads as "stored but unreadable", not as garbage credentials.
 *
 * NEVER RETURNED: `status()` reports which fields are present and where from;
 * the only values it shows are short hints of NON-secret identifiers (the last
 * four characters of an account SID). Secrets are write-only.
 *
 * No database access here: config.js loads the rows and hands them over, so
 * this file — and the adapters that read it — stay testable without one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const FIELDS = Object.freeze({
  twilio: {
    accountSid: { env: 'TWILIO_ACCOUNT_SID', label: 'Account SID', required: true, secret: false, pattern: /^AC[0-9a-fA-F]{32}$/ },
    authToken: { env: 'TWILIO_AUTH_TOKEN', label: 'Auth token', required: true, secret: true, pattern: /^[0-9a-fA-F]{32}$/ },
    apiKeySid: { env: 'TWILIO_API_KEY_SID', label: 'API key SID', required: false, secret: false, pattern: /^SK[0-9a-fA-F]{32}$/ },
    apiKeySecret: { env: 'TWILIO_API_KEY_SECRET', label: 'API key secret', required: false, secret: true, pattern: /^[A-Za-z0-9]{16,64}$/ },
  },
  vonage: {
    apiKey: { env: 'VONAGE_API_KEY', label: 'API key', required: true, secret: false, pattern: /^[A-Za-z0-9]{6,32}$/ },
    apiSecret: { env: 'VONAGE_API_SECRET', label: 'API secret', required: true, secret: true, pattern: /^[A-Za-z0-9]{8,64}$/ },
    signatureSecret: { env: 'VONAGE_SIGNATURE_SECRET', label: 'Signature secret', required: false, secret: true, pattern: /^\S{8,128}$/ },
    signatureMethod: { env: 'VONAGE_SIGNATURE_METHOD', label: 'Signature method', required: false, secret: false, pattern: /^(md5hash|md5|sha1|sha256|sha512)$/ },
    currency: { env: 'VONAGE_CURRENCY', label: 'Billing currency', required: false, secret: false, pattern: /^[A-Z]{3}$/ },
  },
});

const stored = new Map();   // providerId → { values, keyId, unreadable, hints, updatedAt }

function keyBytes() {
  const raw = String(process.env.SMS_CREDENTIALS_KEY || '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}
const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
const keyConfigured = () => Boolean(keyBytes());

function encrypt(values) {
  const key = keyBytes();
  if (!key) throw Object.assign(new Error('SMS_CREDENTIALS_KEY is not set (32 bytes, base64 or hex). Credentials cannot be stored.'), { code: 'NO_KEY' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), key_id: keyId(key) };
}

function decrypt(row) {
  const key = keyBytes();
  if (!key || keyId(key) !== row.key_id) throw new Error('stored credentials were encrypted with a different key');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

/** config.js hands every stored row over after each load. */
function setStoredRows(rows) {
  stored.clear();
  for (const row of rows || []) {
    try {
      stored.set(row.provider_id, { values: decrypt(row), unreadable: false, hints: row.hints || {}, updatedAt: row.updated_at });
    } catch {
      stored.set(row.provider_id, { values: {}, unreadable: true, hints: row.hints || {}, updatedAt: row.updated_at });
    }
  }
}

/** The values an adapter uses: environment first, then stored, field by field. */
function resolve(providerId) {
  const spec = FIELDS[providerId] || {};
  const s = stored.get(providerId)?.values || {};
  const out = {};
  for (const [name, f] of Object.entries(spec)) out[name] = process.env[f.env] || s[name] || undefined;
  return out;
}

const hintOf = (value) => (value ? `…${String(value).slice(-4)}` : null);

/** What the console may know: presence, source, and hints of non-secret ids. No secret, ever. */
function status(providerId) {
  const spec = FIELDS[providerId] || {};
  const s = stored.get(providerId);
  const fields = {};
  const missing = [];
  for (const [name, f] of Object.entries(spec)) {
    const fromEnv = Boolean(process.env[f.env]);
    const fromStore = Boolean(s?.values?.[name]);
    fields[name] = {
      label: f.label, env: f.env, required: f.required, secret: f.secret,
      source: fromEnv ? 'env' : fromStore ? 'stored' : null,
      hint: !f.secret && (fromEnv || fromStore) ? hintOf(process.env[f.env] || s.values[name]) : null,
    };
    if (f.required && !fromEnv && !fromStore) missing.push(f.env);
  }
  return {
    configured: missing.length === 0,
    missing,
    fields,
    stored: Boolean(s),
    storedUnreadable: Boolean(s?.unreadable),
    storedUpdatedAt: s?.updatedAt || null,
    keyConfigured: keyConfigured(),
  };
}

/**
 * Validates a submission, merging it over what is stored (a blank field keeps
 * the stored value, so a secret need not be re-typed to change something else).
 * @returns {{ values, fields } | { error }}
 */
function prepare(providerId, submitted = {}) {
  const spec = FIELDS[providerId];
  if (!spec) return { error: 'Unknown provider.' };
  const current = stored.get(providerId)?.values || {};
  const values = {};
  for (const [name, f] of Object.entries(spec)) {
    const raw = submitted[name];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v) {
      if (!f.pattern.test(v)) return { error: `${f.label} does not look right. Copy it again from the ${providerId === 'twilio' ? 'Twilio' : 'Vonage'} console.` };
      values[name] = v;
    } else if (current[name]) values[name] = current[name];
  }
  const missing = Object.entries(spec).filter(([n, f]) => f.required && !values[n]).map(([, f]) => f.label);
  if (missing.length) return { error: `Enter: ${missing.join(', ')}.` };
  const hints = Object.fromEntries(Object.entries(spec).filter(([n, f]) => !f.secret && values[n]).map(([n]) => [n, hintOf(values[n])]));
  return { values, fields: Object.keys(values), hints };
}

/** Candidate values for a connection test before saving, merged like prepare() but without requiring storage. */
function candidate(providerId, submitted = {}) {
  const prepared = prepare(providerId, submitted);
  if (prepared.error) return prepared;
  const out = resolve(providerId);
  for (const [k, v] of Object.entries(prepared.values)) if (submitted[k]) out[k] = v;
  for (const k of Object.keys(out)) if (out[k] === undefined && prepared.values[k]) out[k] = prepared.values[k];
  return { values: out };
}

module.exports = { FIELDS, encrypt, decrypt, setStoredRows, resolve, status, prepare, candidate, keyConfigured };
