'use client';

import { useId, useRef, useState } from 'react';
import { post } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { LEVELS, levelLabel } from './sponsorLevels';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Pieces shared by the organizer's sponsorship screens and the sponsor portal
 * (2026-11-20): how a deal's status and tier read, and the logo picker.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A deal's status (backend sponsorshipRules.status) → words and a pill. */
export const DEAL_STATUS = Object.freeze({
  lead: { label: 'Lead', pill: '' },
  proposal: { label: 'Proposal sent', pill: 'es-pill--warning' },
  signed: { label: 'Signed · awaiting payment', pill: 'es-pill--warning' },
  part_paid: { label: 'Part paid', pill: 'es-pill--warning' },
  paid: { label: 'Paid', pill: 'es-pill--accent' },
  lost: { label: 'Lost', pill: '' },
  cancelled: { label: 'Cancelled', pill: 'es-pill--danger' },
});

/** The sponsor's own view says the same states in their words. */
export const SPONSOR_STATUS = Object.freeze({
  lead: { label: 'Inquiry sent', pill: '' },
  proposal: { label: 'Ready to sign', pill: 'es-pill--warning' },
  signed: { label: 'Signed · payment due', pill: 'es-pill--warning' },
  part_paid: { label: 'Part paid', pill: 'es-pill--warning' },
  paid: { label: 'Complete', pill: 'es-pill--accent' },
  lost: { label: 'Closed', pill: '' },
  cancelled: { label: 'Cancelled', pill: 'es-pill--danger' },
});

// In a plain module so server components can call them too (sponsorLevels.js).
export { LEVELS, levelLabel };

export function StatusPill({ status, sponsor = false, expired = false }) {
  if (expired) return <span className="es-pill es-pill--danger">Expired</span>;
  const s = (sponsor ? SPONSOR_STATUS : DEAL_STATUS)[status] || { label: status, pill: '' };
  return <span className={`es-pill ${s.pill}`}>{s.label}</span>;
}

export function LevelBadge({ level }) {
  return <span className="es-sp-level" data-level={level}>{levelLabel(level)}</span>;
}

/** The agreement text, as written (line breaks kept, never rendered as markup). */
export function AgreementText({ text }) {
  if (!text) return null;
  return <div className="es-sp-terms">{text}</div>;
}

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Upload a logo through the signed-upload steps: sign → PUT → confirm.
 * `base` is the API path that owns `/logo-upload` and `/logo`.
 */
export async function uploadLogo(base, file) {
  if (!TYPES.includes(file.type)) {
    throw Object.assign(new Error('Upload a JPEG, PNG or WebP image.'), { code: 'VALIDATION_ERROR' });
  }
  const signed = await post(`${base}/logo-upload`, { contentType: file.type }, { noRedirect: true });
  if (file.size > signed.maxBytes) {
    throw Object.assign(new Error(
      `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${Math.round(signed.maxBytes / 1048576)} MB.`,
    ), { code: 'VALIDATION_ERROR' });
  }
  const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!uploaded.ok) throw Object.assign(new Error('The logo did not upload. Try again.'), { code: 'CONFLICT' });
  return post(`${base}/logo`, { path: signed.path }, { noRedirect: true });
}

/**
 * The logo picker: a preview, Choose / Remove. `onChange({ url, path } | null)`.
 */
export function LogoField({ base, value, onChange, hint }) {
  const id = useId();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadLogo(base, file));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <span className="es-label"><span>Logo</span><span className="es-optional">Optional</span></span>
      <div className="es-sp-logofield">
        <span className="es-sp-logofield__preview">
          {value?.url
            // eslint-disable-next-line @next/next/no-img-element -- the uploaded logo, straight from storage
            ? <img src={value.url} alt="Logo preview" />
            : <NavIcon name="image" size={28} />}
        </span>
        <div className="fx-stack fx-stack--sm">
          <div className="fx-row gap-2">
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => input.current?.click()} disabled={busy} aria-describedby={`${id}-hint`}>
              {busy ? 'Uploading…' : value?.url ? 'Replace logo' : 'Upload logo'}
            </button>
            {value?.url && !busy && (
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange(null)}>Remove</button>
            )}
          </div>
          <p id={`${id}-hint`} className="text-xs text-subtle">{hint || 'PNG with a transparent background works best. JPEG, PNG or WebP.'}</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
        <input ref={input} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={pick} aria-label="Choose a logo file" />
      </div>
    </div>
  );
}
