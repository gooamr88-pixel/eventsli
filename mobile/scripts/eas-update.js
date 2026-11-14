#!/usr/bin/env node
/**
 * Publish an over-the-air update with the SAME settings the store build uses.
 *
 *   node scripts/eas-update.js production "Fix: the guest search"
 *   node scripts/eas-update.js preview "Try the new result card"
 *
 * Why not plain `eas update`: it bundles the JavaScript on this computer, and
 * Expo reads mobile/.env.local while it does — the file that points a
 * development build at a laptop (http://192.168.x.x). eas.json's `env` is
 * applied to cloud BUILDS only, not to updates. A plain `eas update` from a
 * development machine would therefore send every phone in the field to an
 * address only that laptop answers. (The app also refuses a non-HTTPS address
 * in a store build — src/api/client.ts — but a wrong HTTPS one would pass.)
 *
 * This script:
 *   1. takes the profile whose `channel` matches from eas.json,
 *   2. sets that profile's EXPO_PUBLIC_* values and turns .env loading off,
 *   3. refuses anything but HTTPS, and
 *   4. runs `eas update` for that channel.
 * Extra arguments after the message go to eas-cli unchanged.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [channel, message, ...rest] = process.argv.slice(2);
if (!channel || !message) {
  console.error('Usage: node scripts/eas-update.js <channel> "<message>" [extra eas-cli args]');
  process.exit(2);
}

const easJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eas.json'), 'utf8'));
const profile = Object.values(easJson.build || {}).find((p) => p && p.channel === channel);
if (!profile) {
  console.error(`No build profile in eas.json uses the channel "${channel}".`);
  process.exit(2);
}

const env = { ...process.env, EXPO_NO_DOTENV: '1' };
// Nothing EXPO_PUBLIC_* from this shell either: only what the profile says.
for (const key of Object.keys(env)) if (key.startsWith('EXPO_PUBLIC_')) delete env[key];
Object.assign(env, profile.env || {});

const api = env.EXPO_PUBLIC_API_URL;
if (!api || !/^https:\/\//i.test(api)) {
  console.error(`The "${channel}" profile's EXPO_PUBLIC_API_URL must be an https:// address (got ${api || 'nothing'}).`);
  process.exit(2);
}
if (env.EXPO_PUBLIC_SITE_URL && !/^https:\/\//i.test(env.EXPO_PUBLIC_SITE_URL)) {
  console.error('EXPO_PUBLIC_SITE_URL must be an https:// address.');
  process.exit(2);
}

console.log(`Publishing to "${channel}" against ${api} (.env files ignored).`);
const args = ['eas-cli@latest', 'update', '--channel', channel, '--message', message, ...rest];
const windows = process.platform === 'win32';
// Windows runs npx.cmd through a shell, which splits on spaces: quote each one.
const quote = (a) => `"${String(a).replace(/"/g, '\\"')}"`;
const result = windows
  ? spawnSync(['npx', ...args.map(quote)].join(' '), { cwd: path.join(__dirname, '..'), env, stdio: 'inherit', shell: true })
  : spawnSync('npx', args, { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
process.exit(result.status ?? 1);
