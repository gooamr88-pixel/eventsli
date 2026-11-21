'use client';

import { useRef, useState } from 'react';
import { post, get, del } from '../../../utils/apiClient';
import { messageFor } from '../../../utils/errors';
import NavIcon from '../../shell/NavIcon';

const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const STATUS = {
  pending: { label: 'Waiting for review', pill: 'es-pill--warning' },
  approved: { label: 'Approved', pill: 'es-pill--accent' },
  rejected: { label: 'Not accepted', pill: 'es-pill--danger' },
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Add Documents — submit your files for organizer review and approval"
 * (owner's reference, 2026-11-21). One dashed tile per document the organizer
 * asks for; each uploads on its own, straight to the PRIVATE documents bucket
 * through a signed URL (backend services/vendorDocuments.js), so a large PDF
 * never waits on the rest of the form.
 *
 * `base` is /partner/vendors/bookings/<id>. `onChange(booking)` gets the
 * booking back after each change. `locked` hides Remove once the booking has
 * been sent (a rejected file is replaced instead).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function DocumentsCard({ base, spec, documents, onChange, locked = false, title = 'Add Documents' }) {
  if (!spec?.length) return null;
  const byId = new Map((documents || []).map((d) => [d.id, d]));
  return (
    <section className="es-vb-card es-vb-form" aria-labelledby="vb-docs">
      <h2 id="vb-docs" className="es-vb-card__title es-vb-card__title--icon">
        {title}
        <span className="es-vb-info" title="Only the organizer of this event can open your files."><NavIcon name="info" size={18} /></span>
      </h2>
      <p className="es-vb-card__lede">Submit your files for organizer review and approval.</p>
      <ul className="es-vb-docs">
        {spec.map((s) => <DocTile key={s.id} base={base} spec={s} doc={byId.get(s.id)} onChange={onChange} locked={locked} />)}
      </ul>
    </section>
  );
}

function DocTile({ base, spec, doc, onChange, locked }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const status = doc ? STATUS[doc.status] || STATUS.pending : null;

  async function upload(file) {
    setError(null);
    if (!TYPES.includes(file.type)) { setError('Upload a PDF, or a JPEG, PNG or WebP image.'); return; }
    setBusy('upload');
    try {
      const signed = await post(`${base}/documents/${spec.id}/upload`, { contentType: file.type }, { noRedirect: true });
      if (file.size > signed.maxBytes) throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${Math.round(signed.maxBytes / 1048576)} MB.`);
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('The file did not upload. Try again.');
      onChange(await post(`${base}/documents/${spec.id}`, { path: signed.path, fileName: file.name }, { noRedirect: true }));
    } catch (err) {
      setError(err?.code ? messageFor(err) : err.message);
    } finally {
      setBusy(null);
    }
  }

  async function view() {
    setBusy('view');
    try {
      const { url } = await get(`${base}/documents/${spec.id}`, { cache: 'no-store', noRedirect: true });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      onChange(await del(`${base}/documents/${spec.id}`, { noRedirect: true }));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  const canReplace = !doc || doc.status !== 'approved';
  return (
    <li className="es-vb-doc">
      <p className="es-vb-doc__label">
        {spec.label}{spec.required && <span className="es-req" aria-hidden="true">*</span>}
        {spec.required && <span className="sr-only"> (required)</span>}
      </p>
      {doc?.uploaded ? (
        <div className={`es-vb-doc__tile is-filled ${doc.status === 'rejected' ? 'is-rejected' : ''}`}>
          <span className="es-vb-doc__file"><NavIcon name="fileText" size={28} /></span>
          <span className="es-vb-doc__name fx-break">{doc.fileName}</span>
          <span className={`es-pill ${status.pill}`}>{status.label}</span>
          {doc.status === 'rejected' && doc.note && <span className="es-vb-doc__note fx-break">{doc.note}</span>}
          <span className="es-vb-doc__actions">
            <button type="button" className="es-vb-link" onClick={view} disabled={!!busy}>{busy === 'view' ? 'Opening…' : 'View'}</button>
            {canReplace && <button type="button" className="es-vb-link" onClick={() => input.current?.click()} disabled={!!busy}>{busy === 'upload' ? 'Uploading…' : 'Replace'}</button>}
            {!locked && <button type="button" className="es-vb-link es-vb-link--danger" onClick={remove} disabled={!!busy}>Remove</button>}
          </span>
        </div>
      ) : (
        <button type="button" className="es-vb-doc__tile" onClick={() => input.current?.click()} disabled={!!busy} aria-busy={busy === 'upload' || undefined}>
          <span className="es-vb-doc__cloud" aria-hidden="true"><CloudUp /></span>
          <span className="es-vb-doc__cta">{busy === 'upload' ? 'Uploading…' : 'Upload your file'}</span>
          <span className="es-vb-doc__types">Upload your document (<u>Image</u> or <u>PDF</u>)</span>
          {spec.hint && <span className="es-vb-doc__types">{spec.hint}</span>}
        </button>
      )}
      <input ref={input} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} aria-label={`Choose a file for ${spec.label}`}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </li>
  );
}

function CloudUp() {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18.5h-.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 8.6 4.5 4.5 0 0 1 17.5 18.5H17" />
      <circle cx="12" cy="15" r="4.2" />
      <path d="M12 17v-4M10.4 14.4 12 12.8l1.6 1.6" />
    </svg>
  );
}
