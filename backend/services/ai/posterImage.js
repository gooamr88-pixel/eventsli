/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The poster an organizer wants turned into an event, checked before a single
 * byte of it is sent to a model provider.
 *
 * Pure and import-free, like `eventDraftValidate.js`: every rule here has to be
 * testable without a network, a key or a database.
 *
 * THE BYTES DECIDE, NOT THE LABEL. The browser says `image/jpeg`; the first
 * bytes of the file say what it actually is. They must agree, and they must be
 * one of the three formats both providers read (and the cover bucket stores,
 * `mediaService.EXTENSION_FOR`). A renamed PDF, an SVG with script in it or an
 * executable never reaches Google or Groq, whatever it was called.
 *
 * BOUNDED TWICE. The browser downscales the poster to at most 1600 px on its
 * long side before sending it (`posterImage.js` in the creator), which is
 * plenty to read the small print and keeps a request well inside the API's
 * 2 MB JSON limit (`app.js`). This file is the second reading, for every client
 * that is not ours: a size ceiling, a pixel ceiling (Groq refuses images above
 * 33 megapixels) and a floor below which no poster text is legible anyway.
 *
 * NOTHING IS STORED. The image lives for the length of one request. If the
 * organizer keeps it as the event cover, the browser uploads it again through
 * the ordinary signed cover upload, after the event exists (`mediaService`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/** Decoded bytes. 1.4 MB base64-encodes to ~1.87 MB, inside the 2 MB body limit. */
const MAX_BYTES = 1_400_000;
const MIN_BYTES = 2_000;
/** The base64 length that decodes to MAX_BYTES, checked BEFORE decoding. */
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;

const MIN_SIDE = 200;
const MAX_PIXELS = 25_000_000;

function invalid(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

/** Which of the three formats these bytes are, by signature, or null. */
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ─── Dimensions, from the header alone ─────────────────────────────────────
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Walk the JPEG markers to the first frame header (SOF0–SOF15, except the
 * three that are not frames: DHT C4, JPG C8, DAC CC). Bounded by the buffer,
 * so a malformed file ends the walk instead of looping.
 */
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; }                   // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30) return null;
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return null;
}

function dimensions(buf, type) {
  if (type === 'image/png') return pngSize(buf);
  if (type === 'image/jpeg') return jpegSize(buf);
  return webpSize(buf);
}

/**
 * `{ mimeType, data }` from the request → the image a provider may be sent.
 *
 * `data` is base64, with or without a `data:` URL prefix. Every failure is a
 * VALIDATION_ERROR with a sentence the organizer can act on, and every one of
 * them happens before a generation is reserved, so none costs a draft (D-010).
 *
 * @returns {{ mimeType: string, data: string, bytes: number, width: number, height: number }}
 */
function readPosterImage(input) {
  if (!input || typeof input !== 'object') throw invalid('Add a poster image.');
  const declared = String(input.mimeType || '').toLowerCase();
  if (!TYPES.includes(declared)) throw invalid('Upload the poster as a JPEG, PNG or WebP image.');

  const data = String(input.data || '').replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  if (data.length > MAX_BASE64) throw invalid('That image is too large. Use one under 1.4 MB.');
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw invalid('The image could not be read. Try choosing it again.');
  }

  const buf = Buffer.from(data, 'base64');
  if (buf.length < MIN_BYTES) throw invalid('That image is too small to read. Use the full-size poster.');

  const actual = sniff(buf);
  if (!actual) throw invalid('That file is not a JPEG, PNG or WebP image.');
  if (actual !== declared) throw invalid('The image is not the type it says it is. Try choosing it again.');

  const size = dimensions(buf, actual);
  if (!size || !size.width || !size.height) throw invalid('The image could not be read. Try choosing it again.');
  if (Math.min(size.width, size.height) < MIN_SIDE) {
    throw invalid(`That image is ${size.width}×${size.height} pixels — too small to read. Use the full-size poster.`);
  }
  if (size.width * size.height > MAX_PIXELS) throw invalid('That image has too many pixels. Use one under 25 megapixels.');

  return { mimeType: actual, data, bytes: buf.length, width: size.width, height: size.height };
}

module.exports = {
  readPosterImage, sniff, dimensions, TYPES, MAX_BYTES, MAX_BASE64, MIN_SIDE, MAX_PIXELS,
};
