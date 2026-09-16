'use client';

import { useRef } from 'react';
import { useUpload, ACCEPTED_IMAGES } from './useUpload';
import FormError from '../../components/forms/FormError';

/**
 * Pick a file, upload it, hand back `{ url, path }`.
 *
 * The URL and the object key travel together — the API refuses one without the
 * other, because a URL with no key cannot be cleaned up when it is replaced and
 * a key with no URL is an orphaned object nothing points at. So `onChange`
 * always receives both, or `null` to clear both.
 *
 * A plain <img> preview rather than next/image: the value is a freshly uploaded
 * object of unknown dimensions, shown at thumbnail size inside an admin screen
 * nobody's Core Web Vitals depend on.
 */
export default function ImageField({ url, path, scope, onChange }) {
  const input = useRef(null);
  const { upload, busy, error, clearError } = useUpload(scope);

  async function pick(event) {
    const file = event.target.files?.[0];
    // The input is reset immediately so choosing the SAME file twice still
    // fires a change event — otherwise a failed upload cannot be retried
    // without picking something else first.
    event.target.value = '';
    if (!file) return;

    const result = await upload(file);
    if (result) onChange(result);
  }

  return (
    <div className="fx-stack fx-stack--sm">
      {url ? (
        <div className="fx-row items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="h-16 w-24 rounded-(--es-radius-md) border border-border-base object-cover"
          />
          <div className="fx-stack fx-stack--sm gap-1 fx-min0">
            <p className="fx-truncate text-xs text-subtle">{path}</p>
            <div className="fx-row gap-2">
              <button
                type="button"
                className="es-btn es-btn--ghost es-btn--sm"
                onClick={() => input.current?.click()}
                disabled={busy}
              >
                Replace
              </button>
              <button
                type="button"
                className="es-btn es-btn--ghost es-btn--sm"
                onClick={() => { clearError(); onChange(null); }}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="es-btn es-btn--secondary es-btn--sm self-start"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {busy ? 'Uploading…' : 'Upload an image'}
        </button>
      )}

      {error && <FormError message={error} />}

      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGES}
        onChange={pick}
        className="sr-only"
        // Not `hidden`: a display:none input cannot be focused, so the label
        // and the button above would have nothing to hand focus to on the
        // keyboard path. `.sr-only` keeps it in the accessibility tree.
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
