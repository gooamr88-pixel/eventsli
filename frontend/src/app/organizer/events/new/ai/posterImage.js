/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's poster, made ready to send — in the browser, before upload.
 *
 * WHY HERE AND NOT ON THE SERVER. A phone photo of a flyer is 3–12 MB and
 * 4000 px wide. Sent as it is, it would not fit the API's 2 MB body limit,
 * would take most of the 30 s request budget to upload on a mobile network,
 * and would cost several times the model tokens of an image that reads just as
 * well. Drawn onto a canvas at 1600 px on its long side and saved as a JPEG it
 * is typically 250–700 KB, the small print stays legible, and:
 *
 *   · HEIC from an iPhone works wherever the browser can decode it (Safari),
 *     because the canvas re-encodes it as JPEG;
 *   · the photo's EXIF block — GPS position, camera serial — is not copied,
 *     because a canvas only carries pixels. Nothing about where the photo was
 *     taken reaches the AI provider, or the event cover;
 *   · transparency (a PNG flyer) is flattened onto white instead of black.
 *
 * The same JPEG becomes the event's cover if the organizer keeps it, through
 * the ordinary signed cover upload (`uploadEventImage`), so the poster is
 * prepared once and is identical in both places.
 *
 * The server checks it all again by its bytes (`backend/services/ai/posterImage.js`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const POSTER_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_EDGE = 1600;
export const MIN_SIDE = 200;
/** Under the server's 1.4 MB ceiling with room to spare. */
export const TARGET_BYTES = 1_200_000;
const QUALITIES = [0.86, 0.78, 0.7];

const fail = (message) => Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });

/** A file the organizer chose → null, or the sentence that says why not. */
export function posterFileProblem(file) {
  if (!file) return 'Choose an image of your poster.';
  const type = String(file.type || '').toLowerCase();
  const heic = /\.(heic|heif)$/i.test(file.name || '');
  if (!type.startsWith('image/') && !heic) return 'That file is not an image. Choose a photo or a JPEG, PNG or WebP of the poster.';
  if (type === 'image/svg+xml' || type === 'image/gif') return 'Use a JPEG, PNG or WebP of the poster.';
  if (file.size > MAX_SOURCE_BYTES) return `That image is ${(file.size / 1048576).toFixed(0)} MB. Use one under 25 MB.`;
  return null;
}

/** The size to draw at: the long side at most `max`, never enlarged. */
export function fitWithin(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `data:image/jpeg;base64,AAAA` → `AAAA`. */
export function base64Of(dataUrl) {
  const i = String(dataUrl || '').indexOf('base64,');
  return i === -1 ? '' : dataUrl.slice(i + 7);
}

/** Bytes of a base64 string, without decoding it. */
export function bytesOfBase64(b64) {
  const s = String(b64 || '');
  return Math.floor((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
}

/** Decode with whatever this browser has: `createImageBitmap`, then <img>. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` honours the EXIF rotation, so a phone photo is upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through: some browsers decode in <img> what they will not here */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * File → `{ dataUrl, width, height, bytes, name }`, a JPEG under TARGET_BYTES.
 * Throws a VALIDATION_ERROR with a sentence for anything it cannot use.
 */
export async function preparePoster(file) {
  const problem = posterFileProblem(file);
  if (problem) throw fail(problem);

  let source;
  try {
    source = await decode(file);
  } catch {
    throw fail(/heic|heif/i.test(`${file.type} ${file.name}`)
      ? 'This browser cannot open HEIC photos. Save the poster as a JPEG or PNG, or use Safari.'
      : 'That image could not be opened. Try a JPEG or PNG of the poster.');
  }

  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  if (Math.min(w, h) < MIN_SIDE) {
    source.close?.();
    throw fail(`That image is only ${w}×${h} pixels — too small to read. Use the full-size poster.`);
  }

  let size = fitWithin(w, h);
  let blob = null;
  // Quality first, then size: the small print survives a lower JPEG quality
  // better than it survives fewer pixels.
  for (let pass = 0; pass < 2 && !blob; pass += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(source, 0, 0, size.width, size.height);
    for (const q of QUALITIES) {
      const out = await toBlob(canvas, q);
      if (out && out.size <= TARGET_BYTES) { blob = out; break; }
    }
    if (!blob) size = fitWithin(w, h, 1200);
  }
  source.close?.();
  if (!blob) throw fail('That image could not be made small enough to send. Try a simpler photo of the poster.');

  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, width: size.width, height: size.height, bytes: blob.size, name: file.name || 'poster.jpg' };
}

/** A prepared poster's data URL → a Blob for the cover upload. */
export function dataUrlToBlob(dataUrl) {
  const b64 = base64Of(dataUrl);
  const type = /^data:([^;,]+)/.exec(dataUrl || '')?.[1] || 'image/jpeg';
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Kept beside the draft in sessionStorage so a reload on the review screen
 * still has the poster to show and to save as the cover. Best effort: a
 * private window or a full quota simply means the poster has to be chosen
 * again, and the draft itself is unaffected.
 */
export const POSTER_KEY = 'eventsli.newEvent.ai.poster';

export function loadPoster() {
  try { return JSON.parse(sessionStorage.getItem(POSTER_KEY) || 'null'); } catch { return null; }
}

export function storePoster(poster) {
  try {
    if (poster) sessionStorage.setItem(POSTER_KEY, JSON.stringify(poster));
    else sessionStorage.removeItem(POSTER_KEY);
  } catch { /* quota or private mode — see above */ }
}
