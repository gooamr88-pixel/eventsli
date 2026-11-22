const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { hashIp } = require('../utils/crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The buyer's signature at checkout (owner request 2026-11-15).
 *
 * The checkout ends in "Draw your signature": the buyer signs under the three
 * agreements they ticked, and only then does Pay (or "Get my tickets") go. A
 * signature is evidence, so this module treats what the browser sends as a
 * CLAIM to be checked, not a picture to be stored:
 *
 *   · The browser sends the pen's POINTS, never an image or markup. Points in
 *     a fixed box (1000 wide) are small, can be checked number by number, and
 *     draw the same on any screen. The SVG we keep is rendered HERE from
 *     those numbers, so nothing the browser wrote ever becomes markup that an
 *     organizer's dashboard renders.
 *
 *   · A tap is not a signature. A drawing too small or too short to be one is
 *     refused with words the buyer can act on ("draw your full signature").
 *
 *   · TYPED is the keyboard alternative. Someone who cannot draw with a
 *     pointer — a keyboard or switch user, a screen reader — types their name,
 *     the way e-signature services offer it. Stored as typed, labelled typed.
 *
 *   · Recorded FAIL CLOSED, like the terms acceptance it seals: a checkout we
 *     cannot keep the signature for does not start.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BOX_W = 1000;
const MIN_H = 150;
const MAX_H = 1000;
const MAX_STROKES = 80;
const MAX_POINTS_PER_STROKE = 1500;
const MAX_POINTS = 6000;
/** Total pen travel, in box units, below which it is a mark and not a name. */
const MIN_INK = 150;
/** The drawing must span at least this much in its larger direction. */
const MIN_SPAN = 60;
const MIN_TYPED = 2;
const MAX_TYPED = 80;

const INK = '#111018';

class SignatureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const required = () => new SignatureError('SIGNATURE_REQUIRED', 'Sign to continue — draw your signature, or type your name.');
const invalid = (message) => new SignatureError('SIGNATURE_INVALID', message);

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Checks what the browser sent and returns the canonical form, or throws a
 * SignatureError. Pure: no database, so the checkout can refuse a bad
 * signature before it talks to Stripe.
 *
 *   { method: 'drawn', width: 1000, height: 300, strokes: [[x, y, x, y, …], …] }
 *   { method: 'typed', name: 'Mona Adel' }
 */
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw required();

  if (input.method === 'typed') {
    const name = typeof input.name === 'string' ? input.name.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
    if (!name) throw required();
    // Control characters have no place in a name, and a bidi override could make
    // the dashboard show something other than what was stored.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(name)) throw invalid('Type your name using letters only.');
    if (name.length < MIN_TYPED) throw invalid('Type your full name to sign.');
    if (name.length > MAX_TYPED) throw invalid(`Keep your typed signature under ${MAX_TYPED} characters.`);
    return { method: 'typed', name };
  }

  if (input.method !== 'drawn') throw required();

  const width = Number(input.width);
  const height = Number(input.height);
  if (width !== BOX_W || !Number.isInteger(height) || height < MIN_H || height > MAX_H) {
    throw invalid('That signature could not be read. Clear it and sign again.');
  }

  const raw = input.strokes;
  if (!Array.isArray(raw) || raw.length === 0) throw required();
  if (raw.length > MAX_STROKES) throw invalid('That signature has too many strokes. Clear it and sign again.');

  let total = 0;
  let ink = 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const strokes = raw.map((stroke) => {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length % 2 !== 0) {
      throw invalid('That signature could not be read. Clear it and sign again.');
    }
    const points = stroke.length / 2;
    if (points > MAX_POINTS_PER_STROKE) throw invalid('That signature is too long. Clear it and sign again.');
    total += points;
    if (total > MAX_POINTS) throw invalid('That signature is too long. Clear it and sign again.');

    const out = new Array(stroke.length);
    for (let i = 0; i < stroke.length; i += 2) {
      const x = stroke[i]; const y = stroke[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
          || x < 0 || x > width || y < 0 || y > height) {
        throw invalid('That signature could not be read. Clear it and sign again.');
      }
      out[i] = round1(x); out[i + 1] = round1(y);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (i >= 2) ink += Math.hypot(x - stroke[i - 2], y - stroke[i - 1]);
    }
    return out;
  });

  if (ink < MIN_INK || Math.max(maxX - minX, maxY - minY) < MIN_SPAN) {
    throw invalid('That looks like a dot or a dash. Draw your full signature.');
  }

  return { method: 'drawn', width, height, strokes };
}

/** One stroke as a smooth path: quadratic curves through the midpoints. */
function strokePath(s) {
  const n = s.length / 2;
  const x = (i) => s[i * 2];
  const y = (i) => s[i * 2 + 1];
  // A single point is a dot, drawn as a zero-length line the round cap fills.
  if (n === 1) return `M${x(0)} ${y(0)}l0.1 0`;
  if (n === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i += 1) {
    const mx = round1((x(i) + x(i + 1)) / 2);
    const my = round1((y(i) + y(i + 1)) / 2);
    d += `Q${x(i)} ${y(i)} ${mx} ${my}`;
  }
  return `${d}L${x(n - 1)} ${y(n - 1)}`;
}

const escapeXml = (s) => s.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[c]));

/**
 * The picture we keep and show. Built from validated numbers (drawn) or
 * escaped text (typed) — the only two things that ever reach it.
 */
function toSvg(sig) {
  if (sig.method === 'typed') {
    const size = Math.round(Math.min(120, 1500 / Math.max(sig.name.length, 6)));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX_W} 300" width="${BOX_W}" height="300">`
      + `<text x="500" y="${150 + size * 0.35}" text-anchor="middle" fill="${INK}" font-size="${size}" font-style="italic" `
      + 'font-family="\'Segoe Script\',\'Snell Roundhand\',\'Brush Script MT\',\'Apple Chancery\',cursive">'
      + `${escapeXml(sig.name)}</text></svg>`;
  }
  const d = sig.strokes.map(strokePath).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sig.width} ${sig.height}" width="${sig.width}" height="${sig.height}">`
    + `<path d="${d}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** SHA-256 of the canonical signature — what was signed, not how it was sent. */
function fingerprint(sig) {
  const canonical = sig.method === 'typed'
    ? JSON.stringify({ method: 'typed', name: sig.name })
    : JSON.stringify({ method: 'drawn', width: sig.width, height: sig.height, strokes: sig.strokes });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Keeps a checked signature. Throws if it cannot be kept — the caller lets
 * that stop the checkout.
 */
async function record({ sig, eventId, reservationId = null, acceptanceId = null, buyer, req = null }) {
  const { data, error } = await supabase
    .from('purchase_signatures')
    .insert({
      event_id: eventId,
      reservation_id: reservationId,
      terms_acceptance_id: acceptanceId,
      user_id: buyer.userId || null,
      email: buyer.email || null,
      signer_name: buyer.name || null,
      method: sig.method,
      strokes: sig.method === 'drawn' ? { width: sig.width, height: sig.height, strokes: sig.strokes } : null,
      typed_name: sig.method === 'typed' ? sig.name : null,
      svg: toSvg(sig),
      sha256: fingerprint(sig),
      ip_hash: req ? hashIp(req.ip) : null,
      user_agent: req ? String(req.headers?.['user-agent'] || '').slice(0, 300) || null : null,
    })
    .select('id, signed_at')
    .single();
  if (error) throw new Error(`could not record signature: ${error.message}`);
  return data;
}

/** Which of these reservations have a signature on file. */
async function signedReservations(reservationIds) {
  const ids = [...new Set(reservationIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from('purchase_signatures').select('reservation_id').in('reservation_id', ids);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.reservation_id));
}

/**
 * The signature behind one order on one event, or null. The event is part of
 * the lookup so an organizer can only reach orders on an event they own (the
 * route checks the event; this checks the order is on it).
 */
async function forOrder(eventId, orderId) {
  const { data: order, error } = await supabase
    .from('orders').select('id, reservation_id').eq('id', orderId).eq('event_id', eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return { order: null, signature: null };
  if (!order.reservation_id) return { order, signature: null };

  const { data: sig, error: sigError } = await supabase
    .from('purchase_signatures')
    .select('id, method, svg, sha256, signer_name, email, typed_name, signed_at')
    .eq('reservation_id', order.reservation_id)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sigError) throw new Error(sigError.message);
  if (!sig) return { order, signature: null };

  return {
    order,
    signature: {
      id: sig.id,
      method: sig.method,
      svg: sig.svg,
      sha256: sig.sha256,
      signerName: sig.signer_name,
      email: sig.email,
      signedAt: sig.signed_at,
    },
  };
}

module.exports = {
  normalize, toSvg, fingerprint, record, signedReservations, forOrder,
  SignatureError, BOX_W, MIN_H, MAX_H, MAX_STROKES, MAX_POINTS,
};
