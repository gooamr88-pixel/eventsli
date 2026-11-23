const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IS SPONSORS / VENDORS SWITCHED ON FOR THIS EVENT? (owner, 2026-11-23)
 *
 * The organizer dashboard used to show Sponsors and Vendors on every event, as
 * two of eight links under "Sell". Most events — a wedding, a concert — have
 * neither, and the two biggest screens in the product sat in every sidebar
 * reading as something that had to be done. They are opt-in now: the event's
 * overview asks, and only an event that said yes shows them.
 *
 * NO NEW COLUMN. The switch is the program row each system already keeps
 * (`sponsorship_programs`, `vendor_programs`): turning on creates it, closed,
 * which is exactly what the "Sponsor page" / "Vendor page" settings save
 * would have created anyway. An event that already has a deal or an
 * application counts as on whether or not the row exists, so nothing an
 * organizer started before this change disappears from their sidebar.
 *
 * TURNING OFF is refused once there is a deal or an application — hiding a
 * sponsor who has signed, or a vendor who has paid, would hide money. With
 * none, it removes the program row only; packages and booth types stay, and
 * come back if the organizer turns it on again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KINDS = Object.freeze({
  // `shown`: sponsors added by hand to the event page (event_sponsors). They
  // live on the Sponsors screen now, so an event that has any counts as on.
  sponsors: { program: 'sponsorship_programs', work: 'sponsorship_deals', shown: 'event_sponsors', noun: 'sponsorship deal' },
  vendors: { program: 'vendor_programs', work: 'vendor_applications', noun: 'vendor application' },
});

class PartnerSwitchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function eventIdsIn(table, ids) {
  const { data, error } = await supabase.from(table).select('event_id').in('event_id', ids);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.event_id));
}

/**
 * `Map<eventId, { sponsors, vendors }>` for the given events. Five reads for
 * the whole list, never one per event.
 */
async function partnersOn(eventIds) {
  const ids = [...new Set((eventIds || []).filter(Boolean))];
  const out = new Map(ids.map((id) => [id, { sponsors: false, vendors: false }]));
  if (!ids.length) return out;
  const [sp, sd, ss, vp, va] = await Promise.all([
    eventIdsIn(KINDS.sponsors.program, ids),
    eventIdsIn(KINDS.sponsors.work, ids),
    eventIdsIn(KINDS.sponsors.shown, ids),
    eventIdsIn(KINDS.vendors.program, ids),
    eventIdsIn(KINDS.vendors.work, ids),
  ]);
  for (const id of ids) {
    out.set(id, { sponsors: sp.has(id) || sd.has(id) || ss.has(id), vendors: vp.has(id) || va.has(id) });
  }
  return out;
}

function kindOf(kind) {
  const k = KINDS[kind];
  if (!k) throw new PartnerSwitchError('VALIDATION_ERROR', 'Choose sponsors or vendors.');
  return k;
}

/** Creates the program row, closed. Already on is not an error. */
async function turnOn(kind, eventId) {
  const k = kindOf(kind);
  const { error } = await supabase.from(k.program)
    .upsert({ event_id: eventId }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return { [kind]: true };
}

async function turnOff(kind, eventId) {
  const k = kindOf(kind);
  const { count, error } = await supabase.from(k.work)
    .select('id', { count: 'exact', head: true }).eq('event_id', eventId);
  if (error) throw new Error(error.message);
  if (count > 0) {
    throw new PartnerSwitchError(
      'CONFLICT',
      `This event already has ${count === 1 ? `a ${k.noun}` : `${count} ${k.noun}s`}, so it stays on. Close the public page instead to stop new ones.`,
    );
  }
  if (k.shown) {
    const { count: shown, error: shownError } = await supabase.from(k.shown)
      .select('id', { count: 'exact', head: true }).eq('event_id', eventId);
    if (shownError) throw new Error(shownError.message);
    if (shown > 0) {
      throw new PartnerSwitchError(
        'CONFLICT',
        `Your event page shows ${shown === 1 ? 'a sponsor' : `${shown} sponsors`}. Remove ${shown === 1 ? 'it' : 'them'} first, then turn sponsors off.`,
      );
    }
  }
  const { error: delError } = await supabase.from(k.program).delete().eq('event_id', eventId);
  if (delError) throw new Error(delError.message);
  return { [kind]: false };
}

module.exports = { partnersOn, turnOn, turnOff, PartnerSwitchError, KINDS };
