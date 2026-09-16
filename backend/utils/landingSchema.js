/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What each landing-page content block is allowed to hold.
 *
 * `site_content` is a JSONB column, and a JSONB column with no schema beside it
 * is a bag of typos: `{"titel": "..."}` saves cleanly, renders nothing, and the
 * operator concludes the CMS is broken. This is the same answer
 * `utils/settingsSchema.js` gave for `platform_settings`, for the same reason —
 * every key has a shape, unknown fields are REFUSED rather than stored, and the
 * value written is the normalised one this returns.
 *
 * It is also where the page's defaults live. A key with no row means "use the
 * default", so a fresh database renders a complete page and an operator who
 * clears a field gets the shipped copy back rather than a blank band.
 *
 * PURE. No database, no environment, no imports — `mediaPrefix` is passed in by
 * the caller precisely so this module stays testable without either.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * WHY AN IMAGE URL IS NOT JUST A URL.
 *
 * Every image field here is rendered by `next/image`, whose `remotePatterns`
 * admits the Supabase storage host and nothing else — so a URL pointing
 * anywhere else is not a design mistake, it is an image that silently fails to
 * render on the most important page on the site, with the only evidence in
 * somebody else's browser console.
 *
 * It is also a trust boundary. The hero image is served from our origin's
 * markup; an arbitrary URL there is a third party we are vouching for, and a
 * tracking pixel we cannot see.
 *
 * So an image must live in our own bucket. The upload flow puts it there and
 * hands back the URL; nothing else is accepted.
 */
const IMAGE = 'image';

/** An internal destination. See `checkHref`. */
const HREF = 'href';

const TEXT = 'text';
const LONGTEXT = 'longtext';
const BOOL = 'bool';
const VIDEO = 'video';

/**
 * The blocks, their fields, and the copy that ships when nobody has changed
 * anything.
 *
 * The defaults are the words the page was written with. They are here rather
 * than in the frontend because "what does this field currently say" is a
 * question the admin console has to answer, and a default that lives in JSX
 * can only be read by rendering it.
 */
const BLOCKS = {
  /**
   * The hero.
   *
   * `title` and `titleAccent` are two fields rather than one string with markup
   * in it. The design sets the accent line in serif italic, and the alternative
   * — letting an operator write `<em>` inside a title — is either an HTML
   * injection point or a second markup language to document. Two fields render
   * as two lines and cannot be malformed.
   */
  hero: {
    label: 'Hero',
    fields: {
      eyebrow:      { type: TEXT, max: 60,  label: 'Eyebrow', default: 'More than events' },
      title:        { type: TEXT, max: 80,  label: 'Headline', default: 'Extraordinary Moments' },
      titleAccent:  { type: TEXT, max: 40,  label: 'Headline accent', default: 'Live Here', optional: true },
      subtitle:     { type: TEXT, max: 120, label: 'Subtitle', default: 'Discover. Create. Attend. Celebrate.', optional: true },
      body:         { type: LONGTEXT, max: 320, label: 'Supporting line', optional: true,
        default: 'Eventsli brings people closer through unforgettable experiences — '
          + 'from intimate gatherings to sold-out nights.' },
      script:       { type: TEXT, max: 60, label: 'Script accent', optional: true,
        default: 'Good events, brighter people' },
      imageUrl:     { type: IMAGE, label: 'Background image (desktop)', optional: true },
      imagePath:    { type: TEXT, max: 400, label: 'Background image key', optional: true, internal: true },
      mobileImageUrl:  { type: IMAGE, label: 'Background image (mobile)', optional: true },
      mobileImagePath: { type: TEXT, max: 400, label: 'Mobile image key', optional: true, internal: true },
      primaryCtaLabel:   { type: TEXT, max: 32, label: 'Primary button', default: 'Browse events' },
      primaryCtaHref:    { type: HREF, label: 'Primary button link', default: '/events' },
      secondaryCtaLabel: { type: TEXT, max: 32, label: 'Secondary button', default: 'Start selling', optional: true },
      secondaryCtaHref:  { type: HREF, label: 'Secondary button link', default: '/register', optional: true },
      showSearch:   { type: BOOL, label: 'Show the search bar', default: true },
    },
  },

  /**
   * The introduction video.
   *
   * Ships disabled with no URL, which is the state the brief asked for: the
   * section exists in the design and in the admin console, and renders nothing
   * until somebody supplies a film. An empty <video> is not a placeholder, it
   * is a broken control.
   */
  video: {
    label: 'Video',
    fields: {
      enabled:   { type: BOOL, label: 'Show the video section', default: false },
      url:       { type: VIDEO, label: 'Video URL', optional: true },
      posterUrl: { type: IMAGE, label: 'Poster image', optional: true },
      posterPath:{ type: TEXT, max: 400, label: 'Poster image key', optional: true, internal: true },
      title:     { type: TEXT, max: 80, label: 'Title', default: 'Watch our story', optional: true },
      caption:   { type: TEXT, max: 160, label: 'Caption', default: 'Real people. Real events. Real impact.', optional: true },
    },
  },

  /**
   * The statistics strip.
   *
   * There is no field here for a NUMBER, and that is the point. Every figure is
   * counted from the database at render time (see `statsService`); an operator
   * can choose which measures appear and what they are called, and cannot type
   * a value. A CMS field for "10K+ events" is how a homepage ends up claiming
   * ten thousand events on a platform that has one.
   */
  stats: {
    label: 'Statistics',
    fields: {
      enabled:       { type: BOOL, label: 'Show the statistics strip', default: true },
      showEvents:    { type: BOOL, label: 'Events published', default: true },
      showOrganizers:{ type: BOOL, label: 'Organizers', default: true },
      showGuests:    { type: BOOL, label: 'Guests', default: true },
      showCities:    { type: BOOL, label: 'Cities', default: true },
      showVisits:    { type: BOOL, label: 'Visits (30 days)', default: false },
      eventsLabel:     { type: TEXT, max: 32, label: 'Events label', default: 'Events created' },
      organizersLabel: { type: TEXT, max: 32, label: 'Organizers label', default: 'Organizers' },
      guestsLabel:     { type: TEXT, max: 32, label: 'Guests label', default: 'Happy guests' },
      citiesLabel:     { type: TEXT, max: 32, label: 'Cities label', default: 'Cities' },
      visitsLabel:     { type: TEXT, max: 32, label: 'Visits label', default: 'Visits this month' },
    },
  },

  /** The band addressed to organizers. */
  organizer_block: {
    label: 'For organizers',
    fields: {
      eyebrow:  { type: TEXT, max: 60, label: 'Eyebrow', default: 'For organizers' },
      title:    { type: TEXT, max: 80, label: 'Headline', default: 'Bring your vision to life' },
      body:     { type: LONGTEXT, max: 320, label: 'Supporting line', optional: true,
        default: 'Everything you need to create, manage and grow extraordinary events — all in one place.' },
      script:   { type: TEXT, max: 60, label: 'Script accent', optional: true, default: 'Organize smarter' },
      ctaLabel: { type: TEXT, max: 32, label: 'Button', default: 'Create your event' },
      ctaHref:  { type: HREF, label: 'Button link', default: '/register' },
      imageUrl: { type: IMAGE, label: 'Section image', optional: true },
      imagePath:{ type: TEXT, max: 400, label: 'Section image key', optional: true, internal: true },
    },
  },

  /** The band addressed to guests. */
  guest_block: {
    label: 'For guests',
    fields: {
      eyebrow:  { type: TEXT, max: 60, label: 'Eyebrow', default: 'For guests' },
      title:    { type: TEXT, max: 80, label: 'Headline', default: 'Discover unforgettable experiences' },
      body:     { type: LONGTEXT, max: 320, label: 'Supporting line', optional: true,
        default: 'Find events near you, book with ease, and be part of the moments that matter.' },
      script:   { type: TEXT, max: 60, label: 'Script accent', optional: true, default: 'More moments together' },
      ctaLabel: { type: TEXT, max: 32, label: 'Button', default: 'Explore events' },
      ctaHref:  { type: HREF, label: 'Button link', default: '/events' },
      imageUrl: { type: IMAGE, label: 'Section image', optional: true },
      imagePath:{ type: TEXT, max: 400, label: 'Section image key', optional: true, internal: true },
    },
  },

  /** Headings for the two curated rails, so they can be retitled per season. */
  sections: {
    label: 'Section headings',
    fields: {
      featuredEyebrow: { type: TEXT, max: 60, label: 'Featured eyebrow', default: 'Handpicked for you' },
      featuredTitle:   { type: TEXT, max: 80, label: 'Featured heading', default: 'Featured events' },
      featuredBody:    { type: TEXT, max: 160, label: 'Featured subheading', optional: true,
        default: 'Curated experiences. Unforgettable moments.' },
      sponsorsEyebrow: { type: TEXT, max: 60, label: 'Sponsors eyebrow', default: 'Our sponsors' },
      sponsorsTitle:   { type: TEXT, max: 80, label: 'Sponsors heading', default: 'Trusted by leading brands' },
      testimonialsEyebrow: { type: TEXT, max: 60, label: 'Testimonials eyebrow', default: 'What people say' },
      testimonialsTitle:   { type: TEXT, max: 80, label: 'Testimonials heading', default: 'Loved by hosts and guests' },
      categoriesEyebrow: { type: TEXT, max: 60, label: 'Categories eyebrow', default: 'Browse by category' },
      categoriesTitle:   { type: TEXT, max: 80, label: 'Categories heading', default: 'What are you in the mood for?' },
    },
  },
};

const CONTENT_KEYS = Object.freeze(Object.keys(BLOCKS));

/** The shipped copy for one key, as a plain object. */
function defaultsFor(key) {
  const block = BLOCKS[key];
  if (!block) return null;
  const out = {};
  for (const [name, rule] of Object.entries(block.fields)) {
    if (rule.default !== undefined) out[name] = rule.default;
  }
  return out;
}

/** Every key's defaults, for a reader that wants the whole page at once. */
function allDefaults() {
  return Object.fromEntries(CONTENT_KEYS.map((k) => [k, defaultsFor(k)]));
}

/**
 * The admin console's field list — what to render, and what to call it.
 * `internal` fields are the storage object keys that travel with an image and
 * are never typed by a person.
 */
function describe() {
  return CONTENT_KEYS.map((key) => ({
    key,
    label: BLOCKS[key].label,
    fields: Object.entries(BLOCKS[key].fields)
      .filter(([, rule]) => !rule.internal)
      .map(([name, rule]) => ({
        name,
        type: rule.type,
        label: rule.label,
        max: rule.max || null,
        optional: !!rule.optional,
        default: rule.default === undefined ? null : rule.default,
      })),
  }));
}

/**
 * An internal destination, or an anchor.
 *
 * External links are refused. Every button on this page points into the
 * product; a CMS field that accepts `https://` is a field through which the
 * homepage's primary call to action becomes somebody else's landing page — by
 * a compromised admin account, or by a typo nobody notices because the button
 * still looks right.
 */
function checkHref(value) {
  if (typeof value !== 'string') return 'must be a link.';
  const v = value.trim();
  if (!v) return 'must be a link.';
  if (v.length > 200) return 'is too long.';
  // `//evil.example` is protocol-relative: it starts with a slash and is an
  // external address. Both slashes have to be refused together.
  if (v.startsWith('//')) return 'must be a link inside Eventsli, like /events.';
  if (!v.startsWith('/') && !v.startsWith('#')) return 'must be a link inside Eventsli, like /events.';
  if (/[\s<>"']/.test(v)) return 'contains characters a link cannot hold.';
  return null;
}

function checkImage(value, mediaPrefix) {
  if (typeof value !== 'string') return 'must be an uploaded image.';
  const v = value.trim();
  if (!v) return null;
  if (v.length > 1000) return 'is too long.';
  // Upload it, then save it. A URL from anywhere else does not render — see
  // the note at the top of this file.
  if (!mediaPrefix || !v.startsWith(mediaPrefix)) {
    return 'must be an image uploaded to Eventsli, not a link to another site.';
  }
  return null;
}

/**
 * A video the page will play.
 *
 * https only, and the CSP decides what actually loads — `media-src` for a file,
 * `frame-src` for YouTube or Vimeo. Accepting a URL here that the policy then
 * blocks is the worst of both: it saves, it looks configured, and the section
 * is blank for everyone but the person who set it.
 */
const VIDEO_HOSTS = ['www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com', 'vimeo.com'];

function checkVideo(value, mediaPrefix) {
  if (typeof value !== 'string') return 'must be a video link.';
  const v = value.trim();
  if (!v) return null;
  if (v.length > 1000) return 'is too long.';

  let url;
  try { url = new URL(v); } catch { return 'is not a valid link.'; }
  if (url.protocol !== 'https:') return 'must start with https://.';

  if (mediaPrefix && v.startsWith(mediaPrefix)) return null;
  if (VIDEO_HOSTS.includes(url.hostname)) return null;
  if (/\.(mp4|webm)$/i.test(url.pathname)) return null;

  return 'must be a YouTube or Vimeo link, or an .mp4 or .webm file.';
}

function checkField(name, rule, value, mediaPrefix, errors) {
  if (value === undefined || value === null || value === '') {
    // An empty optional field means "use the default", which is how an operator
    // undoes an edit. A required one falls back to its default rather than
    // failing the save — the page must always have a headline.
    return rule.default !== undefined ? rule.default : undefined;
  }

  if (rule.type === BOOL) {
    if (typeof value !== 'boolean') { errors.push(`${rule.label} must be true or false.`); return undefined; }
    return value;
  }

  if (typeof value !== 'string') { errors.push(`${rule.label} must be text.`); return undefined; }
  const v = value.trim();

  if (rule.type === HREF) {
    const problem = checkHref(v);
    if (problem) errors.push(`${rule.label} ${problem}`);
    return problem ? undefined : v;
  }
  if (rule.type === IMAGE) {
    const problem = checkImage(v, mediaPrefix);
    if (problem) errors.push(`${rule.label} ${problem}`);
    return problem ? undefined : v;
  }
  if (rule.type === VIDEO) {
    const problem = checkVideo(v, mediaPrefix);
    if (problem) errors.push(`${rule.label} ${problem}`);
    return problem ? undefined : v;
  }

  if (rule.max && v.length > rule.max) {
    errors.push(`${rule.label} can be at most ${rule.max} characters.`);
    return undefined;
  }
  // Control characters, which arrive by paste from a word processor and render
  // as nothing or as a replacement glyph depending on the browser.
  return v.replace(/[ --]/g, '');
}

/**
 * `{ ok: true, value }` with the normalised block, or `{ ok: false, errors }`.
 *
 * The saved value is COMPLETE — every field, defaults included — rather than a
 * patch. A partial row means every reader has to merge against the defaults
 * itself, and the first one to forget renders a band with no heading.
 *
 * @param {string} key
 * @param {object} value
 * @param {object} [opts]
 * @param {string} [opts.mediaPrefix]  the public prefix of our storage bucket
 */
function validateContent(key, value, { mediaPrefix } = {}) {
  const block = BLOCKS[key];
  if (!block) return { ok: false, errors: [`Not a content block: ${key}.`] };

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['Send an object with the block\'s fields.'] };
  }

  const unknown = Object.keys(value).filter((k) => !(k in block.fields));
  if (unknown.length) {
    return { ok: false, errors: [`Not a field of ${block.label}: ${unknown.join(', ')}.`] };
  }

  const errors = [];
  const clean = {};
  for (const [name, rule] of Object.entries(block.fields)) {
    const checked = checkField(name, rule, value[name], mediaPrefix, errors);
    if (checked !== undefined) clean[name] = checked;
  }

  // An image and its storage key travel together or not at all — the same rule
  // the `events.cover_*` columns carry as a database constraint. Here it is a
  // check because the pair is inside one JSONB value, where a constraint cannot
  // reach the individual fields.
  for (const [url, path] of [
    ['imageUrl', 'imagePath'], ['mobileImageUrl', 'mobileImagePath'], ['posterUrl', 'posterPath'],
  ]) {
    if (url in block.fields && !!clean[url] !== !!clean[path]) {
      errors.push(`${block.fields[url].label} must be set through an upload, which supplies both the image and its key.`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: clean };
}

module.exports = { CONTENT_KEYS, BLOCKS, defaultsFor, allDefaults, describe, validateContent };
