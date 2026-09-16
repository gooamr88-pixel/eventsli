const { sendOk, sendFail } = require('../../utils/responseEnvelope');
const { writeAudit } = require('../../services/auditService');
const storefront = require('../../services/storefrontService');
const categories = require('../../services/categoryService');
const siteMedia = require('../../services/siteMediaService');
const stats = require('../../services/statsService');
const { revalidate, LANDING_TAG } = require('../../services/revalidateService');
const { describe, CONTENT_KEYS } = require('../../utils/landingSchema');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The admin console's side of the storefront.
 *
 * Every write in this file does the same four things in the same order, and the
 * order is the interesting part:
 *
 *   1. apply the change
 *   2. write the audit entry
 *   3. drop the landing page's cache
 *   4. answer
 *
 * The audit entry comes before the cache hint because the change is already
 * committed by then: if the process dies between them, the trail records what
 * happened and a page is stale for a minute. The other order loses the record
 * of a change that took effect, and "who put that on the homepage" is a
 * question this console has to be able to answer.
 *
 * Step 3 never fails the request — see `revalidateService`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Wraps a handler so a StorefrontError becomes a sentence and anything else
 *  reaches the error middleware unchanged. Repeating this try/catch fourteen
 *  times is how one of them ends up subtly different. */
function handle(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (err) {
      if (err instanceof storefront.StorefrontError || err?.code === 'VALIDATION_ERROR') {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400;
        return sendFail(res, {
          status,
          error: err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code || 'VALIDATION_ERROR',
          message: err.message,
          meta: err.meta || undefined,
        });
      }
      return next(err);
    }
  };
}

/** After any storefront write. Fire-and-forget by design: the caller does not
 *  await a cache hint, and a slow frontend must not slow an admin's save. */
function touched() {
  stats.invalidate();
  revalidate([LANDING_TAG]).catch(() => {});
}

// ─── Content blocks ─────────────────────────────────────────────────────────

const getContent = handle(async (req, res) => sendOk(res, {
  content: await storefront.content(),
  // The field list travels with the values so the console renders itself from
  // the schema. A form that hard-codes its own fields is a second copy of
  // landingSchema.js that nothing compares against it.
  blocks: describe(),
}));

const putContent = handle(async (req, res) => {
  const { key } = req.params;
  if (!CONTENT_KEYS.includes(key)) {
    return sendFail(res, { status: 404, error: 'NOT_FOUND', message: `Not a content block: ${key}.` });
  }

  const before = (await storefront.content())[key];
  const value = await storefront.saveContent(key, req.body || {}, { userId: req.user.id });

  // Both values, not just the new one. "The hero says X" is not the question
  // anyone asks later; "who changed it, from what, and when" is.
  await writeAudit(req, {
    action: 'storefront.content_saved',
    targetType: 'site_content',
    targetId: key,
    payload: { before, after: value },
  });
  touched();
  return sendOk(res, { key, value });
});

// ─── Sponsors ───────────────────────────────────────────────────────────────

const listSponsors = handle(async (req, res) =>
  sendOk(res, { sponsors: await storefront.listSponsors() }));

const createSponsor = handle(async (req, res) => {
  const sponsor = await storefront.createSponsor(req.body || {});
  await writeAudit(req, {
    action: 'storefront.sponsor_created', targetType: 'sponsor', targetId: sponsor.id,
    payload: { name: sponsor.name, linkUrl: sponsor.linkUrl },
  });
  touched();
  return sendOk(res, { sponsor }, { status: 201 });
});

const updateSponsor = handle(async (req, res) => {
  const sponsor = await storefront.updateSponsor(req.params.id, req.body || {});
  await writeAudit(req, {
    action: 'storefront.sponsor_updated', targetType: 'sponsor', targetId: req.params.id,
    payload: { changed: Object.keys(req.body || {}) },
  });
  touched();
  return sendOk(res, { sponsor });
});

const deleteSponsor = handle(async (req, res) => {
  await storefront.deleteSponsor(req.params.id);
  await writeAudit(req, {
    action: 'storefront.sponsor_deleted', targetType: 'sponsor', targetId: req.params.id, payload: {},
  });
  touched();
  return sendOk(res, { deleted: true });
});

// ─── Testimonials ───────────────────────────────────────────────────────────

const listTestimonials = handle(async (req, res) =>
  sendOk(res, { testimonials: await storefront.listTestimonials() }));

const createTestimonial = handle(async (req, res) => {
  const testimonial = await storefront.createTestimonial(req.body || {});
  await writeAudit(req, {
    action: 'storefront.testimonial_created', targetType: 'testimonial', targetId: testimonial.id,
    payload: { authorName: testimonial.authorName, isPublished: testimonial.isPublished },
  });
  touched();
  return sendOk(res, { testimonial }, { status: 201 });
});

const updateTestimonial = handle(async (req, res) => {
  const testimonial = await storefront.updateTestimonial(req.params.id, req.body || {});
  await writeAudit(req, {
    action: 'storefront.testimonial_updated', targetType: 'testimonial', targetId: req.params.id,
    // Publishing is the change worth being able to find later: it is the moment
    // a quotation attributed to a named person became public.
    payload: { changed: Object.keys(req.body || {}), isPublished: testimonial.isPublished },
  });
  touched();
  return sendOk(res, { testimonial });
});

const deleteTestimonial = handle(async (req, res) => {
  await storefront.deleteTestimonial(req.params.id);
  await writeAudit(req, {
    action: 'storefront.testimonial_deleted', targetType: 'testimonial', targetId: req.params.id, payload: {},
  });
  touched();
  return sendOk(res, { deleted: true });
});

// ─── Categories ─────────────────────────────────────────────────────────────

const listCategories = handle(async (req, res) =>
  sendOk(res, { categories: await categories.list() }));

const createCategory = handle(async (req, res) => {
  let category;
  try {
    category = await categories.create(req.body || {});
  } catch (err) { throw storefront.constraintError(err); }

  await writeAudit(req, {
    action: 'storefront.category_created', targetType: 'event_category', targetId: category.slug,
    payload: { label: category.label },
  });
  touched();
  return sendOk(res, { category }, { status: 201 });
});

const updateCategory = handle(async (req, res) => {
  let category;
  try {
    category = await categories.update(req.params.slug, req.body || {});
  } catch (err) { throw storefront.constraintError(err); }

  if (!category) {
    return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'That category does not exist.' });
  }
  await writeAudit(req, {
    action: 'storefront.category_updated', targetType: 'event_category', targetId: req.params.slug,
    payload: { changed: Object.keys(req.body || {}) },
  });
  touched();
  return sendOk(res, { category });
});

/**
 * Deleting a category the database will refuse.
 *
 * The count is read FIRST so the refusal can name it. `ON DELETE RESTRICT`
 * would otherwise surface as a foreign-key violation, and an operator told
 * "violates foreign key constraint events_category_fk" has been given the right
 * information in the wrong language — and no idea that disabling is the action
 * they actually wanted.
 */
const deleteCategory = handle(async (req, res) => {
  const { slug } = req.params;
  const inUse = await categories.eventCount(slug);
  if (inUse > 0) {
    return sendFail(res, {
      status: 409,
      error: 'CONFLICT',
      message: `${inUse} event${inUse === 1 ? ' is' : 's are'} filed under this category. `
        + 'Move them first, or switch the category off to hide it from the site.',
      meta: { events: inUse },
    });
  }

  const removed = await categories.remove(slug);
  if (!removed) {
    return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'That category does not exist.' });
  }
  await writeAudit(req, {
    action: 'storefront.category_deleted', targetType: 'event_category', targetId: slug, payload: {},
  });
  touched();
  return sendOk(res, { deleted: true });
});

// ─── Reordering ─────────────────────────────────────────────────────────────

const REORDERABLE = {
  sponsors: { update: (id, order) => storefront.updateSponsor(id, { sortOrder: order }), idName: 'id' },
  testimonials: { update: (id, order) => storefront.updateTestimonial(id, { sortOrder: order }), idName: 'id' },
  categories: { update: (slug, order) => categories.update(slug, { sortOrder: order }), idName: 'slug' },
};

/**
 * Takes the ids in the order they should appear and writes positions 10, 20,
 * 30…
 *
 * Gaps of ten rather than 1, 2, 3, so a later single-row nudge has somewhere to
 * land without renumbering the list. Sequential order values are why "move this
 * one up" turns into an update of every row below it.
 *
 * Applied one at a time rather than in a batch upsert: an upsert here would
 * need the full row for each id, and sending a partial one to PostgREST's
 * upsert nulls every column the caller left out — which on this table would
 * silently erase a sponsor's logo the first time somebody reordered the list.
 */
const reorder = handle(async (req, res) => {
  const kind = REORDERABLE[req.params.kind];
  if (!kind) {
    return sendFail(res, { status: 404, error: 'NOT_FOUND', message: `Not a reorderable list: ${req.params.kind}.` });
  }

  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
    return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'Send the ids in their new order.' });
  }
  if (new Set(ids).size !== ids.length) {
    return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'The same item appears twice in that order.' });
  }

  for (const [index, id] of ids.entries()) {
    await kind.update(id, (index + 1) * 10);
  }

  await writeAudit(req, {
    action: 'storefront.reordered', targetType: req.params.kind, targetId: null, payload: { ids },
  });
  touched();
  return sendOk(res, { reordered: ids.length });
});

// ─── Uploads ────────────────────────────────────────────────────────────────

const signUpload = handle(async (req, res) => {
  try {
    const signed = await siteMedia.signUpload({
      scope: req.body?.scope,
      contentType: req.body?.contentType,
    });
    return sendOk(res, signed);
  } catch (err) {
    if (err instanceof siteMedia.SiteMediaError) {
      const status = err.code === 'STORAGE_NOT_CONFIGURED' ? 503
        : err.code === 'UNSUPPORTED_MEDIA_TYPE' ? 415 : 400;
      return sendFail(res, { status, error: err.code, message: err.message });
    }
    throw err;
  }
});

const confirmUpload = handle(async (req, res) => {
  try {
    const result = await siteMedia.confirm({ scope: req.body?.scope, path: req.body?.path });
    return sendOk(res, result);
  } catch (err) {
    if (err instanceof siteMedia.SiteMediaError) {
      const status = err.code === 'STORAGE_NOT_CONFIGURED' ? 503
        : err.code === 'NOT_FOUND' ? 404 : 400;
      return sendFail(res, { status, error: err.code, message: err.message });
    }
    throw err;
  }
});

module.exports = {
  getContent, putContent,
  listSponsors, createSponsor, updateSponsor, deleteSponsor,
  listTestimonials, createTestimonial, updateTestimonial, deleteTestimonial,
  listCategories, createCategory, updateCategory, deleteCategory,
  reorder, signUpload, confirmUpload,
};
