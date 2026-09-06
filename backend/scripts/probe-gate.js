/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The gate, against the live API.
 *
 *   node scripts/probe-gate.js
 *
 * This is phase 7's definition of done, executed rather than asserted:
 *
 *   "Scan a ticket twice offline, sync, and the second answer is the duplicate
 *    — carrying the FIRST scan's device time."
 *
 * The frontend's unit tests cover the queue's half of that on plain arrays.
 * They cannot cover the half that matters most, which is that `check_in_ticket`
 * really does hold the line under a replay: the same client scan id returns the
 * ORIGINAL answer instead of refusing a re-uploaded scan as a duplicate of
 * itself, and a genuine second presentation of the same ticket comes back timed
 * by the first scan's clock and not by the upload's.
 *
 * WRITES, and cleans up after itself. Everything it creates is deleted and the
 * ticket it admits is put back exactly as it was found. Nothing here touches
 * money, Stripe, or any row it did not create — except the one ticket, which is
 * restored.
 * ═══════════════════════════════════════════════════════════════════════════ */
require('dotenv').config();

const { connect } = require('./db');
const scanSvc = require('../services/scanService');
const { issueQrToken } = require('../services/ticketService');

const API = (process.env.PROBE_API_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/+$/, '');
const PIN = '481902';

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ''}`); } else { failed += 1; console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); }
}

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

/** The device's own clock, which is the whole point of `occurredAt`. */
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16);

(async () => {
  const db = await connect({ quiet: false });
  const made = { deviceId: null, ticketId: null, ticketWas: null };

  try {
    // ── Find a ticket to work with ──────────────────────────────────────────
    const { rows: candidates } = await db.query(`
      SELECT t.id, t.event_id, t.status, t.scanned_at, e.title
        FROM tickets t
        JOIN events e ON e.id = t.event_id
       WHERE t.status = 'valid'
       ORDER BY t.created_at DESC
       LIMIT 1`);

    if (!candidates.length) {
      console.log('No ticket with status `valid` exists. Sell one first — this probe '
        + 'admits a real ticket and puts it back, it does not invent one.');
      process.exit(1);
    }

    const ticket = candidates[0];
    made.ticketId = ticket.id;
    made.ticketWas = { status: ticket.status, scannedAt: ticket.scanned_at };
    console.log(`\nticket ${ticket.id}  ·  event "${ticket.title}"\n`);

    // A locked gate refuses every scan below with `scanner_locked`, correctly,
    // and the probe would read as a wall of failures for the one reason that is
    // not a bug. Say so up front instead.
    const { rows: gate } = await db.query('SELECT scanner_is_locked($1) AS g', [ticket.event_id]);
    if (gate[0].g.locked) {
      console.log(`This event's gate is LOCKED (${gate[0].g.reason}). BRD §18 means every `
        + 'scan is refused until the commission invoice is settled. Nothing below would '
        + 'be a fair test — settle it or pick another event.');
      process.exit(1);
    }

    const qr = issueQrToken({ ticketId: ticket.id, eventId: ticket.event_id });

    // ── A device, registered the way an organizer registers one ─────────────
    const device = await scanSvc.registerDevice({
      eventId: ticket.event_id, label: 'probe-gate (temporary)', pin: PIN,
    });
    made.deviceId = device.id;

    console.log('── sign in ──');
    const login = await call('/scan/login', { method: 'POST', body: { deviceId: device.id, pin: PIN } });
    check('a device signs in with its id and PIN', login.status === 200 && !!login.body?.data?.token);
    const token = login.body?.data?.token;

    const wrongPin = await call('/scan/login', { method: 'POST', body: { deviceId: device.id, pin: '000000' } });
    check('a wrong PIN is refused', wrongPin.status === 401, wrongPin.body?.error);

    const noToken = await call('/scan/status');
    check('no token opens nothing', noToken.status === 401, noToken.body?.error);

    // ═══ THE DEFINITION OF DONE ══════════════════════════════════════════════
    // Two scans of one ticket, taken OFFLINE — so nothing was sent at the time
    // — each with its own client id and its own device timestamp. Then one
    // upload, exactly as the tablet would make it when signal returns.
    console.log('\n── the offline queue (phase 7 DoD) ──');
    const first = { qr, clientScanId: `probe-1-${Date.now()}`, occurredAt: minutesAgo(9) };
    const second = { qr, clientScanId: `probe-2-${Date.now()}`, occurredAt: minutesAgo(7) };

    const sync = await call('/scan/sync', { method: 'POST', token, body: { scans: [first, second] } });
    check('the queue uploads', sync.status === 200);

    const results = sync.body?.data?.results || [];
    const a = results.find((r) => r.clientScanId === first.clientScanId);
    const b = results.find((r) => r.clientScanId === second.clientScanId);

    check('each scan gets its own answer, keyed by the id the DEVICE made',
      results.length === 2 && !!a && !!b);
    check('the first is admitted', a?.result === 'admitted', a?.result);
    check('and it is stamped with the DOOR\'s clock, not the upload\'s',
      a?.scanned_at && Math.abs(Date.parse(a.scanned_at) - Date.parse(first.occurredAt)) < 1000,
      `${hhmm(a?.scanned_at || 0)} vs ${hhmm(first.occurredAt)}`);

    check('the second is the duplicate', b?.result === 'duplicate', b?.result);
    check('carrying the FIRST scan\'s device time',
      b?.scanned_at && Math.abs(Date.parse(b.scanned_at) - Date.parse(first.occurredAt)) < 1000,
      `${hhmm(b?.scanned_at || 0)} vs ${hhmm(first.occurredAt)}`);
    check('and a message a person can read out at the door',
      typeof b?.message === 'string' && /\d{2}:\d{2}/.test(b.message), b?.message);

    check('the summary counts one new admission, not two',
      sync.body?.data?.summary?.admitted === 1, JSON.stringify(sync.body?.data?.summary));

    // ── The same queue, uploaded again ──────────────────────────────────────
    // A tablet that loses its connection mid-upload retries the whole batch.
    // Without the client scan id this is where one guest becomes two refusals.
    console.log('\n── the same queue, uploaded twice ──');
    const replay = await call('/scan/sync', { method: 'POST', token, body: { scans: [first, second] } });
    const ra = (replay.body?.data?.results || []).find((r) => r.clientScanId === first.clientScanId);
    const rb = (replay.body?.data?.results || []).find((r) => r.clientScanId === second.clientScanId);

    check('a replay returns the ORIGINAL answers', ra?.result === 'admitted' && rb?.result === 'duplicate',
      `${ra?.result} / ${rb?.result}`);
    check('and says they are replays', ra?.replay === true && rb?.replay === true);
    check('so the summary claims no new admissions',
      replay.body?.data?.summary?.admitted === 0 && replay.body?.data?.summary?.replayed === 2,
      JSON.stringify(replay.body?.data?.summary));

    // ── A refusal is a 200 ──────────────────────────────────────────────────
    console.log('\n── a refusal is an answer, not an error ──');
    const live = await call('/scan/verify', { method: 'POST', token, body: { qr, clientScanId: `probe-3-${Date.now()}` } });
    check('scanning an already-used ticket is HTTP 200', live.status === 200, String(live.status));
    check('with result `duplicate`', live.body?.data?.result === 'duplicate', live.body?.data?.result);

    const junk = await call('/scan/verify', { method: 'POST', token, body: { qr: 'this-is-not-a-ticket-token' } });
    check('a forged code is 200 + `invalid`, refused without a database read',
      junk.status === 200 && junk.body?.data?.result === 'invalid', junk.body?.data?.result);

    // A real ticket for a different event. The event comes from the TOKEN, so
    // this is the check that one venue's tablet cannot open another's door.
    const { rows: others } = await db.query(
      'SELECT id, event_id FROM tickets WHERE event_id <> $1 LIMIT 1', [ticket.event_id],
    );
    if (others.length) {
      const foreign = issueQrToken({ ticketId: others[0].id, eventId: others[0].event_id });
      const wrong = await call('/scan/verify', { method: 'POST', token, body: { qr: foreign } });
      check('a valid ticket for ANOTHER event does not open this door',
        wrong.status === 200 && wrong.body?.data?.result === 'wrong_event', wrong.body?.data?.result);

      // The gap this phase closed. Undo took a bare ticket id and never checked
      // the event, so a device could reverse an admission at a venue it has
      // nothing to do with — and the id is inside every QR token.
      const crossUndo = await call('/scan/undo', { method: 'POST', token, body: { ticketId: others[0].id } });
      check('and its admission cannot be undone from here either',
        crossUndo.status === 404 && crossUndo.body?.error === 'TICKET_NOT_FOUND',
        `${crossUndo.status} ${crossUndo.body?.error}`);
    } else {
      console.log('  SKIP  no ticket on another event to try — cross-event checks not exercised');
    }

    // ── Undo ────────────────────────────────────────────────────────────────
    console.log('\n── undo ──');
    const undo = await call('/scan/undo', { method: 'POST', token, body: { ticketId: ticket.id } });
    check('an admission can be reversed at the door', undo.status === 200 && undo.body?.data?.ok === true,
      undo.body?.error || '');

    const { rows: after } = await db.query('SELECT status, scanned_at FROM tickets WHERE id = $1', [ticket.id]);
    check('the ticket is scannable again', after[0].status === 'valid' && after[0].scanned_at === null,
      after[0].status);

    const { rows: trail } = await db.query(
      "SELECT result FROM scans WHERE ticket_id = $1 AND result = 'undone'", [ticket.id],
    );
    check('and the reversal is its own log entry, not a deletion', trail.length === 1);

    const undoAgain = await call('/scan/undo', { method: 'POST', token, body: { ticketId: ticket.id } });
    check('undoing an un-admitted ticket is a conflict, not a silent success',
      undoAgain.status === 409, String(undoAgain.status));

    // ── Status ──────────────────────────────────────────────────────────────
    console.log('\n── what the device shows on its bar ──');
    const status = await call('/scan/status', { token });
    const s = status.body?.data;
    check('gate state and the night\'s numbers come back together',
      status.status === 200 && s?.gate && s?.stats);
    check('the numbers are the four the bar renders',
      s && ['issued', 'admitted', 'pending', 'void'].every((k) => typeof s.stats?.[k] === 'number'),
      JSON.stringify(s?.stats));

    // ── Revocation ──────────────────────────────────────────────────────────
    console.log('\n── a tablet goes missing ──');
    await scanSvc.setDeviceActive(device.id, false);
    const revokedLogin = await call('/scan/login', { method: 'POST', body: { deviceId: device.id, pin: PIN } });
    check('a revoked device cannot sign in again', revokedLogin.status === 401);
    check('and is refused in the same words as a wrong PIN',
      revokedLogin.body?.message === wrongPin.body?.message, revokedLogin.body?.message);

    /**
     * The token it already holds must stop working THE SAME INSTANT.
     *
     * This is what the probe caught on its first run: revocation only blocked
     * the next sign-in, and a device token lasts seven days — so a tablet in a
     * taxi went on admitting people for a week after the organizer had switched
     * it off and watched the dashboard say `inactive`.
     */
    const revokedScan = await call('/scan/status', { token });
    check('and the token it is already holding stops working immediately',
      revokedScan.status === 401, `${revokedScan.status} ${revokedScan.body?.error || ''}`);

    const revokedVerify = await call('/scan/verify', { method: 'POST', token, body: { qr } });
    check('a revoked tablet cannot admit anybody', revokedVerify.status === 401,
      `${revokedVerify.status} ${revokedVerify.body?.error || ''}`);
  } finally {
    // ── Put everything back ─────────────────────────────────────────────────
    console.log('\n── cleanup ──');
    if (made.deviceId) {
      await db.query('DELETE FROM scans WHERE device_id = $1', [made.deviceId]);
      await db.query('DELETE FROM scan_devices WHERE id = $1', [made.deviceId]);
      console.log('  removed the probe device and every scan it recorded');
    }
    if (made.ticketId) {
      await db.query('UPDATE tickets SET status = $2, scanned_at = $3 WHERE id = $1',
        [made.ticketId, made.ticketWas.status, made.ticketWas.scannedAt]);
      console.log('  restored the ticket exactly as it was found');
    }
    await db.end();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})().catch((err) => {
  console.error('\nprobe crashed:', err.message);
  process.exit(1);
});
