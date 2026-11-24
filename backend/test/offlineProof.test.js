const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Proof of payment — the storage half (2026-11-24). The database half (the
 * record, the log, refused once paid) is proved against a real database in
 * test/integration/offlineAssurances.test.js; this proves the upload steps
 * with storage stubbed: the private bucket, the path a buyer may write, the
 * check that the file landed, and the replaced receipt removed.
 */
const root = path.join(__dirname, '..');
function stub(rel, exports) {
  const file = require.resolve(path.join(root, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const ID = '11111111-2222-4333-8444-555555555555';
const calls = [];
let objects = [];
let status = 'awaiting';
let previous = null;

const chain = () => {
  const q = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: { id: ID, status, reference_code: 'AB12-CD34', amount_cents: 50000, currency: 'EGP', method: {}, events: null, organizers: null, proof_uploaded_at: new Date().toISOString(), proof_content_type: 'image/png' }, error: null });
  return q;
};
stub('config/supabase.js', {
  supabase: {
    from: () => chain(),
    rpc: async (fn, args) => { calls.push({ fn, args }); return { data: { ok: true, previous_path: previous }, error: null }; },
    storage: {
      from: (bucket) => ({
        createSignedUploadUrl: async (p) => { calls.push({ fn: 'sign', bucket, p }); return { data: { signedUrl: `https://storage.test/${p}?token=t` }, error: null }; },
        list: async (dir, { search }) => { calls.push({ fn: 'list', bucket, dir }); return { data: objects.filter((o) => o === `${dir}/${search}`).map((o) => ({ name: o.split('/').pop() })), error: null }; },
        remove: async (paths) => { calls.push({ fn: 'remove', bucket, paths }); return { data: [], error: null }; },
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/${p}?token=t` })), error: null }),
      }),
    },
  },
});
stub('services/accessTokens.js', {
  readOfflineToken: (t) => (t === 'good' ? ID : null),
  issueOrderToken: () => 'order-token',
  issueOfflineToken: () => 'good',
});

const offline = require('../services/offlineCheckoutService');

test('only photos and PDFs, only with the buyer\'s link, only while unpaid', async () => {
  await assert.rejects(offline.signProofUpload(ID, 'good', 'text/html'), (e) => e.code === 'UNSUPPORTED_MEDIA_TYPE');
  await assert.rejects(offline.signProofUpload(ID, 'wrong', 'image/png'), (e) => e.code === 'NOT_FOUND');
  status = 'paid';
  await assert.rejects(offline.signProofUpload(ID, 'good', 'image/png'), (e) => e.code === 'CONFLICT');
  status = 'awaiting';
});

test('the upload is signed into the PRIVATE receipts bucket, under this reservation only', async () => {
  const signed = await offline.signProofUpload(ID, 'good', 'image/jpeg');
  assert.match(signed.path, new RegExp(`^offline/${ID}/proof-[0-9a-f]{16}\\.jpg$`));
  assert.equal(calls.at(-1).bucket, 'payment-proofs');
  assert.equal(signed.method, 'PUT');
});

test('attaching checks the file landed under this reservation, records it, and removes the one it replaced', async () => {
  await assert.rejects(offline.attachProof(ID, 'good', 'offline/other-id/proof-x.png'), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(offline.attachProof(ID, 'good', `offline/${ID}/../x.png`), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(offline.attachProof(ID, 'good', `offline/${ID}/proof-missing.png`), (e) => e.code === 'NOT_FOUND');

  const p = `offline/${ID}/proof-0123456789abcdef.pdf`;
  objects = [p];
  previous = `offline/${ID}/proof-old.png`;
  calls.length = 0;
  const view = await offline.attachProof(ID, 'good', p);
  const rpc = calls.find((c) => c.fn === 'offline_attach_proof');
  assert.deepEqual(rpc.args, { p_offline_id: ID, p_path: p, p_content_type: 'application/pdf' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.find((c) => c.fn === 'remove')?.paths, [previous], 'the old receipt is not kept');
  assert.ok(view.proof?.uploadedAt);
});
