#!/usr/bin/env node
/**
 * Runs the Maestro flows (mobile/maestro) on a phone connected by USB, against
 * the local demo, with the ticket codes taken from .demo/checkin-demo.json.
 *
 *   node scripts/e2e.js [--metro http://192.168.1.6:8081] [flow.yaml]
 *
 * Needs: the Android development build on the phone, `adb devices` listing it,
 * the Maestro CLI (https://maestro.dev), Metro running (npx expo start
 * --dev-client), the local API and a seeded demo. Run `rearm` first: flow 01
 * admits John Smith, and flow 03 admits Michael Brown 1.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const demoFile = path.join(root, '.demo', 'checkin-demo.json');
if (!fs.existsSync(demoFile)) {
  console.error('No demo. In backend: node scripts/demo-checkin.js seed --site http://<LAN-IP>:3000');
  process.exit(1);
}
const demo = JSON.parse(fs.readFileSync(demoFile, 'utf8'));
const code = (prefix) => {
  const t = demo.tickets.find((x) => x.label.startsWith(prefix));
  if (!t?.qr) throw new Error(`No ticket on the demo sheet starts with "${prefix}"`);
  return t.qr;
};

const argAt = process.argv.indexOf('--metro');
const envFile = path.join(__dirname, '..', '.env.local');
const lanHost = fs.existsSync(envFile)
  ? (fs.readFileSync(envFile, 'utf8').match(/EXPO_PUBLIC_API_URL=https?:\/\/([^:/\s]+)/) || [])[1]
  : null;
const metro = argAt > 0 ? process.argv[argAt + 1] : `http://${lanHost || '127.0.0.1'}:8081`;
const flow = process.argv.slice(2).find((a) => a.endsWith('.yaml'));

const env = {
  METRO_LINK: `eventsli-checkin://expo-development-client/?url=${encodeURIComponent(metro)}`,
  ORGANIZER_EMAIL: demo.accounts.organizer,
  PASSWORD: demo.password,
  QR_JOHN_1: code('John Smith · ticket 1'),
  QR_NOAH: code('Noah Wilson'),
  QR_MIA_OLD: code('Mia Johnson · OLD'),
  QR_FORGED: code('Forged code'),
  QR_GRACE: code('Grace Lee'),
  QR_MICHAEL_1: code('Michael Brown · ticket 1'),
};

const args = ['test', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  flow ? path.join(__dirname, '..', 'maestro', flow) : path.join(__dirname, '..', 'maestro')];
console.log(`Maestro against Metro at ${metro}${flow ? `, flow ${flow}` : ''}`);
const run = spawnSync('maestro', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (run.error) {
  console.error('Could not start Maestro. Install it from https://maestro.dev and check `adb devices`.');
  process.exit(1);
}
process.exit(run.status ?? 1);
