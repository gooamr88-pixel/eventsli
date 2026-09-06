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

(async () => {
  const client = await connect({ quiet: false });

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (rows.length) {
      console.log(`\n${name} is already recorded as applied — nothing to do.`);
      return;
    }

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`\napplied ${name}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nFAILED — rolled back, the schema is unchanged.\n${e.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
