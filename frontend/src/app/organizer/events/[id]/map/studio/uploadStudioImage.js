import { post } from '../../../../../utils/apiClient';
import { MAX_TRACK_BYTES, MAX_CLIP_BYTES } from '../../../../../components/venue/stage/screenModel';

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
  // A stage-screen photo. Kept whole, not cropped: the screen is 16:9 and
  // shows it cropped around the organizer's focus point, which they can move.
  screen: { width: 1920, height: 1920, quality: 0.86 },
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

export async function downscale(file, { width, height, quality }) {
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

/**
 * The stage screen's soundtrack: an MP3 or M4A, up to 8 MB (about four
 * minutes), uploaded as it is. Browsers name the same file differently
 * (audio/mp3, audio/x-m4a…), so the type is settled here to the two the
 * server signs for. Returns { path, url } and the file's name, for the title.
 */
export async function uploadStudioAudio(eventId, file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = audioType(file.type, ext);
  if (!type) {
    throw Object.assign(new Error('Choose an MP3 or M4A file.'), { code: 'VALIDATION_ERROR' });
  }
  if (file.size > MAX_TRACK_BYTES) {
    throw Object.assign(new Error(
      `That track is ${(file.size / 1048576).toFixed(1)} MB. The limit is 8 MB, about four minutes of music.`,
    ), { code: 'VALIDATION_ERROR' });
  }
  const signed = await post(`/events/${eventId}/venue-map/upload`, { contentType: type, kind: 'soundtrack' }, { noRedirect: true });
  const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
  if (!uploaded.ok) {
    throw Object.assign(new Error('The track did not upload. Try again.'), { code: 'CONFLICT' });
  }
  const asset = await post(`/events/${eventId}/venue-map/assets`, { path: signed.path }, { noRedirect: true });
  return { ...asset, name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) };
}

/**
 * A stage-screen video: MP4 or WebM, up to 40 MB, uploaded as it is (a
 * browser cannot re-encode video). It plays muted on the screen, looping.
 */
export async function uploadStudioVideo(eventId, file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = videoType(file.type, ext);
  if (!type) {
    throw Object.assign(new Error('Choose an MP4 or WebM video.'), { code: 'VALIDATION_ERROR' });
  }
  if (file.size > MAX_CLIP_BYTES) {
    throw Object.assign(new Error(
      `That video is ${(file.size / 1048576).toFixed(1)} MB. The limit is 40 MB: try a shorter clip, or export it at 1080p.`,
    ), { code: 'VALIDATION_ERROR' });
  }
  const signed = await post(`/events/${eventId}/venue-map/upload`, { contentType: type, kind: 'clip' }, { noRedirect: true });
  const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
  if (!uploaded.ok) {
    throw Object.assign(new Error('The video did not upload. Try again.'), { code: 'CONFLICT' });
  }
  return post(`/events/${eventId}/venue-map/assets`, { path: signed.path }, { noRedirect: true });
}

/** The content type the server signs a video as, or null. */
export function videoType(mime, ext) {
  if (mime === 'video/mp4' || (!mime && ext === 'mp4')) return 'video/mp4';
  if (mime === 'video/webm' || (!mime && ext === 'webm')) return 'video/webm';
  return null;
}

/** The content type the server signs a track as, or null. */
export function audioType(mime, ext) {
  if (/^audio\/(mpeg|mp3)$/.test(mime || '') || (!mime && ext === 'mp3')) return 'audio/mpeg';
  if (/^audio\/(mp4|x-m4a|m4a|aac)$/.test(mime || '') || (!mime && ext === 'm4a')) return 'audio/mp4';
  return null;
}
