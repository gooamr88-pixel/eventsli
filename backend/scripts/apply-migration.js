/**
 * Applies one migration file to the linked Supabase project over a direct
 * Postgres connection, inside a transaction.
 *
 *   node scripts/apply-migration.js ../supabase/migrations/<file>.sql
 *
 * A transaction is the point: a migration that fails half way through leaves a
 * schema that matches no file in the repo, and the only way back is to work out
 * by hand which statements landed. Either all of it applies or none of it does.
 *
 * Applied files are recorded in `schema_migrations`, so re-running is a no-op
 * rather than a duplicate-object error.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./db');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-migration.js <path-to.sql>');
  process.exit(1);
}

// Relative to the CWD the operator typed it from, not to this script's folder.
const abs = path.resolve(process.cwd(), file);
const name = path.basename(abs);
// Strip a UTF-8 BOM. Windows editors and PowerShell's Set-Content add one, and
// Postgres reads it as a stray character before the first statement:
//   syntax error at or near "﻿"
// which points at a character you cannot see in any editor.
const sql = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');

/**
 * Statements that cannot live inside the transaction this script wraps around
 * the file. CREATE INDEX CONCURRENTLY and VACUUM refuse to run in one; a file
 * with its own BEGIN/COMMIT would end the wrapper early and leave the rest
 * running outside it — the half-applied schema the wrapper exists to prevent.
 * Refused before connecting, so nothing is touched.
 */
const HOSTILE = /\bINDEX\s+CONCURRENTLY\b|^\s*VACUUM\b|^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/im;
// Comments first: migrations here explain themselves in prose ("…where
// CONCURRENTLY is not allowed…"), and prose must not refuse a file.
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
if (HOSTILE.test(code)) {
  console.error(`${name}: contains a statement that cannot run inside a transaction `
    + '(CONCURRENTLY, VACUUM, or its own BEGIN/COMMIT). Apply it by hand, deliberately.');
  process.exit(1);
}

/**
 * Migrations that are NOT safe to run a second time, and why.
 *
 * `schema_migrations` only knows what THIS script applied; anything pasted into
 * the Supabase SQL editor is invisible to it, so "not recorded" does not mean
 * "not applied". Every other migration here either re-applies harmlessly or
 * fails on a duplicate object and rolls back (verified by re-applying all of
 * them, 2026-11-06). These two would silently change live data. Refused
 * outright unless the operator states it is the first time, before any
 * connection is made.
 */
const RERUN_UNSAFE = {
  '20260915090000_email_verification.sql':
    'marks EVERY unverified account as verified — a re-run lets everyone who signed up since skip email verification',
  '20260829120000_payment_fee_mode.sql':
    'resets platform_settings defaults (manual_invoice.min_hours_from_issue, payment_fee.default_mode), undoing admin changes',
};
if (RERUN_UNSAFE[name] && !process.argv.includes('--first-time')) {
  console.error(`${name} is not safe to re-run: it ${RERUN_UNSAFE[name]}.\n`
    + 'Production already depends on it. Only on a database that has NEVER had it, re-run with --first-time.');
  process.exit(1);
}

/**
 * How long a statement may WAIT for a lock before the whole file gives up and
 * rolls back. An ALTER TABLE queued behind a long-running transaction holds its
 * place in the lock queue, and every ordinary query on that table then queues
 * behind IT — a migration waiting politely is a site-wide stall. Failing after
 * a few seconds costs one retry at a quieter moment instead.
 */
const LOCK_TIMEOUT = process.env.MIGRATION_LOCK_TIMEOUT || '5s';
const STATEMENT_TIMEOUT = process.env.MIGRATION_STATEMENT_TIMEOUT || '120s';

(async () => {
  const client = await connect({ quiet: false });

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Locked down like every other table (20260914090000): the browser's anon
    // key reaches nothing. Created here without it, this table was readable
    // through the Data API, and verify-schema.js failed on any database this
    // script had ever touched. Idempotent, so it also fixes an existing table.
    await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON schema_migrations FROM PUBLIC, anon, authenticated');

    const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (rows.length) {
      console.log(`\n${name} is already recorded as applied — nothing to do.`);
      return;
    }

    await client.query('BEGIN');
    // LOCAL: they end with this transaction and never touch other sessions.
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT.replace(/'/g, '')}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT.replace(/'/g, '')}'`);
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`\napplied ${name}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    const lock = /lock timeout|canceling statement due to (lock|statement) timeout/i.test(e.message);
    console.error(`\nFAILED — rolled back, the schema is unchanged.\n${e.message}`
      + (lock ? '\nA lock could not be taken in time (busy table). Nothing changed — retry at a quieter moment.' : ''));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
