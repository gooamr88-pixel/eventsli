const express = require('express');
const { body, param } = require('express-validator');
const validate = require('../../middleware/validate');
const c = require('../../controllers/admin/storefrontController');

/**
 * The homepage's content, under the admin guard.
 *
 * Guarded by routes/admin/index.js (requireAuth + admin). Mount it only there —
 * every route in this file writes something that appears on the front page of
 * the site to everybody, signed in or not.
 *
 * VALIDATION IS THIN HERE ON PURPOSE. The real shapes live in
 * `utils/landingSchema.js` and in the table constraints, both of which are
 * testable without a request. What this layer does is refuse the wrong TYPE
 * early — a body that is an array, an id that is not a UUID — so a controller
 * never has to guess what it was handed. Duplicating the field rules here would
 * create a second copy that drifts, and the copy in the route is the one nobody
 * remembers to update.
 */
const router = express.Router();

// ─── Content blocks ─────────────────────────────────────────────────────────
router.get('/storefront/content', c.getContent);

router.put(
  '/storefront/content/:key',
  param('key').isString().isLength({ min: 1, max: 40 }),
  // The block's own fields are checked by landingSchema, which refuses unknown
  // ones. This only rules out a body that could not be a block at all.
  body().custom((v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('Send the block\'s fields.');
    return true;
  }),
  validate,
  c.putContent,
);

// ─── Sponsors ───────────────────────────────────────────────────────────────
router.get('/storefront/sponsors', c.listSponsors);

router.post(
  '/storefront/sponsors',
  body('name').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('A sponsor needs a name.'),
  body('linkUrl').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('A sponsor link must start with http:// or https://.'),
  body('blurb').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isEnabled').optional().isBoolean().toBoolean(),
  validate,
  c.createSponsor,
);

router.patch(
  '/storefront/sponsors/:id',
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('linkUrl').optional({ values: 'null' }).custom(isHttpOrEmpty)
    .withMessage('A sponsor link must start with http:// or https://.'),
  body('blurb').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isEnabled').optional().isBoolean().toBoolean(),
  validate,
  c.updateSponsor,
);

router.delete('/storefront/sponsors/:id', param('id').isUUID(), validate, c.deleteSponsor);

// ─── Testimonials ───────────────────────────────────────────────────────────
router.get('/storefront/testimonials', c.listTestimonials);

router.post(
  '/storefront/testimonials',
  body('authorName').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('A testimonial needs an author name.'),
  body('body').isString().trim().isLength({ min: 1, max: 1200 })
    .withMessage('A testimonial needs a quote.'),
  body('authorRole').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
  body('rating').optional({ values: 'null' }).isInt({ min: 1, max: 5 }).toInt(),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isPublished').optional().isBoolean().toBoolean(),
  validate,
  c.createTestimonial,
);

router.patch(
  '/storefront/testimonials/:id',
  param('id').isUUID(),
  body('authorName').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('body').optional().isString().trim().isLength({ min: 1, max: 1200 }),
  body('authorRole').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  body('rating').optional({ values: 'null' }).isInt({ min: 1, max: 5 }).toInt(),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isPublished').optional().isBoolean().toBoolean(),
  validate,
  c.updateTestimonial,
);

router.delete('/storefront/testimonials/:id', param('id').isUUID(), validate, c.deleteTestimonial);

// ─── Categories ─────────────────────────────────────────────────────────────
router.get('/storefront/categories', c.listCategories);

router.post(
  '/storefront/categories',
  // The same shape the table's CHECK enforces, refused here so the operator
  // gets a sentence about slugs rather than a constraint name.
  body('slug').isString().trim().toLowerCase().matches(/^[a-z][a-z0-9_]{1,38}$/)
    .withMessage('A category id is lowercase letters, numbers and underscores, like food_drink.'),
  body('label').isString().trim().isLength({ min: 1, max: 60 })
    .withMessage('A category needs a name.'),
  body('blurb').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isEnabled').optional().isBoolean().toBoolean(),
  validate,
  c.createCategory,
);

router.patch(
  '/storefront/categories/:slug',
  param('slug').isString().trim().isLength({ min: 2, max: 40 }),
  // `slug` is absent: renaming the key of a row that events point at is an
  // ON UPDATE CASCADE across the events table, and it is not a thing to offer
  // behind an inline edit on a list. Delete and recreate, or edit the label.
  body('label').optional().isString().trim().isLength({ min: 1, max: 60 }),
  body('blurb').optional({ values: 'null' }).isString().trim().isLength({ max: 300 }),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isEnabled').optional().isBoolean().toBoolean(),
  validate,
  c.updateCategory,
);

router.delete(
  '/storefront/categories/:slug',
  param('slug').isString().trim().isLength({ min: 2, max: 40 }),
  validate,
  c.deleteCategory,
);

// ─── Reordering ─────────────────────────────────────────────────────────────
router.post(
  '/storefront/:kind/order',
  param('kind').isIn(['sponsors', 'testimonials', 'categories']),
  body('ids').isArray({ min: 1, max: 200 }).withMessage('Send the ids in their new order.'),
  body('ids.*').isString().trim().isLength({ min: 1, max: 60 }),
  validate,
  c.reorder,
);

// ─── Uploads ────────────────────────────────────────────────────────────────
/**
 * Two steps, the same as an event cover: sign, PUT the bytes straight to
 * storage, then confirm. The browser never holds a Supabase key and the server
 * never accepts a URL somebody else chose — see `siteMediaService`.
 */
router.post(
  '/storefront/uploads/sign',
  body('scope').isIn(['hero', 'sections', 'sponsors', 'testimonials', 'categories', 'video']),
  body('contentType').isIn(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  validate,
  c.signUpload,
);

router.post(
  '/storefront/uploads/confirm',
  body('scope').isIn(['hero', 'sections', 'sponsors', 'testimonials', 'categories', 'video']),
  body('path').isString().trim().isLength({ min: 3, max: 400 }),
  validate,
  c.confirmUpload,
);

/** An empty string clears the link; anything else must be a real http(s) URL.
 *  `isURL` alone rejects the empty string, which is how "remove this link"
 *  becomes an error message. */
function isHttpOrEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') throw new Error('not a link');
  if (!/^https?:\/\/[^\s]{3,2000}$/i.test(value.trim())) throw new Error('not a link');
  return true;
}

module.exports = router;
