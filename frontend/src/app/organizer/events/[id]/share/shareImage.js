/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Share images for an event — a square post and a vertical story — drawn in
 * the browser from the event's own cover, title, date and venue.
 *
 * NO AI, NO SERVER, NO COST. Everything on the image is a field the organizer
 * set, laid out by fixed rules, so these are always available — with or
 * without AI drafts left — and always say exactly what the event page says.
 *
 * THE POSTER IS NEVER CROPPED. It is drawn whole ("contain") over a blurred,
 * darkened copy of itself, the way the event page shows it: a poster's title
 * and date are usually at its edges, and cropping to fill a square would cut
 * them off.
 *
 * The cover comes from the public storage bucket, which serves CORS headers,
 * so it can be drawn without tainting the canvas. If it cannot be loaded the
 * image falls back to the brand colours with the title set large — never a
 * broken download.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const FORMATS = Object.freeze({
  post: { width: 1080, height: 1080, label: 'Square post', hint: 'Instagram and Facebook feed' },
  story: { width: 1080, height: 1920, label: 'Story', hint: 'Instagram, Facebook and WhatsApp status' },
});

const INK = '#ffffff';
const SUB = 'rgba(255,255,255,0.82)';
const BRAND = ['#0d5b5e', '#0a3f42'];

/** Words → lines no wider than `max`, at most `limit` lines, the last one ellipsised. */
export function wrapText(measure, text, max, limit = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= max || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  let last = `${kept[limit - 1]}…`;
  while (measure(last) > max && last.length > 2) last = `${last.slice(0, -2).trimEnd()}…`;
  kept[limit - 1] = last;
  return kept;
}

/** Where the poster goes inside a box, whole and centred. */
export function containRect(imgW, imgH, box) {
  const scale = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** "SAT, NOV 14 · 9:00 PM" in the event's zone. */
export function dateLine(startsAt, timeZone) {
  if (!startsAt) return '';
  try {
    const d = new Date(startsAt);
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(d);
    return `${day} · ${time}`.toUpperCase();
  } catch {
    return '';
  }
}

export function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function fontFamily() {
  try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; } catch { return 'sans-serif'; }
}

/**
 * Draw one share image. `info` is `{ title, date, place, tagline, url }`;
 * `cover` an HTMLImageElement or null. Returns the canvas.
 */
export function drawShareImage(format, info, cover) {
  const { width: W, height: H } = FORMATS[format];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const family = fontFamily();
  const font = (weight, size) => { ctx.font = `${weight} ${size}px ${family}`; };
  const pad = 72;

  // Ground: the poster blurred, or the brand gradient.
  if (cover) {
    const scale = Math.max(W / cover.width, H / cover.height) * 1.15;
    ctx.save();
    ctx.filter = 'blur(48px) saturate(1.2)';
    ctx.drawImage(cover, (W - cover.width * scale) / 2, (H - cover.height * scale) / 2, cover.width * scale, cover.height * scale);
    ctx.restore();
    ctx.fillStyle = 'rgba(8, 20, 24, 0.55)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, BRAND[0]);
    g.addColorStop(1, BRAND[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // The text block, measured first so the poster takes whatever is left.
  const titleSize = format === 'story' ? 76 : 60;
  font(700, titleSize);
  const titleLines = wrapText((t) => ctx.measureText(t).width, info.title, W - pad * 2, cover ? 2 : 4);
  const textBlock = titleLines.length * titleSize * 1.12 + 40 + 44 + (info.place ? 44 : 0) + (info.tagline ? 56 : 0) + 96;

  if (cover) {
    const top = format === 'story' ? 150 : pad;
    const r = containRect(cover.width, cover.height, { x: pad, y: top, w: W - pad * 2, h: H - top - textBlock - pad });
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 12;
    ctx.drawImage(cover, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // Bottom-up, so the URL always sits on the bottom margin.
  ctx.textBaseline = 'alphabetic';
  let y = H - pad;
  font(600, 30);
  ctx.fillStyle = SUB;
  ctx.fillText(info.url, pad, y);
  y -= 66;

  if (info.place) {
    font(500, 34);
    ctx.fillStyle = SUB;
    ctx.fillText(wrapText((t) => ctx.measureText(t).width, info.place, W - pad * 2, 1)[0], pad, y);
    y -= 48;
  }
  if (info.date) {
    font(700, 34);
    ctx.fillStyle = '#7fe0d4';
    ctx.fillText(info.date, pad, y);
    y -= 56;
  }
  font(700, titleSize);
  ctx.fillStyle = INK;
  [...titleLines].reverse().forEach((line) => { ctx.fillText(line, pad, y); y -= titleSize * 1.12; });

  if (info.tagline) {
    font(500, 36);
    ctx.fillStyle = SUB;
    ctx.fillText(wrapText((t) => ctx.measureText(t).width, info.tagline, W - pad * 2, 1)[0], pad, y - 8);
  }
  return canvas;
}
