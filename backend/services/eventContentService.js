const { supabase } = require('../config/supabase');
const media = require('./mediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's content: gallery and video, sponsors, policies, schedule.
 *
 * Four small collections that behave the same way — list, add, edit, reorder,
 * remove, all scoped to one event — so they share one module and one set of
 * rules rather than four controllers that each re-decide them.
 *
 *
 * NONE OF THIS IS STOCK, AND THAT IS THE ORGANISING FACT.
 *
 * Nothing here can be held, sold, refunded or scanned. No row has a price, a
 * quantity or a status. Which means the whole apparatus that surrounds the seat
 * map — row locks, allocation checks, "is it booked" guards, the refusal to
 * shrink something somebody paid for — is absent on purpose, and its absence is
 * not an oversight to be corrected later. A sponsor logo deleted by mistake
 * costs a re-upload.
 *
 * The consequence for the reader: if a rule ever DOES appear in this file, it
 * is about what a public page will render, never about money.
 *
 *
 * OWNERSHIP IS CHECKED ONCE, AT THE DOOR.
 *
 * Every function takes `eventId` and filters on it. The route has already run
 * `verifyEventOwner`, and the API uses the service-role client, so there is no
 * row-level security underneath to catch a missing filter. That makes the
 * `.eq('event_id', eventId)` on every single query load-bearing rather than
 * tidy — without it, an id from the URL reaches another organizer's row.
 *
 *
 * ORDERING IS THE ORGANIZER'S, NOT THE DATABASE'S.
 *
 * Every collection carries `sort_order`, written by the editor as a whole list.
 * Sponsors sort by LEVEL first and then by that order, because a headline
 * sponsor sitting below a partner is the one arrangement error nobody is
 * allowed to make by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The API's shape for each collection. Ceilings included: a public page has to
 *  stay a page, and an unbounded gallery is a page that never finishes loading. */
const COLLECTIONS = Object.freeze({
  media: {
    table: 'event_media',
    max: 30,
    order: [['sort_order', {}], ['created_at', {}]],
    shape: (r) => ({
      id: r.id,
      kind: r.kind,
      url: r.url,
      caption: r.caption,
      sortOrder: r.sort_order,
    }),
  },
  sponsors: {
    table: 'event_sponsors',
    max: 60,
    order: [['level', {}], ['sort_order', {}]],
    shape: (r) => ({
      id: r.id,
      name: r.name,
      logoUrl: r.logo_url,
      linkUrl: r.link_url,
      level: r.level,
      sortOrder: r.sort_order,
    }),
  },
  policies: {
    table: 'event_policies',
    max: 12,
    order: [['sort_order', {}], ['created_at', {}]],
    shape: (r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      showAtCheckout: r.show_at_checkout,
      sortOrder: r.sort_order,
    }),
  },
  schedule: {
    table: 'event_schedule',
    max: 200,
    // Time first: a lineup is read in the order it happens. `sort_order` breaks
    // the tie for two things at once and orders the rows with no time at all,
    // which is how an organizer sketches a running order before it is fixed.
    order: [['starts_at', { nullsFirst: false }], ['sort_order', {}]],
    shape: (r) => ({
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      title: r.title,
      description: r.description,
      location: r.location,
      sortOrder: r.sort_order,
    }),
  },
});

class ContentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function collection(name) {
  const c = COLLECTIONS[name];
  if (!c) throw new ContentError('VALIDATION_ERROR', 'Unknown section.');
  return c;
}

/** Everything in one collection for one event, in the organizer's order. */
async function list(name, eventId) {
  const c = collection(name);
  let q = supabase.from(c.table).select('*').eq('event_id', eventId);
  for (const [column, opts] of c.order) q = q.order(column, opts);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(c.shape);
}

/**
 * Adds one row, refusing past the ceiling.
 *
 * The count and the insert are two statements, so two requests arriving
 * together can both pass the count and both insert. Deliberately not locked:
 * the failure is one row over a soft display limit, by the same organizer, in
 * their own editor — and the alternative is a row lock on the event for every
 * gallery image added. The ceiling is here to stop a runaway list, not to be
 * exact to the row.
 */
async function add(name, eventId, row) {
  const c = collection(name);

  const { count, error: countError } = await supabase
    .from(c.table).select('id', { count: 'exact', head: true }).eq('event_id', eventId);
  if (countError) throw new Error(countError.message);

  if ((count || 0) >= c.max) {
    throw new ContentError(
      'VALIDATION_ERROR',
      `This event already has ${c.max} of those, which is the most it can hold.`,
      409,
    );
  }

  const { data, error } = await supabase
    .from(c.table).insert({ ...row, event_id: eventId }).select('*').single();
  if (error) throw new Error(error.message);
  return c.shape(data);
}

/**
 * Edits one row.
 *
 * `.eq('event_id', eventId)` beside the id is the ownership check. Without it,
 * an id lifted from another organizer's public page would be editable by
 * anyone who owns any event at all — the route's `verifyEventOwner` proves who
 * owns the EVENT, and nothing else proves the row belongs to it.
 */
async function update(name, eventId, id, patch) {
  const c = collection(name);
  if (Object.keys(patch).length === 0) {
    const current = await list(name, eventId);
    const found = current.find((r) => r.id === id);
    if (!found) throw new ContentError('NOT_FOUND', 'That item no longer exists.', 404);
    return found;
  }

  const { data, error } = await supabase
    .from(c.table).update(patch).eq('id', id).eq('event_id', eventId).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ContentError('NOT_FOUND', 'That item no longer exists.', 404);
  return c.shape(data);
}

/**
 * Removes one row, and the image behind it.
 *
 * The row goes first and the object second, which is the opposite order to the
 * cover's replace. It is the right way round here for the same reason it is the
 * wrong way round there: deleting means the image should stop being shown, so
 * the visible half is what has to succeed. An orphaned object costs storage; a
 * deleted object with a row still pointing at it is a broken image on a public
 * page.
 */
async function remove(name, eventId, id) {
  const c = collection(name);

  const { data, error } = await supabase
    .from(c.table).delete().eq('id', id).eq('event_id', eventId).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ContentError('NOT_FOUND', 'That item no longer exists.', 404);

  const path = data.path || data.logo_path;
  if (path) await media.remove(path);

  return { id };
}

/**
 * Writes a whole ordering in one go.
 *
 * Reordering is a drag, and a drag moves everything below what was dragged —
 * so this takes the finished list rather than one row's new position. Sending
 * one row at a time would be N requests for one gesture, and any of them
 * failing leaves an order nobody chose.
 *
 * Ids not belonging to this event are silently skipped rather than refused: the
 * `.eq('event_id')` filter is what makes that safe, and a reorder that fails
 * wholesale because one stale id rode along is a worse outcome for a gesture
 * the organizer cannot repeat precisely.
 */
async function reorder(name, eventId, ids) {
  const c = collection(name);
  // Not named `list` — that is this module's own exported function, and
  // shadowing it here works only for as long as nobody adds a call to it.
  const ordered = Array.isArray(ids) ? ids.slice(0, c.max) : [];
  if (ordered.length === 0) return { ok: true, count: 0 };

  let done = 0;
  for (const [index, id] of ordered.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase
      .from(c.table).update({ sort_order: index })
      .eq('id', id).eq('event_id', eventId)
      .select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (data) done += 1;
  }

  return { ok: true, count: done };
}

/** Everything a public event page needs, in one round trip. */
async function publicBundle(eventId) {
  const [gallery, sponsors, policies, schedule] = await Promise.all([
    list('media', eventId),
    list('sponsors', eventId),
    list('policies', eventId),
    list('schedule', eventId),
  ]);
  return { gallery, sponsors, policies, schedule };
}

module.exports = {
  COLLECTIONS,
  ContentError,
  list,
  add,
  update,
  remove,
  reorder,
  publicBundle,
};
