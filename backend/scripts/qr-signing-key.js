#!/usr/bin/env node
/**
 * Makes a QR v2 signing key (ECDSA P-256) and prints the two lines to paste
 * into backend/.env. See services/qrSigning.js.
 *
 *   node scripts/qr-signing-key.js            kid = this month, e.g. 2026-11
 *   node scripts/qr-signing-key.js my-kid
 *
 * The private key is printed, not saved: put it in the server's .env (or the
 * secret store) and nowhere else. Its public half is what GET /scan/keys
 * hands to devices. When rotating, keep the OLD public key in
 * QR_SIGNING_RETIRED_KEYS (printed below as well) until its events are over.
 */
const crypto = require('crypto');

const kid = process.argv[2] || new Date().toISOString().slice(0, 7);
if (!/^[A-Za-z0-9._-]{1,32}$/.test(kid)) {
  console.error('The kid must be 1-32 characters of A-Z a-z 0-9 . _ -');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const oneLine = (s) => s.trim().replace(/\n/g, '\\n');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });

console.log('# Paste into backend/.env (keep the quotes):');
console.log(`QR_SIGNING_KID=${kid}`);
console.log(`QR_SIGNING_KEY="${oneLine(priv)}"`);
console.log('');
console.log('# Only when this key is later RETIRED, its public half goes in QR_SIGNING_RETIRED_KEYS:');
console.log(`# {"${kid}": "${oneLine(pub)}"}`);
