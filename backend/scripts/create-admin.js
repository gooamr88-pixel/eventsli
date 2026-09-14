/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The first account.
 *
 *   node scripts/create-admin.js <email> <role>
 *
 * A chicken-and-egg problem: only a super admin can grant a staff role (BRD
 * §19, rule 3 — otherwise `admin` is a role that mints more of itself), so the
 * first one cannot be made through the API. It has to be made here, once.
 *
 * The password is READ FROM A PROMPT, never from an argument. An argument goes
 * into shell history and into `ps` output, where any other user on the box can
 * read it while the command runs.
 *
 * The hash is produced by the same `utils/crypto` the API uses, so the account
 * this creates is indistinguishable from one created by signing up — same
 * PBKDF2-HMAC-SHA512, same 210,000 iterations, same self-describing format.
 * Writing a hash by hand here is how you get an account that cannot log in.
 * ═══════════════════════════════════════════════════════════════════════════ */
require('dotenv').config();
const readline = require('node:readline');
const { connect } = require('./db');
const { hashPassword } = require('../utils/crypto');

const ROLES = ['attendee', 'organizer', 'admin', 'super_admin'];

/** Reads without echoing. `readline`'s own hidden input is not portable, so the
 *  terminal's echo is turned off directly. */
function askSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) process.stdin.pause();
    };
    process.stdin.on('data', onData);
    rl.question(prompt, (answer) => {
      process.stdout.write('\n');
      process.stdin.removeListener('data', onData);
      rl.close();
      resolve(answer);
    });
    rl._writeToOutput = () => {};
  });
}

(async () => {
  const [email, role = 'super_admin'] = process.argv.slice(2);

  if (!email || !email.includes('@')) {
    console.error('usage: node scripts/create-admin.js <email> [role]');
    console.error(`       role is one of: ${ROLES.join(', ')} (default super_admin)`);
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Unknown role "${role}". One of: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  /**
   * The prompt is the normal path. `ADMIN_PASSWORD` exists for the case where
   * the shell mangles an interactive read — Windows PowerShell piping into
   * `node -e` does — and it is deliberately an ENV VAR rather than an argument:
   * an argument is visible in `ps` to every other user on the box for as long
   * as the command runs, and lands in shell history. An env var set for one
   * command is neither.
   */
  const password = process.env.ADMIN_PASSWORD || await askSecret(`Password for ${email}: `);
  if (process.env.ADMIN_PASSWORD) console.log('using ADMIN_PASSWORD from the environment');
  if (String(password).length < 10) {
    console.error('Too short. The API requires a real password; so does this.');
    process.exit(1);
  }

  const db = await connect({ quiet: false });

  const { rows: existing } = await db.query('SELECT id, role FROM profiles WHERE email = $1', [email]);

  const hash = await hashPassword(password);

  if (existing.length) {
    await db.query(
      `UPDATE profiles
          SET password_hash = $2, password_algo = 'pbkdf2', password_updated_at = now(),
              role = $3, is_blocked = false, failed_login_count = 0, locked_until = NULL,
              email_verified_at = COALESCE(email_verified_at, now()),
              updated_at = now()
        WHERE email = $1`,
      [email, hash, role],
    );
    console.log(`\n✓ updated ${email} — role ${existing[0].role} → ${role}, password reset`);
  } else {
    await db.query(
      `INSERT INTO profiles (email, full_name, role, password_hash, password_algo,
                             password_updated_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'pbkdf2', now(), now())`,
      [email, email.split('@')[0], role, hash],
    );
    console.log(`\n✓ created ${email} as ${role}`);
  }

  // Verifying here rather than trusting the INSERT: a hash the API cannot read
  // back is an account that looks fine in the table and cannot sign in.
  const { verifyPassword } = require('../utils/crypto');
  const { rows: check } = await db.query('SELECT password_hash FROM profiles WHERE email = $1', [email]);
  const { ok } = await verifyPassword(password, check[0].password_hash);
  console.log(ok ? '  password verifies against the stored hash' : '  ✗ HASH DOES NOT VERIFY');

  const { rows: all } = await db.query('SELECT role, count(*) FROM profiles GROUP BY role ORDER BY 1');
  console.log('\naccounts now:');
  for (const r of all) console.log(`  ${String(r.count).padStart(3)}  ${r.role}`);

  await db.end();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
