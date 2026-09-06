const { supabase } = require('../config/supabase');
const { sendOk, sendFail } = require('../utils/responseEnvelope');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BRD §24 — table categories. "Front row", "Balcony", "Sponsor".
 *
 * Presentation, not pricing. A table carries its own `price_cents`, so a
 * category groups and colours tables on the map without changing what anything
 * costs. That separation is why deleting one is safe in a way deleting a tier
 * is not: `tables.category_id` is ON DELETE SET NULL, and a table that loses
 * its category keeps its price.
 *
 * `table_categories` has existed since the baseline and `saveMap` has always
 * accepted a `categoryId` on a table — with nothing anywhere able to create a
 * category to reference. This is that missing half.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SELECT = 'id, name, color, sort_order';

// A CSS hex colour. Anything else is refused rather than stored and rendered as
// a broken style, or worse reflected into a page as arbitrary text.
const HEX = /^#[0-9a-fA-F]{6}$/;

// ─── GET /events/:eventId/table-categories ──────────────────────────────────
async function list(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('table_categories')
      .select(SELECT)
      .eq('event_id', req.params.eventId)
      .order('sort_order')
      .order('name');

    if (error) throw new Error(error.message);

    // The table count per category, so the editor can show "3 tables" beside
    // one and an organizer can see what a rename or delete will affect.
    const { data: tables } = await supabase
      .from('tables')
      .select('category_id, venue_maps!inner ( event_id )')
      .eq('venue_maps.event_id', req.params.eventId)
      .not('category_id', 'is', null);

    const counts = new Map();
    for (const t of tables || []) {
      counts.set(t.category_id, (counts.get(t.category_id) || 0) + 1);
    }

    return sendOk(res, (data || []).map((c) => ({ ...shape(c), tableCount: counts.get(c.id) || 0 })));
  } catch (err) { return next(err); }
}

// ─── POST /events/:eventId/table-categories ─────────────────────────────────
async function create(req, res, next) {
  try {
    const color = req.body.color ? String(req.body.color).trim() : null;
    if (color && !HEX.test(color)) {
      return sendFail(res, {
        status: 400, error: 'VALIDATION_ERROR',
        message: 'A colour must be a six-digit hex value, e.g. #047857.',
      });
    }

    const { data, error } = await supabase
      .from('table_categories')
      .insert({
        event_id: req.params.eventId,
        name: String(req.body.name).trim(),
        color,
        sort_order: req.body.sortOrder === undefined ? 0 : Math.round(Number(req.body.sortOrder)),
      })
      .select(SELECT)
      .single();

    if (error) {
      // UNIQUE (event_id, name) is in the schema, so the race is handled by the
      // database rather than by a read-then-write that two requests can both win.
      if (error.code === '23505') {
        return sendFail(res, {
          status: 409, error: 'DUPLICATE_CATEGORY',
          message: `This event already has a category called "${String(req.body.name).trim()}".`,
        });
      }
      throw new Error(error.message);
    }

    return sendOk(res, { ...shape(data), tableCount: 0 }, { status: 201 });
  } catch (err) { return next(err); }
}

// ─── PATCH /events/:eventId/table-categories/:categoryId ────────────────────
async function update(req, res, next) {
  try {
    if (!(await owned(req))) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such category.' });
    }

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.sortOrder !== undefined) patch.sort_order = Math.round(Number(req.body.sortOrder));
    if (req.body.color !== undefined) {
      const color = req.body.color ? String(req.body.color).trim() : null;
      if (color && !HEX.test(color)) {
        return sendFail(res, {
          status: 400, error: 'VALIDATION_ERROR',
          message: 'A colour must be a six-digit hex value, e.g. #047857.',
        });
      }
      patch.color = color;
    }

    if (Object.keys(patch).length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Nothing to change.' });
    }

    const { data, error } = await supabase
      .from('table_categories').update(patch).eq('id', req.params.categoryId)
      .select(SELECT).single();

    if (error) {
      if (error.code === '23505') {
        return sendFail(res, {
          status: 409, error: 'DUPLICATE_CATEGORY',
          message: `This event already has a category called "${patch.name}".`,
        });
      }
      throw new Error(error.message);
    }

    return sendOk(res, shape(data));
  } catch (err) { return next(err); }
}

// ─── DELETE /events/:eventId/table-categories/:categoryId ───────────────────
/**
 * Allowed even when tables use it.
 *
 * Deliberately unlike deleting a tier. `tables.category_id` is ON DELETE SET
 * NULL and a category carries no price, so the tables simply become
 * uncategorised and keep selling at exactly the same price. The response says
 * how many were affected so the organizer is not surprised by the map.
 */
async function remove(req, res, next) {
  try {
    if (!(await owned(req))) {
      return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No such category.' });
    }

    const { count } = await supabase
      .from('tables').select('id', { count: 'exact', head: true })
      .eq('category_id', req.params.categoryId);

    const { error } = await supabase
      .from('table_categories').delete().eq('id', req.params.categoryId);
    if (error) throw new Error(error.message);

    return sendOk(res, {
      id: req.params.categoryId,
      deleted: true,
      tablesUncategorised: Number(count) || 0,
    });
  } catch (err) { return next(err); }
}

/**
 * The category must belong to the event in the URL — verifyEventOwner proves
 * the caller owns the EVENT and nothing about this id.
 */
async function owned(req) {
  const { data } = await supabase
    .from('table_categories')
    .select('id')
    .eq('id', req.params.categoryId)
    .eq('event_id', req.params.eventId)
    .maybeSingle();
  return !!data;
}

function shape(c) {
  return { id: c.id, name: c.name, color: c.color, sortOrder: Number(c.sort_order) };
}

module.exports = { list, create, update, remove };
