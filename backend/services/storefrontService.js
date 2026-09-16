const { supabase } = require('../config/supabase');
const { CONTENT_KEYS, defaultsFor, allDefaults, validateContent } = require('../utils/landingSchema');
const siteMedia = require('./siteMediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sponsors, testimonials and the landing page's content blocks.
 *
 * Three tables behind one module because they are one feature — everything the
 * homepage renders that an admin owns — and because they share the two rules
 * that are easy to get wrong separately:
 *
 *   1. A PUBLIC read returns only what is meant to be seen, and the filter is
 *      here rather than in each caller. `listSponsors({ publicOnly: true })` is
 *      one function away from `listSponsors()`, and the admin console and the
 *      homepage call the same one with different arguments — so an unpublished
 *      testimonial cannot reach the front page by way of a forgotten `.eq()`.
 *
 *   2. A stored image is two values, a URL and an object key, and deleting the
 *      row has to delete the object. Otherwise the bucket accumulates every
 *      logo anybody ever uploaded, and nothing points at them.
 *
 * Ordering is `sort_order` then `created_at`. The tiebreak is not decoration:
 * every row is created with `sort_order` 0 until somebody arranges them, and
 * without a second key the order of an unarranged list is whatever Postgres
 * feels like — which changes between reads and makes the homepage's sponsor row
 * shuffle on every cache miss.
 * ─────────────────────────────────────────────────────────────────────────────
 */

class StorefrontError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.code = code;
    this.meta = meta || null;
  }
}

// ─── Sponsors ───────────────────────────────────────────────────────────────

const SPONSOR_COLUMNS = 'id, name, logo_url, logo_path, link_url, blurb, sort_order, is_enabled, created_at, updated_at';

function shapeSponsor(row, { publicView }) {
  const base = {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url || null,
    linkUrl: row.link_url || null,
    blurb: row.blurb || null,
  };
  if (publicView) return base;
  return {
    ...base,
    logoPath: row.logo_path || null,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.publicOnly]  enabled, and with a logo
 *
 * A sponsor with no logo is excluded from the public list. The section is a row
 * of marks; a name in text among seven logos reads as the one that failed to
 * load, and the operator who half-created it is the only person who would know
 * otherwise.
 */
async function listSponsors({ publicOnly = false } = {}) {
  let query = supabase.from('sponsors').select(SPONSOR_COLUMNS);
  if (publicOnly) query = query.eq('is_enabled', true).not('logo_url', 'is', null);

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map((row) => shapeSponsor(row, { publicView: publicOnly }));
}

async function createSponsor(fields) {
  const { data, error } = await supabase
    .from('sponsors')
    .insert(toSponsorRow(fields, { creating: true }))
    .select(SPONSOR_COLUMNS)
    .single();

  if (error) throw constraintError(error);
  return shapeSponsor(data, { publicView: false });
}

async function updateSponsor(id, fields) {
  const patch = toSponsorRow(fields, { creating: false });
  if (Object.keys(patch).length === 0) {
    throw new StorefrontError('VALIDATION_ERROR', 'Nothing to update.');
  }

  // Read first, so a replaced logo's object can be deleted afterwards. Skipping
  // this is how a bucket ends up holding every version of every logo.
  const previous = await sponsorById(id);
  const { data, error } = await supabase
    .from('sponsors').update(patch).eq('id', id)
    .select(SPONSOR_COLUMNS).single();

  if (error) throw constraintError(error);

  if (previous?.logo_path && patch.logo_path && patch.logo_path !== previous.logo_path) {
    await siteMedia.remove(previous.logo_path);
  }
  return shapeSponsor(data, { publicView: false });
}

async function deleteSponsor(id) {
  const previous = await sponsorById(id);
  if (!previous) throw new StorefrontError('NOT_FOUND', 'That sponsor does not exist.');

  const { error } = await supabase.from('sponsors').delete().eq('id', id);
  if (error) throw new Error(error.message);

  // After the row is gone, never before: the other order leaves a sponsor
  // pointing at an object that no longer exists if the delete fails.
  if (previous.logo_path) await siteMedia.remove(previous.logo_path);
  return true;
}

async function sponsorById(id) {
  const { data, error } = await supabase
    .from('sponsors').select(SPONSOR_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function toSponsorRow(fields, { creating }) {
  const row = {};
  if (fields.name !== undefined) row.name = String(fields.name).trim();
  if (fields.linkUrl !== undefined) row.link_url = emptyToNull(fields.linkUrl);
  if (fields.blurb !== undefined) row.blurb = emptyToNull(fields.blurb);
  if (fields.sortOrder !== undefined) row.sort_order = Number(fields.sortOrder);
  if (fields.isEnabled !== undefined) row.is_enabled = !!fields.isEnabled;
  // The pair moves together or not at all — the database has the same rule as a
  // CHECK, and sending one of the two would be a constraint violation rendered
  // to the operator as a database error rather than as a sentence.
  if (fields.logoUrl !== undefined || fields.logoPath !== undefined) {
    row.logo_url = emptyToNull(fields.logoUrl);
    row.logo_path = emptyToNull(fields.logoPath);
  }
  if (creating && row.name === undefined) {
    throw new StorefrontError('VALIDATION_ERROR', 'A sponsor needs a name.');
  }
  return row;
}

// ─── Testimonials ───────────────────────────────────────────────────────────

const TESTIMONIAL_COLUMNS = 'id, author_name, author_role, body, avatar_url, avatar_path, rating, sort_order, is_published, created_at, updated_at';

function shapeTestimonial(row, { publicView }) {
  const base = {
    id: row.id,
    authorName: row.author_name,
    authorRole: row.author_role || null,
    body: row.body,
    avatarUrl: row.avatar_url || null,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
  };
  if (publicView) return base;
  return {
    ...base,
    avatarPath: row.avatar_path || null,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listTestimonials({ publicOnly = false } = {}) {
  let query = supabase.from('testimonials').select(TESTIMONIAL_COLUMNS);
  if (publicOnly) query = query.eq('is_published', true);

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map((row) => shapeTestimonial(row, { publicView: publicOnly }));
}

async function createTestimonial(fields) {
  const { data, error } = await supabase
    .from('testimonials')
    .insert(toTestimonialRow(fields, { creating: true }))
    .select(TESTIMONIAL_COLUMNS)
    .single();

  if (error) throw constraintError(error);
  return shapeTestimonial(data, { publicView: false });
}

async function updateTestimonial(id, fields) {
  const patch = toTestimonialRow(fields, { creating: false });
  if (Object.keys(patch).length === 0) {
    throw new StorefrontError('VALIDATION_ERROR', 'Nothing to update.');
  }

  const previous = await testimonialById(id);
  const { data, error } = await supabase
    .from('testimonials').update(patch).eq('id', id)
    .select(TESTIMONIAL_COLUMNS).single();

  if (error) throw constraintError(error);

  if (previous?.avatar_path && patch.avatar_path && patch.avatar_path !== previous.avatar_path) {
    await siteMedia.remove(previous.avatar_path);
  }
  return shapeTestimonial(data, { publicView: false });
}

async function deleteTestimonial(id) {
  const previous = await testimonialById(id);
  if (!previous) throw new StorefrontError('NOT_FOUND', 'That testimonial does not exist.');

  const { error } = await supabase.from('testimonials').delete().eq('id', id);
  if (error) throw new Error(error.message);

  if (previous.avatar_path) await siteMedia.remove(previous.avatar_path);
  return true;
}

async function testimonialById(id) {
  const { data, error } = await supabase
    .from('testimonials').select(TESTIMONIAL_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function toTestimonialRow(fields, { creating }) {
  const row = {};
  if (fields.authorName !== undefined) row.author_name = String(fields.authorName).trim();
  if (fields.authorRole !== undefined) row.author_role = emptyToNull(fields.authorRole);
  if (fields.body !== undefined) row.body = String(fields.body).trim();
  if (fields.sortOrder !== undefined) row.sort_order = Number(fields.sortOrder);
  if (fields.isPublished !== undefined) row.is_published = !!fields.isPublished;
  if (fields.rating !== undefined) {
    // An explicit null clears it. `Number(null)` is 0, which the CHECK refuses,
    // so the distinction has to be made before the cast.
    row.rating = fields.rating === null || fields.rating === '' ? null : Number(fields.rating);
  }
  if (fields.avatarUrl !== undefined || fields.avatarPath !== undefined) {
    row.avatar_url = emptyToNull(fields.avatarUrl);
    row.avatar_path = emptyToNull(fields.avatarPath);
  }
  if (creating && (row.author_name === undefined || row.body === undefined)) {
    throw new StorefrontError('VALIDATION_ERROR', 'A testimonial needs a name and a quote.');
  }
  return row;
}

// ─── Content blocks ─────────────────────────────────────────────────────────

/**
 * Every block, defaults filled in.
 *
 * A key with no row means "the shipped copy", so this merges rather than
 * returning what happens to be stored. The merge is per FIELD, not per key: a
 * block saved before a field was added to the schema would otherwise render
 * that field as blank forever.
 */
async function content() {
  const { data, error } = await supabase.from('site_content').select('key, value');
  if (error) throw new Error(error.message);

  const stored = Object.fromEntries((data || []).map((r) => [r.key, r.value || {}]));
  const out = allDefaults();
  for (const key of CONTENT_KEYS) {
    out[key] = { ...out[key], ...(stored[key] || {}) };
  }
  return out;
}

/**
 * Save one block.
 *
 * The whole block is written, not a patch — see `validateContent`. The previous
 * value is read first so that replacing an image deletes the old object; three
 * image pairs can change in one save, so they are swept as a set.
 */
async function saveContent(key, value, { userId } = {}) {
  const result = validateContent(key, value, { mediaPrefix: siteMedia.publicPrefix() });
  if (!result.ok) throw new StorefrontError('VALIDATION_ERROR', result.errors.join(' '), { errors: result.errors });

  const { data: before } = await supabase
    .from('site_content').select('value').eq('key', key).maybeSingle();

  const { data, error } = await supabase
    .from('site_content')
    .upsert({ key, value: result.value, updated_by: userId || null, updated_at: new Date().toISOString() })
    .select('key, value')
    .single();

  if (error) throw constraintError(error);

  const old = before?.value || {};
  for (const pathField of ['imagePath', 'mobileImagePath', 'posterPath']) {
    if (old[pathField] && old[pathField] !== result.value[pathField]) {
      await siteMedia.remove(old[pathField]);
    }
  }

  return { ...defaultsFor(key), ...(data.value || {}) };
}

// ─── Shared ─────────────────────────────────────────────────────────────────

const emptyToNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * A constraint violation is a sentence, not a stack trace.
 *
 * Postgres tells us which CHECK failed by name, and the names in the migration
 * were chosen to be readable. Without this, an operator who pastes a
 * `javascript:` link into a sponsor's URL sees "new row for relation
 * \"sponsors\" violates check constraint \"sponsor_link_is_http\"" — which is
 * the right information in the wrong language.
 */
const CONSTRAINT_MESSAGES = {
  sponsor_link_is_http: 'A sponsor link must start with http:// or https://.',
  sponsor_name_present: 'A sponsor needs a name of 1 to 120 characters.',
  sponsor_logo_url_and_path_together: 'Upload the logo again — its image and its file reference disagree.',
  testimonial_author_present: 'A testimonial needs an author name.',
  testimonial_body_present: 'A testimonial needs a quote of at most 1200 characters.',
  testimonial_rating_range: 'A rating is between 1 and 5 stars, or empty.',
  testimonial_avatar_url_and_path_together: 'Upload the photo again — its image and its file reference disagree.',
  category_slug_shape: 'A category id is lowercase letters, numbers and underscores, like food_drink.',
  category_label_present: 'A category needs a name of 1 to 60 characters.',
  events_category_fk: 'Events are still filed under this category.',
  site_content_is_object: 'That block could not be saved in the shape it arrived in.',
};

function constraintError(error) {
  const text = String(error?.message || '');
  for (const [name, message] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (text.includes(name)) return new StorefrontError('VALIDATION_ERROR', message);
  }
  if (error?.code === '23505') return new StorefrontError('CONFLICT', 'Something with that id already exists.');
  return new Error(text || 'The change could not be saved.');
}

module.exports = {
  StorefrontError,
  listSponsors, createSponsor, updateSponsor, deleteSponsor,
  listTestimonials, createTestimonial, updateTestimonial, deleteTestimonial,
  content, saveContent,
  constraintError,
};
