import { post } from '../../../../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Uploads a Venue Studio image: the venue's photo, or a 360° panorama.
 *
 * The cover's three steps (utils/uploadEventImage.js) — sign, PUT the bytes
 * straight to storage, confirm — with one addition: the image is RESIZED in
 * the browser first. A 360° camera exports 30–60 MB panoramas at 11k pixels
 * across; the bucket takes 5 MB, and no phone can hold an 11k texture anyway.
 * 4096 × 2048 is the size every GPU accepts and the eye cannot tell from more
 * at a phone's field of view, and as a JPEG it lands around 1.5–3 MB.
 *
 * Nothing is written to the map here. The confirm step returns `{ path, url }`
 * for the draft; the map save keeps the path and the server re-derives the
 * URL from it (backend/services/venueStudio.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LIMITS = Object.freeze({
  panorama: { width: 4096, height: 2048, quality: 0.86 },
  venue: { width: 2000, height: 1400, quality: 0.85 },
});

export async function uploadStudioImage(eventId, file, kind) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw Object.assign(new Error('Choose a JPEG, PNG or WebP image.'), { code: 'VALIDATION_ERROR' });
  }
  const blob = await downscale(file, LIMITS[kind]);
  const signed = await post(`/events/${eventId}/venue-map/upload`, { contentType: blob.type, kind }, { noRedirect: true });
  if (blob.size > signed.maxBytes) {
    throw Object.assign(new Error(
      `That image is still ${(blob.size / 1048576).toFixed(1)} MB after resizing. The limit is ${Math.round(signed.maxBytes / 1048576)} MB.`,
    ), { code: 'VALIDATION_ERROR' });
  }
  const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
  if (!uploaded.ok) {
    throw Object.assign(new Error('The image did not upload. Try again.'), { code: 'CONFLICT' });
  }
  return post(`/events/${eventId}/venue-map/assets`, { path: signed.path }, { noRedirect: true });
}

/** Whether a panorama looks like one: about twice as wide as it is tall. */
export async function aspectOf(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = bitmap.width / bitmap.height;
  bitmap.close?.();
  return ratio;
}

async function downscale(file, { width, height, quality }) {
  if (typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
  if (scale === 1 && file.size < 3.5 * 1048576) { bitmap.close?.(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return out || file;
}
