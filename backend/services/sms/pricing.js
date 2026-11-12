const { supabase } = require('../../config/supabase');
const logger = require('../../utils/logger');
const config = require('./config');
const providers = require('./providers');

/**
 * Provider price lists → `sms_routes.cost_micros`, and EVIDENCE of reach.
 *
 * A provider pricing a country is a strong hint that it can deliver there, so
 * the sync records `available` — but it never sets `verified`. A route is
 * verified by a person who has read that provider's country guidelines, not by
 * a price list.
 */

async function syncCountry(providerId, iso2) {
  const adapter = providers.ADAPTERS[providerId];
  if (!adapter?.configured()) throw new Error(`${providerId} has no credentials configured`);
  const price = await adapter.pricing(iso2);
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from('sms_routes').select('cost_source')
    .eq('country', iso2).eq('provider_id', providerId).maybeSingle();
  const pricePatch = existing?.cost_source === 'manual'
    ? {}   // an admin's own figure is not overwritten by a list price
    : { cost_micros: price.costMicros, currency: price.currency, cost_source: price.costMicros != null ? 'provider_api' : null };
  if (!existing && !price.available) return price;   // no row for a country it cannot reach
  const { error } = await supabase.from('sms_routes').upsert({
    country: iso2, provider_id: providerId, available: price.available, cost_synced_at: now, updated_at: now, ...pricePatch,
  }, { onConflict: 'country,provider_id' });
  if (error) throw new Error(error.message);
  return price;
}

async function setSyncState(providerId, state) {
  await supabase.from('sms_providers').update({ pricing_sync: state, updated_at: new Date().toISOString() }).eq('id', providerId);
}

/** Every country, four at a time. Runs in the background; progress is on the provider row. */
async function syncAll(providerId, { concurrency = 4 } = {}) {
  const cfg = await config.load({ fresh: true });
  const isos = cfg.countries.map((c) => c.iso2);
  const state = { running: true, total: isos.length, done: 0, available: 0, failed: 0, startedAt: new Date().toISOString() };
  await setSyncState(providerId, state);
  const work = [...isos];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (work.length) {
      const iso = work.shift();
      try {
        // eslint-disable-next-line no-await-in-loop
        const p = await syncCountry(providerId, iso);
        if (p.available) state.available += 1;
      } catch (err) {
        state.failed += 1;
        state.lastError = String(err.message).slice(0, 200);
      }
      state.done += 1;
      // eslint-disable-next-line no-await-in-loop
      if (state.done % 25 === 0) await setSyncState(providerId, state);
    }
  }));
  Object.assign(state, { running: false, finishedAt: new Date().toISOString() });
  await setSyncState(providerId, state);
  config.invalidate();
  logger.info({ provider: providerId, ...state }, 'SMS pricing sync finished');
  return state;
}

module.exports = { syncCountry, syncAll };
