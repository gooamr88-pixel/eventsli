#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ERASE ACCOUNTS COMPLETELY, by email (owner, 2026-11-24).
 *
 *   node scripts/erase-account.js --email a@b.com [--email c@d.com]
 *        → DRY RUN. Does everything inside one transaction, then ROLLS IT BACK
 *          and prints exactly what would have happened. Changes nothing.
 *
 *   node scripts/erase-account.js --email a@b.com --commit --project <ref>
 *        → the same, committed. `--project` must match the database in
 *          backend/.env (the ref in SUPABASE_URL), so a command pasted on the
 *          wrong server refuses. You are asked to type ERASE.
 *
 * Runs against the database backend/.env names — on the server, PRODUCTION.
 * Set DATABASE_URL to point it somewhere else (a local copy, for a rehearsal).
 *
 * WHAT GOES, for each email, the owner's choice "everything, incl. its events":
 *   · the account (profiles), its sessions, codes, team memberships;
 *   · every organizer it owns, every event of those organizers, and all of
 *     each event's data: ticket types, seat maps, reservations, orders and
 *     tickets — OTHER BUYERS' orders and tickets for those events included —
 *     scans, staff, promo codes, sponsors, vendors…;
 *   · every order it bought as a buyer, on any event, and those tickets;
 *   · every other row that still holds the email anywhere (notify lists,
 *     consents, guest lists, form answers, logs): deleted where the email is
 *     the row's own address, otherwise the address is replaced in place;
 *   · after the commit: the events' and organizers' files in storage.
 *
 * WHAT CANNOT GO, BY DESIGN, AND IS ANONYMIZED INSTEAD (owner's choice):
 *   the money ledger, invoice payments and events, credit notes and the
 *   payment audit are append-only — the database refuses to delete them.
 *   They pin their orders, events, invoices and organizer in place. Those
 *   rows are KEPT WITH NO PERSONAL DATA: orders lose the buyer's name, email
 *   and phone; events become "[erased]" and cancelled; the organizer
 *   "[erased]"; an account that must stay becomes erased-<id>@erased.invalid,
 *   blocked, with no password. The books still add up; nobody is in them.
 *
 * HOW. The schema's own foreign keys decide the order: before a row is
 * deleted, every row that refers to it is dealt with first — deleted when it
 * belongs to it, or its reference cleared when it only mentions it (an admin
 * who reviewed someone else's event: that event stays, the reviewer link
 * goes). Each delete runs under a savepoint, so a row the database refuses
 * is kept and anonymized rather than failing the whole erase.
 *
 * --delete-ledger (owner, 2026-11-24: "how can I delete?"): delete those
 * protected rows too, so nothing is kept at all. Their guard triggers are
 * switched off INSIDE this transaction only and switched back on before it
 * ends — a rollback (the dry run, a cancel, an error) restores them with
 * everything else. The financial history of those sales is gone for good.
 *
 * NOT TOUCHED (outside this database): a Stripe connected account, email
 * provider contact lists, backups. The report lists what to do about each.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const path = require('node:path');
const readline = require('node:readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const ERASED = 'erased@erased.invalid';
// Tables whose rows the database refuses to change or delete (append-only).
const PROTECTED = new Set(['ledger_entries', 'invoice_payments', 'invoice_events', 'credit_notes', 'credit_note_allocations', 'payment_audit']);

const args = process.argv.slice(2);
const emails = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--email' && args[i + 1]) emails.push(args[i + 1].trim().toLowerCase());
const commit = args.includes('--commit');
const includeAdmins = args.includes('--include-admins');
const projectArg = (() => { const i = args.indexOf('--project'); return i >= 0 ? args[i + 1] : null; })();
const assumeYes = args.includes('--yes');
const deleteLedger = args.includes('--delete-ledger');

const log = (...a) => console.log(...a);
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function connect() {
  if (process.env.DATABASE_URL) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    return { client: c, where: 'DATABASE_URL' };
  }
  const { connect: viaSupabase } = require('./db');
  return { client: await viaSupabase(), where: process.env.SUPABASE_URL };
}

function projectRef() {
  return (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || null;
}

async function main() {
  if (emails.length === 0) {
    console.error('Usage: node scripts/erase-account.js --email a@b.com [--email …] [--commit --project <ref>] [--include-admins]');
    process.exit(2);
  }
  if (commit && !process.env.DATABASE_URL) {
    const ref = projectRef();
    if (!projectArg || projectArg !== ref) {
      console.error(`--commit needs --project ${ref || '<ref>'} — the project in backend/.env — so this cannot run on the wrong database.`);
      process.exit(2);
    }
  }

  const { client, where } = await connect();
  const stats = new Map();   // table → { deleted, nulled, retained, scrubbed }
  const bump = (t, k, n) => { if (!n) return; const s = stats.get(t) || { deleted: 0, nulled: 0, retained: 0, scrubbed: 0 }; s[k] += n; stats.set(t, s); };
  // Kept rows, by table and key — a row reached by two paths is counted once.
  const keptRows = new Map();
  const keep = (t, col, v) => { const s = keptRows.get(t) || new Set(); s.add(`${col}:${v}`); keptRows.set(t, s); };
  const notes = [];
  let sp = 0;

  // ── the schema ────────────────────────────────────────────────────────────
  const fks = (await client.query(`
    SELECT c.conrelid::regclass::text AS child, a.attname AS child_col,
           c.confrelid::regclass::text AS parent, pa.attname AS parent_col,
           c.confdeltype AS on_delete, NOT a.attnotnull AS nullable
      FROM pg_constraint c
      JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      JOIN pg_namespace n ON n.oid = c.connamespace AND n.nspname = 'public'
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`)).rows
    .map((r) => ({ ...r, child: r.child.replace(/^public\./, ''), parent: r.parent.replace(/^public\./, '') }));
  const childrenOf = (table) => fks.filter((f) => f.parent === table);

  async function tryQuery(sql, params) {
    const name = `sp${++sp}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const r = await client.query(sql, params);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return { ok: true, r };
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: false, err };
    }
  }

  // ── delete rows, children first ───────────────────────────────────────────
  const seen = new Set();
  async function purge(table, col, values, depth = 0) {
    const vals = [...new Set(values.filter((v) => v !== null && v !== undefined).map(String))];
    if (vals.length === 0 || depth > 25) return;
    const key = `${table}.${col}:${vals.sort().join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);

    for (const fk of childrenOf(table)) {
      if (fk.on_delete === 'n' || fk.on_delete === 'd') continue;          // the database clears these itself
      const parentVals = fk.parent_col === col ? vals
        : (await client.query(`SELECT DISTINCT ${q(fk.parent_col)}::text AS v FROM ${q(table)} WHERE ${q(col)}::text = ANY($1)`, [vals])).rows.map((r) => r.v);
      if (parentVals.length === 0) continue;
      if (table === 'profiles' && fk.nullable && fk.on_delete !== 'c') {
        // It only MENTIONS the person (who reviewed, who recorded): keep the
        // row, drop the link. Someone else's event must not go with a reviewer.
        const r = await tryQuery(`UPDATE ${q(fk.child)} SET ${q(fk.child_col)} = NULL WHERE ${q(fk.child_col)}::text = ANY($1)`, [parentVals]);
        if (r.ok) bump(fk.child, 'nulled', r.r.rowCount);
        continue;
      }
      await purge(fk.child, fk.child_col, parentVals, depth + 1);
    }

    if (PROTECTED.has(table)) {
      const ids = (await client.query(`SELECT ctid::text AS k FROM ${q(table)} WHERE ${q(col)}::text = ANY($1)`, [vals])).rows;
      for (const r of ids) keep(table, 'ctid', r.k);
      return;
    }
    const bulk = await tryQuery(`DELETE FROM ${q(table)} WHERE ${q(col)}::text = ANY($1)`, [vals]);
    if (bulk.ok) { bump(table, 'deleted', bulk.r.rowCount); return; }
    // Something pins some of them: one by one, keeping what must stay.
    for (const v of vals) {
      const one = await tryQuery(`DELETE FROM ${q(table)} WHERE ${q(col)}::text = $1`, [v]);
      if (one.ok) bump(table, 'deleted', one.r.rowCount);
      else {
        const ids = (await client.query(`SELECT ctid::text AS k FROM ${q(table)} WHERE ${q(col)}::text = $1`, [v])).rows;
        for (const r of ids) keep(table, 'ctid', r.k);
      }
    }
  }

  await client.query('BEGIN');
  try {
    // ── who and what ─────────────────────────────────────────────────────────
    const profiles = (await client.query('SELECT id, email, role FROM profiles WHERE lower(email::text) = ANY($1)', [emails])).rows;
    const userIds = profiles.map((p) => p.id);
    const organizers = userIds.length
      ? (await client.query('SELECT id, display_name FROM organizers WHERE owner_user_id = ANY($1)', [userIds])).rows : [];
    const orgIds = organizers.map((o) => o.id);
    const events = orgIds.length
      ? (await client.query('SELECT id, slug, title, status FROM events WHERE organizer_id = ANY($1)', [orgIds])).rows : [];
    const eventIds = events.map((e) => e.id);
    const bought = (await client.query(`
      SELECT id FROM orders WHERE (user_id = ANY($1::uuid[]) OR lower(guest_email::text) = ANY($2))
        AND NOT (event_id = ANY($3::uuid[]))`, [userIds, emails, eventIds])).rows.map((r) => r.id);

    log(`Database : ${where}`);
    log(`Emails   : ${emails.join(', ')}`);
    for (const e of emails) if (!profiles.some((p) => p.email.toLowerCase() === e)) log(`  · ${e}: no account (other rows holding it are still cleaned)`);
    for (const p of profiles) log(`  · ${p.email}: account ${p.id}, role ${p.role}`);
    for (const o of organizers) log(`  · organizer "${o.display_name}" (${o.id})`);
    log(`  · ${events.length} event(s) of those organizers${events.length ? ':' : ''}`);
    for (const e of events) log(`      - ${e.title} [${e.status}] /e/${e.slug}`);
    log(`  · ${bought.length} order(s) bought on other organizers' events`);

    const admins = profiles.filter((p) => ['admin', 'super_admin'].includes(p.role));
    if (admins.length && !includeAdmins) {
      log(`\nSTOP: ${admins.map((p) => `${p.email} is ${p.role}`).join('; ')}. Erasing it removes that admin login.`);
      log('Make sure another admin can sign in, then add --include-admins.');
      await client.query('ROLLBACK');
      process.exitCode = 2;
      return;
    }

    // ── --delete-ledger: lift the append-only guards, in this transaction only ──
    const lifted = [];
    if (deleteLedger) {
      for (const t of [...PROTECTED]) {
        const exists = (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${t}`])).rows[0].ok;
        if (!exists) continue;
        await client.query(`ALTER TABLE ${q(t)} DISABLE TRIGGER USER`);
        lifted.push(t);
        PROTECTED.delete(t);
      }
      log(`\n--delete-ledger: protection lifted on ${lifted.join(', ')} for this run only.`);
    }

    // ── erase ───────────────────────────────────────────────────────────────
    await purge('orders', 'id', bought);
    await purge('events', 'id', eventIds);
    await purge('organizers', 'id', orgIds);
    await purge('profiles', 'id', userIds);

    // Back on before anything else happens — and before COMMIT.
    for (const t of lifted) await client.query(`ALTER TABLE ${q(t)} ENABLE TRIGGER USER`);

    // ── what had to stay, with nobody in it ──────────────────────────────────
    const keptOrders = (await client.query(`SELECT id FROM orders WHERE id = ANY($1::uuid[]) OR event_id = ANY($2::uuid[])`, [bought, eventIds])).rows.map((r) => r.id);
    if (keptOrders.length) {
      // An order must name a buyer (`buyer_identified`): the placeholder does.
      const r = await tryQuery(`UPDATE orders SET guest_name = '[erased]', guest_email = '${ERASED}', guest_phone = NULL, manual_note = NULL,
        user_id = NULL, void_reason = NULL WHERE id = ANY($1::uuid[])`, [keptOrders]);
      if (r.ok) bump('orders', 'scrubbed', r.r.rowCount); else notes.push(`orders could not be anonymized: ${r.err.message}`);
    }
    const keptEvents = (await client.query('SELECT id FROM events WHERE id = ANY($1::uuid[])', [eventIds])).rows.map((r) => r.id);
    if (keptEvents.length) {
      const r = await tryQuery(`UPDATE events SET status = 'cancelled', title = '[erased]', slug = 'erased-' || left(id::text, 8),
        description = NULL, venue_name = NULL, venue_address = NULL, venue_address_line2 = NULL, venue_region = NULL,
        venue_postal_code = NULL, venue_directions = NULL, venue_place_id = NULL, venue_lat = NULL, venue_lng = NULL,
        cover_url = NULL, cover_path = NULL, logo_url = NULL, logo_path = NULL, highlights = '{}' WHERE id = ANY($1::uuid[])`, [keptEvents]);
      if (r.ok) bump('events', 'scrubbed', r.r.rowCount); else notes.push(`events could not be anonymized: ${r.err.message}`);
    }
    const keptOrgs = (await client.query('SELECT id FROM organizers WHERE id = ANY($1::uuid[])', [orgIds])).rows.map((r) => r.id);
    if (keptOrgs.length) {
      const r = await tryQuery(`UPDATE organizers SET display_name = '[erased]', legal_name = NULL, description = NULL,
        billing_address = NULL, tax_id = NULL, stripe_account_id = NULL, sale_email_recipients = '{}' WHERE id = ANY($1::uuid[])`, [keptOrgs]);
      if (r.ok) bump('organizers', 'scrubbed', r.r.rowCount); else notes.push(`organizers could not be anonymized: ${r.err.message}`);
    }
    const keptProfiles = (await client.query('SELECT id FROM profiles WHERE id = ANY($1::uuid[])', [userIds])).rows.map((r) => r.id);
    if (keptProfiles.length) {
      const r = await tryQuery(`UPDATE profiles SET email = 'erased-' || id::text || '@erased.invalid', full_name = NULL, phone = NULL,
        password_hash = NULL, organization_name = NULL, is_blocked = true WHERE id = ANY($1::uuid[])`, [keptProfiles]);
      if (r.ok) bump('profiles', 'scrubbed', r.r.rowCount); else notes.push(`accounts could not be anonymized: ${r.err.message}`);
    }

    // ── the email anywhere else ──────────────────────────────────────────────
    const columns = (await client.query(`
      SELECT c.table_name AS t, c.column_name AS c, c.data_type AS type, c.udt_name AS udt
        FROM information_schema.columns c JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public'
         AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json') OR c.udt_name IN ('citext', '_text', '_citext'))`)).rows;
    const pattern = emails.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    for (const col of columns) {
      const hit = (await client.query(`SELECT count(*)::int AS n FROM ${q(col.t)} WHERE ${q(col.c)}::text ~* $1`, [pattern])).rows[0].n;
      if (!hit) continue;
      if (PROTECTED.has(col.t)) { notes.push(`${col.t}.${col.c}: ${hit} row(s) hold the email and cannot be changed (append-only)`); continue; }
      const isArray = col.udt === '_text' || col.udt === '_citext';
      if (!isArray && /email/i.test(col.c)) {
        const del = await tryQuery(`DELETE FROM ${q(col.t)} WHERE lower(${q(col.c)}::text) = ANY($1)`, [emails]);
        if (del.ok && del.r.rowCount) bump(col.t, 'deleted', del.r.rowCount);
      }
      const replaced = isArray
        ? await tryQuery(`UPDATE ${q(col.t)} SET ${q(col.c)} = ARRAY(SELECT x FROM unnest(${q(col.c)}) x WHERE lower(x::text) <> ALL($2))
            WHERE ${q(col.c)}::text ~* $1`, [pattern, emails])
        : col.type === 'jsonb' || col.type === 'json'
          ? await tryQuery(`UPDATE ${q(col.t)} SET ${q(col.c)} = regexp_replace(${q(col.c)}::text, $1, '${ERASED}', 'gi')::${col.type}
              WHERE ${q(col.c)}::text ~* $1`, [pattern])
          : await tryQuery(`UPDATE ${q(col.t)} SET ${q(col.c)} = regexp_replace(${q(col.c)}::text, $1, '${ERASED}', 'gi')
              WHERE ${q(col.c)}::text ~* $1`, [pattern]);
      if (replaced.ok) bump(col.t, 'scrubbed', replaced.r.rowCount);
      else notes.push(`${col.t}.${col.c}: could not be cleaned (${replaced.err.message.split('\n')[0]})`);
    }

    // ── report ───────────────────────────────────────────────────────────────
    // Rows kept and then anonymized are reported as anonymized only.
    for (const [t, set] of keptRows) bump(t, 'retained', set.size);
    log(`\n${commit ? 'Done' : 'Would do'}, table by table:`);
    for (const [t, s] of [...stats.entries()].sort()) {
      const parts = [];
      if (s.deleted) parts.push(`${s.deleted} deleted`);
      if (s.nulled) parts.push(`${s.nulled} unlinked`);
      if (s.retained) parts.push(`${s.retained} kept (refused)`);
      if (s.scrubbed) parts.push(`${s.scrubbed} anonymized`);
      if (parts.length) log(`  ${t.padEnd(32)} ${parts.join(', ')}`);
    }
    if (notes.length) { log('\nNotes:'); for (const n of notes) log(`  · ${n}`); }
    log('\nOutside this database (do by hand if they exist):');
    log('  · the organizer\'s Stripe connected account — close it in the Stripe dashboard;');
    log('  · the email provider\'s contact lists (Brevo) — delete the contact there;');
    log('  · database backups keep old copies until they age out.');

    if (!commit) {
      await client.query('ROLLBACK');
      log('\nDRY RUN — nothing was changed. Add --commit --project <ref> to do it.');
      return;
    }
    if (!assumeYes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((r) => rl.question('\nType ERASE to commit this, anything else to cancel: ', r));
      rl.close();
      if (answer.trim() !== 'ERASE') { await client.query('ROLLBACK'); log('Cancelled. Nothing was changed.'); return; }
    }
    await client.query('COMMIT');
    log('Committed.');

    // ── files, once the rows are gone ────────────────────────────────────────
    await removeFiles([...eventIds.map((id) => `events/${id}`), ...orgIds.map((id) => `organizers/${id}`)]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

/** The events' and organizers' images in storage. Best effort: rows first. */
async function removeFiles(folders) {
  if (!folders.length || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (folders.length) log('Storage: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — files were not removed.');
    return;
  }
  const { supabase } = require('../config/supabase');
  let removed = 0;
  for (const folder of folders) {
    const stack = [folder];
    while (stack.length) {
      const dir = stack.pop();
      const { data, error } = await supabase.storage.from('event-media').list(dir, { limit: 1000 });
      if (error || !data) continue;
      const files = data.filter((o) => o.id).map((o) => `${dir}/${o.name}`);
      for (const o of data) if (!o.id) stack.push(`${dir}/${o.name}`);
      if (files.length) {
        const { error: rmError } = await supabase.storage.from('event-media').remove(files);
        if (!rmError) removed += files.length;
      }
    }
  }
  log(`Storage: ${removed} file(s) removed.`);
}

main().catch((err) => {
  console.error(`Failed — nothing was changed: ${err.message}`);
  process.exit(1);
});
