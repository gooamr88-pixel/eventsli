/**
 * What an audience segment may filter on, validated before it is stored.
 *
 * A segment is a JSON definition evaluated by `sms_segment_audience` (buyers of
 * paid orders) plus `recipientCountries`, applied after phone normalisation.
 * Unknown keys are refused rather than stored and ignored: a filter an admin
 * believes they set, silently not applied, is a campaign to the wrong people.
 *
 * Pure.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO2 = /^[A-Z]{2}$/;

const RULES = {
  eventIds: { list: UUID, max: 200 },
  organizerIds: { list: UUID, max: 200 },
  eventCountries: { list: ISO2, max: 250 },
  recipientCountries: { list: ISO2, max: 250 },
  purchasedWithinDays: { int: [1, 3650] },
  minOrders: { int: [1, 100] },
  attendedOnly: { bool: true },
};

/** @returns {{ value: object } | { error: string }} */
function normalizeDefinition(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return { error: 'The segment definition must be an object.' };
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    const rule = RULES[key];
    if (!rule) return { error: `Unknown segment filter: ${key}.` };
    if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue;
    if (rule.list) {
      if (!Array.isArray(raw)) return { error: `${key} must be a list.` };
      const values = [...new Set(raw.map((v) => String(v).trim()).map((v) => (rule.list === ISO2 ? v.toUpperCase() : v.toLowerCase())))];
      if (values.length > rule.max) return { error: `${key} can hold at most ${rule.max} values.` };
      if (!values.every((v) => rule.list.test(v))) return { error: `${key} contains a value that is not valid.` };
      out[key] = values;
    } else if (rule.int) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < rule.int[0] || n > rule.int[1]) return { error: `${key} must be a whole number from ${rule.int[0]} to ${rule.int[1]}.` };
      out[key] = n;
    } else if (rule.bool) {
      if (typeof raw !== 'boolean') return { error: `${key} must be true or false.` };
      if (raw) out[key] = true;
    }
  }
  return { value: out };
}

/** One line a human can read back: "Buyers of 2 events · attended · CA, US". */
function describe(def = {}) {
  const parts = [];
  if (def.eventIds) parts.push(`buyers of ${def.eventIds.length} event${def.eventIds.length === 1 ? '' : 's'}`);
  if (def.organizerIds) parts.push(`${def.organizerIds.length} organizer${def.organizerIds.length === 1 ? '' : 's'}`);
  if (def.eventCountries) parts.push(`events in ${def.eventCountries.join(', ')}`);
  if (def.recipientCountries) parts.push(`numbers in ${def.recipientCountries.join(', ')}`);
  if (def.purchasedWithinDays) parts.push(`bought in the last ${def.purchasedWithinDays} days`);
  if (def.minOrders && def.minOrders > 1) parts.push(`${def.minOrders}+ orders`);
  if (def.attendedOnly) parts.push('checked in');
  return parts.length ? parts.join(' · ') : 'Every buyer with a phone number';
}

module.exports = { normalizeDefinition, describe, RULES };
