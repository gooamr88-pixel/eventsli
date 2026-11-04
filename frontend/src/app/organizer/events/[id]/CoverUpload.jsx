'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { del } from '../../../utils/apiClient';
import { uploadEventCover } from '../../../utils/uploadEventImage';
import { useConfirm } from '../../../components/ui/Confirm';
import { useToast } from '../../../components/ui/Toast';
import ContentCard from './content/ContentCard';
import NavIcon from '../../../components/shell/NavIcon';
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
      await uploadEventCover(event.id, file);
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

  // The file input sits outside the picture so its label can be the
  // "Replace" chip on the image and the drop zone when there is none.
  const picker = editable && (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      onChange={(e) => upload(e.target.files?.[0])}
      className="sr-only"
      id={`cover-${event.id}`}
      disabled={busy}
    />
  );

  return (
    <ContentCard
      icon="image"
      title="Cover image"
      description="Shown at the top of your event page, in listings and on every shared link. JPEG, PNG or WebP, about 1920×800."
    >
      {picker}
      {event.cover ? (
        <div className="es-pbcover">
          <Image
            src={event.cover.url}
            alt=""
            fill
            sizes="(max-width: 1280px) 100vw, 640px"
            className="object-cover"
          />
          {editable && (
            <div className="es-pbcover__tools">
              <label htmlFor={`cover-${event.id}`} aria-disabled={busy || undefined} className="es-pbcover__chip">
                <NavIcon name="image" size={16} />{busy ? 'Uploading…' : 'Replace'}
              </label>
              <button type="button" onClick={remove} disabled={busy} className="es-pbcover__chip es-pbcover__chip--icon">
                <NavIcon name="trash" size={16} /><span className="sr-only">Remove the cover image</span>
              </button>
            </div>
          )}
        </div>
      ) : editable ? (
        <label htmlFor={`cover-${event.id}`} aria-disabled={busy || undefined} className="es-pbdrop es-pbdrop--wide">
          <NavIcon name="image" size={28} />
          <b>{busy ? 'Uploading…' : 'Upload a cover'}</b>
          <small>Events with a cover are easier to share.</small>
        </label>
      ) : (
        <div className="es-pbdrop es-pbdrop--wide"><small>No cover image.</small></div>
      )}

      <FormError error={error} />
    </ContentCard>
  );
}
