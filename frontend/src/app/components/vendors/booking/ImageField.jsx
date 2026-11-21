'use client';

import { useId, useRef, useState } from 'react';
import { messageFor } from '../../../utils/errors';
import { uploadLogo } from '../../sponsors/sponsorUi';
import NavIcon from '../../shell/NavIcon';

/**
 * A photo picker for the organizer's vendor screens (2026-11-21): a booth's
 * photo, a photo for the vendor page. The same sign → PUT → confirm steps as
 * the logo (sponsorUi.uploadLogo); `base` owns /logo-upload and /logo.
 * `onChange({ url, path } | null)`.
 */
export default function ImageField({ base, label, value, onChange, hint, wide = false }) {
  const id = useId();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function pick(file) {
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
      <span className="es-label"><span>{label}</span><span className="es-optional">Optional</span></span>
      <div className={`es-vb-imgfield ${wide ? 'es-vb-imgfield--wide' : ''}`}>
        <button type="button" className="es-vb-imgfield__preview" onClick={() => input.current?.click()} disabled={busy}
          aria-label={value?.url ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`} aria-describedby={`${id}-hint`}>
          {value?.url
            // eslint-disable-next-line @next/next/no-img-element -- the uploaded photo, from storage
            ? <img src={value.url} alt="" />
            : <span className="es-vb-imgfield__empty"><NavIcon name="image" size={26} />{busy ? 'Uploading…' : 'Add photo'}</span>}
        </button>
        <div className="fx-stack fx-stack--sm">
          {value?.url && !busy && (
            <div className="fx-row gap-2">
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => input.current?.click()}>Replace</button>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange(null)}>Remove</button>
            </div>
          )}
          <p id={`${id}-hint`} className="text-xs text-subtle">{hint || 'JPEG, PNG or WebP, up to 5 MB. Landscape works best.'}</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label={`Choose a file for ${label}`}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
      </div>
    </div>
  );
}
