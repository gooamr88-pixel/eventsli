const { supabase } = require('../../config/supabase');
const { buildMatcher } = require('./phone');
const credentials = require('./credentials');

/**
 * Everything the SMS pipeline reads on every message — settings, countries,
 * routes, providers, senders, categories — loaded together and cached briefly.
 *
 * Fifteen seconds, per process: short enough that a country an admin disables
 * stops receiving within a dispatch cycle or two, long enough that a busy queue
 * does not re-read 250 countries for each message. Admin writes call
 * `invalidate()` so the worker that handled the change sees it at once.
 */

const TTL_MS = 15_000;
let cached = null;

async function read(table, columns = '*') {
  const { data, error } = await supabase.from(table).select(columns).range(0, 9999);
  if (error) throw new Error(`could not read ${table}: ${error.message}`);
  return data || [];
}

async function fetchConfig() {
  const [settingsRows, countries, providers, routes, senders, categories] = await Promise.all([
    read('sms_settings'), read('sms_countries'), read('sms_providers'),
    read('sms_routes'), read('sms_senders'), read('sms_categories'),
  ]);
  // Stored provider credentials (ciphertext), decrypted into credentials.js.
  // A database without migration 20261117090000 has no such table: env only.
  const { data: credRows, error: credError } = await supabase.from('sms_provider_credentials').select('*');
  credentials.setStoredRows(credError ? [] : credRows);

  const routesByCountry = new Map();
  for (const r of routes) {
    if (!routesByCountry.has(r.country)) routesByCountry.set(r.country, []);
    routesByCountry.get(r.country).push(r);
  }
  return {
    settings: settingsRows[0] || null,
    countries,
    countryByIso: new Map(countries.map((c) => [c.iso2, c])),
    matcher: buildMatcher(countries),
    providers: new Map(providers.map((p) => [p.id, p])),
    routes,
    routesByCountry,
    senders,
    categories: new Map(categories.map((c) => [c.key, c])),
  };
}

async function load({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await fetchConfig();
  cached = { at: Date.now(), value };
  return value;
}

function invalidate() {
  cached = null;
}

module.exports = { load, invalidate };
