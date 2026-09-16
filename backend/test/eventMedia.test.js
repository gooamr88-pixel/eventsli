const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eventRules only — no database, no environment. mediaService is NOT imported
// here: it requires config/supabase, which throws at module load without
// credentials, and a rule that can only be checked against a live project is a
// rule nobody checks.
const { partitionPatch, ORGANIZER_EDITABLE } = require('../services/eventRules');
const { ERROR_STATUS } = require('../utils/responseEnvelope');

const MIGRATION = path.join(
  __dirname, '..', '..', 'supabase', 'migrations',
  '20260905090000_event_media_and_category.sql',
);
const migrationSql = fs.readFileSync(MIGRATION, 'utf8');

const CMS_MIGRATION = path.join(
  __dirname, '..', '..', 'supabase', 'migrations',
  '20260916100000_storefront_cms.sql',
);
const cmsSql = fs.readFileSync(CMS_MIGRATION, 'utf8');

// ── Category ────────────────────────────────────────────────────────────────

/**
 * THE ENUM IS GONE, and this test changed shape with it.
 *
 * It used to assert that `EVENT_CATEGORIES` in eventRules matched the values in
 * `CREATE TYPE event_category` — one list, two places, checked. The storefront
 * migration turned the enum into `event_categories` rows so an admin can add a
 * category without a deploy, which makes a frozen array in source impossible to
 * keep correct by definition.
 *
 * What replaces the guarantee is a foreign key, and these two tests assert the
 * pieces of it that live in files rather than in the running database: that the
 * seed covers every value the old enum held, so no existing event was orphaned,
 * and that the column still points at the table.
 */
test('every value of the old enum survives as a seeded category row', () => {
  const block = migrationSql.match(/CREATE TYPE event_category AS ENUM \(([\s\S]*?)\);/);
  assert.ok(block, 'the original migration must still show what the enum held');
  const fromEnum = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  const seed = cmsSql.match(/INSERT INTO event_categories \(slug, label, sort_order\) VALUES([\s\S]*?);/);
  assert.ok(seed, 'the storefront migration must seed event_categories');
  const seeded = [...seed[1].matchAll(/\('([a-z_]+)',/g)].map((m) => m[1]);

  assert.deepEqual(
    [...fromEnum].sort(),
    [...seeded].sort(),
    'a category the enum held is not seeded — events filed under it would break the foreign key',
  );
});

test('events.category is a foreign key that refuses an unknown value', () => {
  // The guarantee the enum used to give. Without the key, `category` is free
  // text and "Music", "music" and "MUSIC" are three categories again.
  assert.match(cmsSql, /ALTER TABLE events ALTER COLUMN category TYPE TEXT/);
  assert.match(
    cmsSql,
    /FOREIGN KEY \(category\) REFERENCES event_categories\(slug\)/,
  );
  // RESTRICT, not CASCADE: deleting a category must not delete events.
  assert.match(cmsSql, /ON UPDATE CASCADE ON DELETE RESTRICT/);
});

test('category is organizer-editable and maps to its column', () => {
  assert.equal(ORGANIZER_EDITABLE.category, 'category');

  const { allowed, denied } = partitionPatch({ category: 'music' }, { isAdmin: false });
  assert.deepEqual(allowed, { category: 'music' });
  assert.deepEqual(denied, []);
});

test("'other' is seeded, because it is the column default", () => {
  // The default survived the move from enum to table, and a default that is not
  // a row is a foreign-key violation on every event created without a category
  // — which is most of them, since the field is optional.
  assert.match(cmsSql, /\('other',\s+'Everything else'/);
  assert.match(cmsSql, /ALTER TABLE events ALTER COLUMN category SET DEFAULT 'other'/);
});

// ── The cover, and why it is not a field ────────────────────────────────────

test('an organizer cannot set coverUrl by any spelling', () => {
  // This is the whole reason the upload is two steps. A settable cover URL is
  // a URL the platform then serves inside an Open Graph tag on a public page —
  // a link we vouch for, pointing anywhere on the internet.
  const { allowed, denied } = partitionPatch({
    coverUrl: 'https://example.test/anything.png',
    cover_url: 'https://example.test/anything.png',
    coverPath: 'events/someone-else/cover.png',
    cover_path: 'events/someone-else/cover.png',
  }, { isAdmin: false });

  assert.deepEqual(allowed, {}, 'not one of these may reach the database');
  assert.deepEqual(denied.sort(), ['coverPath', 'coverUrl', 'cover_path', 'cover_url']);
});

test('not even an admin can set it — the write has one owner', () => {
  const { allowed, denied } = partitionPatch(
    { coverUrl: 'https://example.test/x.png' }, { isAdmin: true },
  );
  assert.deepEqual(allowed, {});
  assert.deepEqual(denied, ['coverUrl']);
});

// ── The invariant the database holds ────────────────────────────────────────

test('url and path are constrained to move together', () => {
  // A URL with no path cannot be cleaned up when it is replaced; a path with no
  // URL is an object nothing points at. Enforced as a CHECK rather than in the
  // controller, because a rule in a controller is one code path from not
  // existing — and this one is written from three of them.
  assert.match(
    migrationSql,
    /CHECK \(\(cover_url IS NULL\) = \(cover_path IS NULL\)\)/,
  );
});

test('the storage bucket is provisioned behind a schema guard', () => {
  // CI runs `supabase start` with storage disabled on purpose. An unguarded
  // INSERT into storage.buckets fails every migration check on a stack that is
  // deliberately not running storage.
  assert.match(migrationSql, /information_schema\.schemata WHERE schema_name = 'storage'/);
  assert.match(migrationSql, /INSERT INTO storage\.buckets/);
});

// ── Error codes ─────────────────────────────────────────────────────────────

test('the media failures have statuses, so they are not 400 by accident', () => {
  // A status lookup falls back to 400 for an unmapped code. An unconfigured
  // bucket reported as "your request was invalid" sends the organizer looking
  // at their own file for a deployment problem.
  assert.equal(ERROR_STATUS.UNSUPPORTED_MEDIA_TYPE, 415);
  assert.equal(ERROR_STATUS.STORAGE_NOT_CONFIGURED, 503);
});
