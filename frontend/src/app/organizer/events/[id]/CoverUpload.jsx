'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { post, put, del } from '../../../utils/apiClient';
import FormError from '../../../components/forms/FormError';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's cover image.
 *
 * Two steps, and the bytes never pass through our API:
 *
 *   1. `POST …/cover-upload` returns a signed URL for one object key the SERVER
 *      invented. We do not choose the path and could not use one if we did.
 *   2. A plain `fetch` PUT sends the file straight to that URL — no Supabase
 *      client, no key. The browser still holds nothing.
 *   3. `PUT …/cover` confirms the object landed, and only then is the row
 *      written.
 *
 * Step 3 is not ceremony. Skipping it would set a `cover_url` pointing at a 404
 * and the most-shared page on the platform would render a broken image.
 *
 * `coverUrl` is not a field anyone can PATCH — see the note in eventRules.js.
 * A client-supplied URL ends up inside an Open Graph tag on a public page,
 * which makes it a link the platform vouches for pointing anywhere at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ACCEPT = 'image/jpeg,image/png,image/webp';

export default function CoverUpload({ event, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const editable = !['cancelled', 'completed'].includes(event.status);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await post(`/events/${event.id}/cover-upload`, {
        contentType: file.type,
      }, { noRedirect: true });

      // Checked here as well as by the bucket. The bucket's refusal happens
      // during the PUT, which the confirm step never sees — so without this the
      // failure reads as "the upload silently did nothing".
      if (file.size > signed.maxBytes) {
        throw Object.assign(new Error(
          `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is `
          + `${Math.round(signed.maxBytes / 1048576)} MB.`,
        ), { code: 'VALIDATION_ERROR' });
      }

      const uploaded = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploaded.ok) {
        throw Object.assign(new Error('The image did not upload. Try again.'), {
          code: 'CONFLICT',
        });
      }

      await put(`/events/${event.id}/cover`, { path: signed.path }, { noRedirect: true });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      // Cleared so choosing the SAME file again still fires a change event.
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await del(`/events/${event.id}/cover`, { noRedirect: true });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fx-stack fx-stack--sm es-card p-5">
      <div className="fx-row fx-row--between">
        <h2 className="text-lg text-ink">Cover image</h2>
        {event.cover && editable && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="es-btn es-btn--ghost es-btn--sm"
          >
            Remove
          </button>
        )}
      </div>

      <p className="text-sm text-muted">
        Shown on your event page, in listings, and on every link someone shares. JPEG,
        PNG or WebP.
      </p>

      {event.cover ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[--es-radius-md] bg-bg-sunken">
          <Image
            src={event.cover.url}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 640px"
            className="object-cover"
          />
        </div>
      ) : (
        <div className="grid aspect-[16/9] w-full place-items-center rounded-[--es-radius-md] border border-dashed border-border-strong bg-bg-sunken">
          <p className="text-sm text-subtle">No image yet</p>
        </div>
      )}

      <FormError error={error} />

      {editable && (
        <>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            onChange={(e) => upload(e.target.files?.[0])}
            className="hidden"
            id={`cover-${event.id}`}
          />
          <label
            htmlFor={`cover-${event.id}`}
            className={`es-btn es-btn--secondary self-start ${busy ? 'pointer-events-none opacity-50' : ''}`}
          >
            {busy ? 'Uploading…' : event.cover ? 'Replace image' : 'Choose an image'}
          </label>
        </>
      )}
    </section>
  );
}
