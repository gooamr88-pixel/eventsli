'use client';

import { useRef, useState } from 'react';
import { post } from '../../../utils/apiClient';
import { describeError } from '../../../utils/errors';
import { formatEventTime } from '../../../lib/eventTime';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PROOF OF PAYMENT (owner, 2026-11-24): "the buyer can upload a photo of the
 * transfer receipt". A photo or a PDF, up to 10 MB, sent privately to the
 * organizer — never public, and replaceable until the payment is confirmed.
 *
 * Signed upload, as every upload here: the API signs a place in the private
 * receipts bucket, the file goes straight there, then the API records it
 * (backend offlineCheckoutService.signProofUpload / attachProof).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

export default function ReceiptUpload({ id, token, proof, timezone, onUploaded }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const q = `?token=${encodeURIComponent(token)}`;

  async function send(file) {
    setError(null);
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Choose a photo (JPEG, PNG, WebP or HEIC) or a PDF of the receipt.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 10 MB. Take a smaller photo or a screenshot of the receipt.');
      return;
    }
    setBusy(true);
    try {
      const signed = await post(`/public/offline-payments/${id}/proof/sign${q}`, { contentType: file.type }, { noRedirect: true });
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('upload');
      const updated = await post(`/public/offline-payments/${id}/proof${q}`, { path: signed.path }, { noRedirect: true });
      onUploaded?.(updated);
    } catch (err) {
      setError(err?.message === 'upload' ? 'The file did not upload. Check your connection and try again.' : describeError(err).title);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section className="es-co__card" aria-labelledby="receipt-title">
      <h2 id="receipt-title" className="es-co__h2">Proof of payment</h2>
      {proof ? (
        <p className="fx-row items-center gap-2 text-sm text-ink">
          <NavIcon name="check" size={16} />
          Receipt sent to the organizer on {formatEventTime(proof.uploadedAt, timezone)}.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Paid already? Upload a photo or screenshot of your transfer receipt. It goes only to the organizer, so they can match your payment faster.
        </p>
      )}
      <input
        ref={input} type="file" accept={ACCEPT} className="sr-only" id="receipt-file"
        onChange={(e) => send(e.target.files?.[0])}
      />
      <div className="mt-3">
        <button type="button" className={`es-btn es-btn--sm ${proof ? 'es-btn--ghost' : 'es-btn--primary'}`} disabled={busy} onClick={() => input.current?.click()}>
          <NavIcon name="receipt" size={16} />
          {busy ? 'Uploading…' : proof ? 'Replace the receipt' : 'Upload the receipt'}
        </button>
      </div>
      <p className="mt-2 text-xs text-subtle">Photo or PDF, up to 10 MB. Not shown to anyone but the organizer.</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
