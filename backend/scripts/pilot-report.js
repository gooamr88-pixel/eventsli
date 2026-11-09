#!/usr/bin/env node
/**
 * What happened at the door, for one event: the numbers the pilot is judged
 * on (docs/CHECKIN-PILOT.md).
 *
 *   node scripts/pilot-report.js --event <eventId>
 *
 * READ-ONLY: it only selects. It reads whichever database backend/.env points
 * at, so on the server it reports on the real pilot; on a laptop, on the
 * local demo (`--event` from .demo/checkin-demo.json).
 *
 *   • admitted against issued
 *   • per door: admissions, guests per minute while it was busy, its peak minute
 *   • the whole gate: the busiest 5 and 15 minutes
 *   • how admissions were taken: scanned, by hand, offline — and how long the
 *     offline ones took to reach the server
 *   • refusals by reason, and offline conflicts
 */
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { supabase } = require('../config/supabase');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const mins = (ms) => (ms === null ? '—' : ms < 60e3 ? `${Math.round(ms / 1000)} s` : `${(ms / 60e3).toFixed(1)} min`);

async function main() {
  const eventId = arg('event');
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    console.error('Usage: node scripts/pilot-report.js --event <eventId>');
    process.exit(1);
  }
  const event = must(await supabase.from('events').select('title, starts_at, ends_at, timezone').eq('id', eventId).single(), 'event');
  const stats = must(await supabase.rpc('event_checkin_stats', { p_event_id: eventId }), 'stats');
  const devices = new Map(must(await supabase.from('scan_devices').select('id, label').eq('event_id', eventId), 'devices').map((d) => [d.id, d.label]));

  const scans = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await supabase.from('scans')
      .select('device_id, result, method, conflict, occurred_at, scanned_at')
      .eq('event_id', eventId).order('occurred_at').range(from, from + 999), 'scans');
    scans.push(...page);
    if (page.length < 1000) break;
  }
  const admitted = scans.filter((s) => s.result === 'admitted');
  const undone = scans.filter((s) => s.result === 'undone').length;
  const issued = (stats?.admitted || 0) + (stats?.pending || 0);

  console.log(`${event.title}  (${event.starts_at} → ${event.ends_at}, ${event.timezone})`);
  console.log(`Admitted ${stats?.admitted ?? 0} of ${issued} (${issued ? Math.round((100 * (stats?.admitted || 0)) / issued) : 0} %). Undone: ${undone}. Door log rows: ${scans.length}.`);

  // ── Per door ──
  const byDoor = new Map();
  for (const s of admitted) {
    const key = devices.get(s.device_id) || (s.device_id ? s.device_id.slice(0, 8) : 'no device (seeded or web)');
    if (!byDoor.has(key)) byDoor.set(key, []);
    byDoor.get(key).push(Date.parse(s.occurred_at));
  }
  console.log('\nPer door (guests per minute counts only minutes with at least one admission):');
  for (const [door, times] of [...byDoor.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const perMinute = new Map();
    for (const t of times) perMinute.set(Math.floor(t / 60e3), (perMinute.get(Math.floor(t / 60e3)) || 0) + 1);
    const busy = [...perMinute.values()];
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    console.log(`  ${door.padEnd(28)} ${String(times.length).padStart(5)} in · ${(times.length / busy.length).toFixed(1)}/min busy · peak ${Math.max(...busy)}/min · median gap ${mins(pct(gaps, 50))}`);
  }

  // ── The whole gate ──
  const times = admitted.map((s) => Date.parse(s.occurred_at)).sort((a, b) => a - b);
  const busiest = (windowMs) => {
    let best = { n: 0, at: null };
    for (let i = 0, j = 0; i < times.length; i += 1) {
      while (times[i] - times[j] >= windowMs) j += 1;
      if (i - j + 1 > best.n) best = { n: i - j + 1, at: times[j] };
    }
    return best;
  };
  const b5 = busiest(5 * 60e3);
  const b15 = busiest(15 * 60e3);
  console.log(`\nWhole gate: busiest 5 min ${b5.n} in (${(b5.n / 5).toFixed(1)}/min) from ${b5.at ? new Date(b5.at).toISOString() : '—'}; busiest 15 min ${b15.n} in (${(b15.n / 15).toFixed(1)}/min).`);

  // ── How ──
  const count = (list, key) => list.reduce((acc, s) => ({ ...acc, [s[key]]: (acc[s[key]] || 0) + 1 }), {});
  const offline = admitted.filter((s) => s.method === 'offline');
  const lag = offline.map((s) => Date.parse(s.scanned_at) - Date.parse(s.occurred_at)).filter((ms) => ms >= 0).sort((a, b) => a - b);
  console.log(`\nAdmissions by method: ${JSON.stringify(count(admitted, 'method'))}`);
  console.log(`Offline admissions reached the server after: median ${mins(pct(lag, 50))}, p95 ${mins(pct(lag, 95))}, longest ${mins(lag.at(-1) ?? null)}.`);
  console.log(`Refusals: ${JSON.stringify(count(scans.filter((s) => !['admitted', 'undone'].includes(s.result)), 'result'))}`);
  const conflicts = scans.filter((s) => s.conflict).length;
  console.log(`Offline conflicts (let in at two doors): ${conflicts}${conflicts ? ' — see the event\'s Attendees page, filter "Let in twice".' : ''}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
