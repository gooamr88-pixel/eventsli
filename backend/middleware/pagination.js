/**
 * One pagination contract for every list endpoint.
 *
 *   ?page=1&limit=25&sort=created_at&order=desc&q=search
 *   → { success: true, data: [...], pagination: { page, limit, total, totalPages } }
 *
 * Applied everywhere so a client never has to discover, per endpoint, whether a
 * list is complete. An unbounded list endpoint works fine until the first
 * organizer with 40,000 attendees, and then it takes the API down.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * @param {import('express').Request} req
 * @param {object}   [opts]
 * @param {string[]} [opts.sortable]    whitelist of sortable columns
 * @param {string}   [opts.defaultSort]
 */
function parsePagination(req, { sortable = [], defaultSort = 'created_at' } = {}) {
  let page = parseInt(req.query.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  // A whitelist, not a sanitiser: `sort` reaches PostgREST as a column name, so
  // anything not on the list must be discarded rather than escaped.
  const requested = String(req.query.sort || '');
  const sort = sortable.includes(requested) ? requested : defaultSort;

  const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  // Bounded so a giant query string cannot be pushed into a LIKE.
  const q = String(req.query.q || '').trim().slice(0, 200);

  const from = (page - 1) * limit;
  return { page, limit, sort, order, q, from, to: from + limit - 1 };
}

/** Applies range + ordering to a Supabase query builder. */
function applyPagination(query, p) {
  return query.order(p.sort, { ascending: p.order === 'asc' }).range(p.from, p.to);
}

/** Builds the `pagination` block from a Supabase `count`. */
function buildMeta(p, total) {
  const t = Number(total) || 0;
  return {
    page: p.page,
    limit: p.limit,
    total: t,
    totalPages: Math.max(1, Math.ceil(t / p.limit)),
  };
}

module.exports = { parsePagination, applyPagination, buildMeta, DEFAULT_LIMIT, MAX_LIMIT };
