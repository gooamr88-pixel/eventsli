'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { post, put, del } from '../../../utils/apiClient';
import { useConfirm } from '../../../components/ui/Confirm';
import { useToast } from '../../../components/ui/Toast';
import { Panel } from '../../../components/ui/Page';
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
 *
 * Removing asks first. It deletes the stored file as well as the link, so one
 * stray click took the image off every shared link with no way back. Both
 * outcomes are confirmed with a toast: the image swapping in place was the only
 * sign an upload had worked, and a removal had none.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ACCEPT = 'image/jpeg,image/png,image/webp';

export default function CoverUpload({ event, onChanged }) {
  const input = useRef(null);
  const confirm = useConfirm();
  const toast = useToast();
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
      toast.success(event.cover ? 'The new cover is live everywhere the event appears.' : 'Cover image added.');
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
    const ok = await confirm({
      title: 'Remove the cover image?',
      tone: 'danger',
      body: <p>It comes off your event page, the listings and every link already shared. The file is deleted, so to bring it back you would upload it again.</p>,
      confirmLabel: 'Remove image',
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      await del(`/events/${event.id}/cover`, { noRedirect: true });
      toast.success('Cover image removed.');
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Cover image"
      description="Shown on your event page, in listings, and on every shared link. JPEG, PNG or WebP."
      action={event.cover && editable && (
        <button type="button" onClick={remove} disabled={busy} className="es-btn es-btn--ghost es-btn--sm">
          Remove
        </button>
      )}
    >
      {event.cover ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-(--es-radius-md) bg-bg-sunken">
          <Image
            src={event.cover.url}
            alt=""
            fill
            sizes="(max-width: 1280px) 100vw, 480px"
            className="object-cover"
          />
        </div>
      ) : (
        <div className="grid aspect-[16/9] w-full place-items-center rounded-(--es-radius-md) border border-dashed border-border-strong bg-bg-sunken">
          <p className="text-sm text-subtle">No image yet — events with a cover are easier to share.</p>
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
            className="sr-only"
            id={`cover-${event.id}`}
            disabled={busy}
          />
          <label
            htmlFor={`cover-${event.id}`}
            aria-disabled={busy || undefined}
            className="es-btn es-btn--secondary self-start"
          >
            {busy ? 'Uploading…' : event.cover ? 'Replace image' : 'Choose an image'}
          </label>
        </>
      )}
    </Panel>
  );
}
