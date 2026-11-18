const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { cleanLook } = require('./venueStudio');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Saved seating-map looks (2026-11-18): an organizer's own themes for the
 * Venue Builder, kept on their organizers row (`map_looks`, migration
 * 20261128090000) so the next event's map can start from the same look.
 *
 * At most MAX_LOOKS, each cleaned by the same rule as a map's own look
 * (venueStudio.cleanLook) plus an id and a name. The column's absence (the
 * migration not applied yet) reads as no saved looks, and a save says so.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_LOOKS = 12;

class LookError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function missingColumn(error) {
  return error && /map_looks/.test(String(error.message || '')) && /column|does not exist/i.test(String(error.message || ''));
}

/** One saved look, cleaned, or null. A look with no colour at all is nothing. */
function cleanSaved(raw) {
  const look = cleanLook(raw);
  if (!look) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : 'My look';
  const id = typeof raw.id === 'string' && /^[a-z0-9_-]{4,40}$/i.test(raw.id) ? raw.id : `look_${crypto.randomUUID().slice(0, 8)}`;
  return { ...look, id, name };
}

function cleanList(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const look = raw && typeof raw === 'object' ? cleanSaved(raw) : null;
    if (!look || seen.has(look.id)) continue;
    seen.add(look.id);
    out.push(look);
    if (out.length >= MAX_LOOKS) break;
  }
  return out;
}

async function listForOwner(userId) {
  const { data, error } = await supabase.from('organizers').select('map_looks').eq('owner_user_id', userId).maybeSingle();
  if (missingColumn(error)) return [];
  if (error) throw new Error(`map looks: read failed: ${error.message}`);
  return cleanList(data?.map_looks);
}

/** Replaces the organizer's saved looks with this list (cleaned, capped). */
async function saveForOwner(userId, looks) {
  if (!Array.isArray(looks)) throw new LookError('VALIDATION_ERROR', 'Send the list of looks to keep.');
  if (looks.length > MAX_LOOKS) {
    throw new LookError('VALIDATION_ERROR', `You can keep up to ${MAX_LOOKS} saved looks. Remove one to save another.`);
  }
  const clean = cleanList(looks);
  const { data, error } = await supabase.from('organizers')
    .update({ map_looks: clean }).eq('owner_user_id', userId).select('map_looks').maybeSingle();
  if (missingColumn(error)) {
    throw new LookError('FEATURE_DISABLED', 'Saved looks are not switched on yet. Your map keeps its look when you save it.');
  }
  if (error) throw new Error(`map looks: save failed: ${error.message}`);
  if (!data) throw new LookError('NOT_FOUND', 'Set up your organization first.');
  return cleanList(data.map_looks);
}

module.exports = { listForOwner, saveForOwner, cleanList, MAX_LOOKS, LookError };
