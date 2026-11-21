const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const R = require('./vendorRules');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDOR DOCUMENTS (owner, 2026-11-21) — the licences, insurance certificates
 * and permits an organizer asks vendors for, in the PRIVATE `vendor-documents`
 * bucket (migration 20261204090000).
 *
 * The same three steps as every upload in this API (mediaService.js explains
 * them): the server chooses the key and signs one upload, the browser PUTs the
 * file, and the server confirms the object exists before it is recorded.
 * What differs is reading: the bucket is private, so every view is a signed
 * link that lasts five minutes, made for someone already allowed to see it.
 *
 * Keys: vendor-docs/<event>/<application>/<doc id>-<16 hex>.<ext>
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BUCKET = 'vendor-documents';
const UPLOAD_TTL_SECONDS = 600;
const READ_TTL_SECONDS = 300;
const { fail } = R;

function unavailable(error) {
  const text = String(error?.message || '').toLowerCase();
  return text.includes('bucket not found') || text.includes('not found: bucket');
}

async function signUpload({ eventId, appId, docId, contentType }) {
  const ext = R.DOC_TYPES[String(contentType || '').toLowerCase()];
  if (!ext) throw fail('VALIDATION_ERROR', 'Upload a PDF, or a JPEG, PNG or WebP image.');
  if (!/^[a-z0-9_-]{1,24}$/i.test(String(docId || ''))) throw fail('VALIDATION_ERROR', 'Unknown document.');
  const path = `vendor-docs/${eventId}/${appId}/${docId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { expiresIn: UPLOAD_TTL_SECONDS });
  if (error) {
    if (unavailable(error)) throw fail('STORAGE_NOT_CONFIGURED', 'Document uploads are not available on this deployment yet.');
    throw new Error(error.message);
  }
  return { uploadUrl: data.signedUrl, path, expiresIn: UPLOAD_TTL_SECONDS, maxBytes: R.DOC_MAX_BYTES, method: 'PUT', contentType };
}

/** The object at `path`, confirmed to exist and to fit. → { size, contentType } */
async function confirm({ eventId, appId, docId, path }) {
  if (!R.ownDocumentPath(eventId, appId, docId, path)) throw fail('VALIDATION_ERROR', 'That file does not belong to this booking.');
  const dir = path.slice(0, path.lastIndexOf('/'));
  const name = path.slice(dir.length + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
  if (error) {
    if (unavailable(error)) throw fail('STORAGE_NOT_CONFIGURED', 'Document uploads are not available on this deployment yet.');
    throw new Error(error.message);
  }
  const object = (data || []).find((o) => o.name === name);
  if (!object) throw fail('NOT_FOUND', 'That file was not uploaded. Try again.');
  const size = Number(object.metadata?.size ?? 0);
  if (size > R.DOC_MAX_BYTES) {
    await remove(path);
    throw fail('VALIDATION_ERROR', `That file is larger than ${Math.round(R.DOC_MAX_BYTES / 1048576)} MB.`);
  }
  return { size, contentType: object.metadata?.mimetype || null };
}

/** A five-minute link to read one document. */
async function readUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, READ_TTL_SECONDS);
  if (error) {
    if (unavailable(error)) throw fail('STORAGE_NOT_CONFIGURED', 'Documents are not available on this deployment yet.');
    throw new Error(error.message);
  }
  return { url: data.signedUrl, expiresIn: READ_TTL_SECONDS };
}

/** Best effort, as mediaService.remove: a leftover file costs bytes, nothing else. */
async function remove(path) {
  if (!path) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

/**
 * The application's document list after one upload: the entry for `docId` is
 * replaced and goes back to "pending" review. Returns { list, previous }.
 */
function withUpload(list, spec, { docId, path, fileName, size, contentType }) {
  const asked = (spec || []).find((s) => s.id === docId);
  if (!asked) throw fail('VALIDATION_ERROR', 'The organizer does not ask for that document.');
  const current = Array.isArray(list) ? list : [];
  const previous = current.find((d) => d.id === docId) || null;
  const entry = {
    id: docId,
    label: asked.label,
    path,
    fileName: String(fileName || '').replace(/[\\/]/g, '').trim().slice(0, 120) || `${asked.label}`,
    contentType: contentType || null,
    size: Number(size) || 0,
    uploadedAt: new Date().toISOString(),
    status: 'pending',
    note: null,
  };
  return { list: [...current.filter((d) => d.id !== docId), entry], previous };
}

module.exports = { BUCKET, signUpload, confirm, readUrl, remove, withUpload };
