import { post, put } from './apiClient';

/**
 * The event cover's three steps, in one place (see `CoverUpload.jsx` for why
 * there are three, and `backend/services/mediaService.js` for the server side):
 *
 *   1. `POST …/cover-upload` — a signed URL for one object key the SERVER chose;
 *   2. a plain PUT of the bytes straight to that URL — no Supabase client, no key;
 *   3. `PUT …/cover` — the server confirms the object landed, then writes the row.
 *
 * Shared by the cover panel on the event and by the Smart Event Creator, which
 * saves an organizer's poster as the cover right after the event is created.
 * Two copies of this sequence is how one of them would one day skip step 3 and
 * point a public page at a 404.
 *
 * @param {string} eventId
 * @param {Blob} file  JPEG, PNG or WebP
 * @returns the event as the API returns it after step 3
 */
export async function uploadEventCover(eventId, file) {
  const signed = await post(`/events/${eventId}/cover-upload`, {
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

  return put(`/events/${eventId}/cover`, { path: signed.path }, { noRedirect: true });
}
