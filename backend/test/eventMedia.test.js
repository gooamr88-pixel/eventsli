const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eventRules only — no database, no environment. mediaService is NOT imported
// here: it requires config/supabase, which throws at module load without
// credentials, and a rule that can only be checked against a live project is a
// rule nobody checks.
const {
  partitionPatch, EVENT_CATEGORIES, ORGANIZER_EDITABLE,
} = require('../services/eventRules');
const { ERROR_STATUS } = require('../utils/responseEnvelope');

const MIGRATION = path.join(
  __dirname, '..', '..', 'supabase', 'migrations',
  '20260905090000_event_media_and_category.sql',
);
const migrationSql = fs.readFileSync(MIGRATION, 'utf8');

// ── Category ────────────────────────────────────────────────────────────────

test('the exported categories are exactly the enum the migration creates', () => {
  // The failure this catches: someone adds a value to the enum and not to the
  // list, so the database accepts a category the validator rejects — or the
  // reverse, where the validator waves through a value Postgres refuses to cast
  // and a public endpoint answers 500. Neither failure mentions the other list,
  // which is what makes it expensive to find.
  const block = migrationSql.match(/CREATE TYPE event_category AS ENUM \(([\s\S]*?)\);/);
  assert.ok(block, 'the migration must still create event_category');

  const fromSql = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  assert.deepEqual(
    [...EVENT_CATEGORIES].sort(),
    [...fromSql].sort(),
    'EVENT_CATEGORIES and the event_category enum have drifted apart',
  );
});

test('category is organizer-editable and maps to its column', () => {
  assert.equal(ORGANIZER_EDITABLE.category, 'category');

  const { allowed, denied } = partitionPatch({ category: 'music' }, { isAdmin: false });
  assert.deepEqual(allowed, { category: 'music' });
  assert.deepEqual(denied, []);
});

test("'other' is a real category, because it is the column default", () => {
  // A NOT NULL DEFAULT that is not a legal value of the enum would fail on the
  // ALTER rather than at runtime, but the pairing is worth asserting: if the
  // default is ever changed to something outside the list, every existing row
  // becomes unfilterable.
  assert.ok(EVENT_CATEGORIES.includes('other'));
  assert.match(migrationSql, /ADD COLUMN category event_category NOT NULL DEFAULT 'other'/);
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
  // sendRpcFailure falls back to 400 for an unmapped code. An unconfigured
  // bucket reported as "your request was invalid" sends the organizer looking
  // at their own file for a deployment problem.
  assert.equal(ERROR_STATUS.UNSUPPORTED_MEDIA_TYPE, 415);
  assert.equal(ERROR_STATUS.STORAGE_NOT_CONFIGURED, 503);
});
