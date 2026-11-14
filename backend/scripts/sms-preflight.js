#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SMS go-live preflight. READ-ONLY: it sends no message and changes no data.
 *
 *   node scripts/sms-preflight.js                     # env + database checks
 *   node scripts/sms-preflight.js --test-connection   # + read-only provider account calls
 *   node scripts/sms-preflight.js --check-webhooks    # + confirm the public webhook URLs answer
 *
 * Run ON THE SERVER with its .env, after the SMS migrations and before turning
 * sending on. Prints names, counts and states — never a secret value.
 * Exit code 1 when a BLOCKER is found, 0 otherwise (warnings do not fail it).
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();

const args = new Set(process.argv.slice(2));
const results = { blocker: [], warn: [], ok: [] };
const blocker = (m) => results.blocker.push(m);
const warn = (m) => results.warn.push(m);
const ok = (m) => results.ok.push(m);

async function main() {
  // ── Environment ────────────────────────────────────────────────────────
  const { bootWarnings } = require('../services/sms/bootCheck');
  for (const w of bootWarnings()) (/IGNORED|not 32 bytes/.test(w) ? blocker : warn)(w);
  if (!process.env.SMS_WEBHOOK_BASE_URL && !process.env.BACKEND_URL) {
    blocker('Neither SMS_WEBHOOK_BASE_URL nor BACKEND_URL is set: providers cannot deliver receipts or replies.');
  } else ok(`Webhook base: ${process.env.SMS_WEBHOOK_BASE_URL || process.env.BACKEND_URL}`);
  if (process.env.SCHEDULER_ENABLED && /^(0|false|no|off)$/i.test(process.env.SCHEDULER_ENABLED)) {
    blocker('SCHEDULER_ENABLED is off: nothing would ever be dispatched.');
  }

  // ── Database ───────────────────────────────────────────────────────────
  const { supabase } = require('../config/supabase');
  const tables = ['sms_settings', 'sms_providers', 'sms_countries', 'sms_routes', 'sms_senders', 'sms_categories',
    'sms_messages', 'sms_attempts', 'sms_receipts', 'sms_inbound', 'sms_consents', 'sms_consent_log', 'sms_suppressions',
    'sms_segments', 'sms_campaigns', 'sms_organizer_access', 'sms_provider_credentials'];
  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from(t).select('*', { head: true, count: 'exact' }).limit(1);
    if (error) blocker(`Table ${t} is missing or unreadable (${error.message}). Apply the SMS migrations.`);
  }
  if (results.blocker.some((b) => b.startsWith('Table '))) return;
  ok('All SMS tables present');
  const { data: kind } = await supabase.from('sms_consents').select('kind').limit(1);
  if (kind === null) blocker('sms_consents has no "kind" column: apply 20261117090000.');

  const config = require('../services/sms/config');
  const cfg = await config.load({ fresh: true });
  const s = cfg.settings;
  if (!s) { blocker('sms_settings has no row.'); return; }
  (s.sending_enabled ? warn : ok)(`Sending switch: ${s.sending_enabled ? 'ON — texts will go out' : 'off (turn on last, from Compliance)'}`);
  if (s.message_retention_days == null) warn('No message retention period set (Compliance → Redact message text after).');

  // ── Providers and credentials ─────────────────────────────────────────
  const providers = require('../services/sms/providers');
  if (providers.dryRun()) warn('SMS_DRY_RUN is active in this process: nothing would really be sent.');
  const enabled = [...cfg.providers.values()].filter((p) => p.enabled);
  if (!enabled.length) blocker('No provider is enabled (SMS → Providers).');
  for (const p of cfg.providers.values()) {
    const adapter = providers.ADAPTERS[p.id];
    const st = adapter.credentialStatus();
    const sources = Object.entries(st.fields).filter(([, f]) => f.source).map(([n, f]) => `${n}:${f.source}`).join(', ') || 'none';
    if (p.enabled && !st.configured) blocker(`${p.id} is enabled but missing ${st.missing.join(', ')}.`);
    else ok(`${p.id}: ${p.enabled ? 'enabled' : 'off'}; credentials ${st.configured ? 'complete' : 'incomplete'} (${sources})`);
    if (st.storedUnreadable) blocker(`${p.id}: stored credentials cannot be decrypted with this SMS_CREDENTIALS_KEY.`);
    if (p.circuit_open_until && new Date(p.circuit_open_until) > new Date()) warn(`${p.id}: paused by its circuit breaker (${p.last_error}).`);
    if (args.has('--test-connection') && st.configured) {
      // eslint-disable-next-line no-await-in-loop
      const t = await adapter.testConnection();
      (t.ok ? ok : blocker)(`${p.id} connection: ${t.ok ? `OK${t.account ? ` (${t.account})` : ''}${t.type ? ` type ${t.type}` : ''}${t.balance != null ? ` balance ${t.balance}` : ''}` : t.error}`);
      // A Twilio TRIAL account only texts verified numbers and prefixes every
      // message with "Sent from your Twilio trial account".
      if (t.ok && String(t.type || '').toLowerCase() === 'trial') blocker(`${p.id} is a TRIAL account: upgrade it in the Twilio Console before going live.`);
    }
  }
  if (cfg.providers.get('vonage')?.enabled && !providers.ADAPTERS.vonage.signsWebhooks()) {
    warn('Vonage is enabled without a signature secret: inbound replies are authenticated by the URL token only.');
  }

  // ── Senders, countries, categories ─────────────────────────────────────
  const activeSenders = cfg.senders.filter((x) => x.active);
  if (!activeSenders.length) blocker('No active sender (SMS → Sender IDs).');
  else ok(`${activeSenders.length} active sender(s)`);
  for (const x of activeSenders.filter((y) => y.registration_status === 'pending')) warn(`Sender ${x.value} is active but its registration is pending: it will not be used.`);
  const enabledCountries = cfg.countries.filter((c) => c.status === 'enabled');
  if (!enabledCountries.length) blocker('No country is enabled. Verify and turn on at least one.');
  for (const c of enabledCountries) {
    const routes = (cfg.routesByCountry.get(c.iso2) || []).filter((r) => r.verified && r.active && cfg.providers.get(r.provider_id)?.enabled);
    if (!routes.length) blocker(`${c.iso2} is enabled but has no verified route through an enabled provider.`);
    const usable = routes.some((r) => require('../services/sms/routing').pickSender({ route: r, senders: cfg.senders, country: c, trafficClass: 'transactional' }).sender);
    if (routes.length && !usable) blocker(`${c.iso2}: no usable sender for transactional texts (registration required: ${c.requires_sender_registration}).`);
    if (c.verified_at && Date.now() - new Date(c.verified_at).getTime() > 365 * 86_400_000) warn(`${c.iso2}: verification is over a year old.`);
    if (!routes.some((r) => r.cost_micros != null)) warn(`${c.iso2}: no cost on its routes; analytics and the marketing budget cannot count it.`);
  }
  ok(`Countries enabled: ${enabledCountries.map((c) => c.iso2).join(', ') || 'none'}`);
  for (const cat of cfg.categories.values()) ok(`Category ${cat.key}: ${cat.enabled ? 'on' : 'off'}${cat.requires_consent ? ', consent required' : ', NO consent required'}`);
  for (const cat of cfg.categories.values()) {
    if (cat.traffic_class === 'transactional' && !cat.requires_consent) warn(`Category ${cat.key} sends without transactional consent — confirm that is legal in every enabled country.`);
  }

  // ── Webhooks reachable from the internet ──────────────────────────────
  if (args.has('--check-webhooks')) {
    const auth = require('../services/sms/webhookAuth');
    for (const id of ['twilio', 'vonage']) {
      const url = auth.inboundUrl(id, { withToken: false });
      if (!url) continue;
      try {
        // An unauthenticated probe must be REFUSED (403): that proves the route is
        // reachable and that it checks authentication. 200 would be a problem.
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
        (res.status === 403 ? ok : blocker)(`${id} inbound webhook ${url} → ${res.status}${res.status === 403 ? ' (reachable, refuses unauthenticated calls)' : ''}`);
      } catch (err) {
        blocker(`${id} inbound webhook ${url} is not reachable: ${err.message}`);
      }
    }
  }
}

main()
  .catch((err) => blocker(`Preflight could not run: ${err.message}`))
  .finally(() => {
    for (const m of results.ok) console.log(`  ok       ${m}`);
    for (const m of results.warn) console.log(`  WARN     ${m}`);
    for (const m of results.blocker) console.log(`  BLOCKER  ${m}`);
    console.log(`\n${results.blocker.length} blocker(s), ${results.warn.length} warning(s).`);
    process.exit(results.blocker.length ? 1 : 0);
  });
