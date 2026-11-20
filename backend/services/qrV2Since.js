const { supabase } = require('../config/supabase');
const qrSigning = require('./qrSigning');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Since when has EVERY ticket code been signed with the ES256 key?
 *
 * A phone with no signal can check an ES256 (QR v2) signature but not an HS256
 * (legacy) one. It used to admit any HS256-shaped code whose ticket was on its
 * list, which made a forgery as easy as writing down a ticket id (audit
 * 2026-11-20, H2). A ticket whose codes were only ever made with the ES256 key
 * cannot have a genuine HS256 code, so the offline list tells the phone, per
 * ticket, whether one can exist (`legacy`, event_door_manifest).
 *
 * Codes are made when a ticket is shown or emailed, never stored, so the answer
 * is a time: when this server started signing with the key. It is kept in
 * platform_settings ('qr_v2_since') and written at BOOT, because the key is
 * environment configuration and only a restart changes it:
 *
 *   key configured   record now, unless already recorded (the first worker wins)
 *   no key           delete it: codes made from now on are HS256 again, and a
 *                    key added later starts a new "since"
 *
 * Without a key, or with nothing recorded, the answer is null and every ticket
 * may have an older code — exactly the behaviour before this existed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEY = 'qr_v2_since';
const CACHE_MS = 60_000;
let cache = { at: 0, value: null };

/** Called once at boot (server.js). Never throws. */
async function record(now = new Date()) {
  try {
    if (qrSigning.signingKey()) {
      const { error } = await supabase.from('platform_settings')
        .upsert({ key: KEY, value: { since: now.toISOString() } }, { onConflict: 'key', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('platform_settings').delete().eq('key', KEY);
      if (error) throw new Error(error.message);
    }
    cache = { at: 0, value: null };
  } catch (err) {
    // Not fatal: the list then says every ticket may have an older code.
    logger.warn({ err: err.message }, 'qr v2: could not record when signing began');
  }
}

/** The ISO time, or null. Cached for a minute; read by every offline-list page. */
async function since(now = Date.now()) {
  if (!qrSigning.signingKey()) return null;
  if (now - cache.at < CACHE_MS) return cache.value;
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) {
    logger.warn({ err: error.message }, 'qr v2: could not read when signing began');
    return null;
  }
  const value = typeof data?.value?.since === 'string' && !Number.isNaN(Date.parse(data.value.since))
    ? data.value.since : null;
  cache = { at: now, value };
  return value;
}

/** Tests change the setting between cases. */
function forget() {
  cache = { at: 0, value: null };
}

module.exports = { record, since, forget, KEY };
