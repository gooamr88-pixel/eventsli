import { countdown } from './screenModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The stage screen's SLIDES, one drawer each, and the small pure helpers the
 * painter shares with them. Split from screenPainter.js, which owns the
 * canvas, the images, the backdrops and the clock; a drawer only paints its
 * slide into the fixed 1280 × 720 space it is handed.
 *
 * `kit` is the painter's drawing toolkit (fonts, image loader, text fitting,
 * backdrop, headline…); `k` per call is the frame: palette, time, feed,
 * progress through the slide (0 → 1) and the music.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const W = 1280;
export const H = 720;

export const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** 0 → 1 over [from, from + span] of a slide's progress. */
export const enter = (p, from, span = 0.08) => ease((p - from) / span);

export function zoned(iso, timeZone, opts) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return new Intl.DateTimeFormat('en', { ...opts, timeZone: timeZone || undefined }).format(d); } catch {
    return new Intl.DateTimeFormat('en', opts).format(d);
  }
}

export function hexRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/** A little deterministic noise, so bokeh and stars sit still between frames. */
export function seeded(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}


export function slideDrawers(kit) {
  const {
    state, fonts, img, vid, font, spacing, fit, block, cover, contain, glow, backdrop, overline, headline,
  } = kit;
  function drawTitle(g, slide, k) {
    const { feed, p, pal } = k;
    const art = img(feed?.coverUrl);
    backdrop(g, k);
    const rise = (1 - enter(p, 0, 0.1)) * 30;
    if (art) {
      g.save();
      g.globalAlpha = 0.95;
      cover(g, art, W * 0.36, 0, W * 0.64, H, { zoom: 1.04 + (k.still ? 0 : p * 0.07), focus: { x: 50, y: 40 } });
      g.restore();
      const fade = g.createLinearGradient(W * 0.32, 0, W * 0.72, 0);
      fade.addColorStop(0, pal.bg);
      fade.addColorStop(1, rgba(pal.bg, 0));
      g.fillStyle = fade;
      g.fillRect(W * 0.32, 0, W * 0.4, H);
      g.fillStyle = pal.bg;
      g.fillRect(0, 0, W * 0.32 + 1, H);
    }
    const when = feed?.startsAt ? zoned(feed.startsAt, feed.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const meta = [when, feed?.venueName].filter(Boolean).join('  ·  ');
    const left = art ? 84 : W / 2;
    const align = art ? 'left' : 'center';
    const width = art ? W * 0.5 : W - 200;
    g.save();
    g.translate(0, rise);
    g.globalAlpha = enter(p, 0, 0.1);
    if (meta) overline(g, meta, left, H / 2 - 118, k, align);
    const head = headline(g, k.title || 'Live', { x: left, y: H / 2 - 30, width, lines: 2, max: art ? 104 : 124, align, k });
    // An accent rule that draws itself under the name.
    const bar = 160 * enter(p, 0.04, 0.12);
    g.fillStyle = pal.a;
    g.fillRect(align === 'center' ? left - bar / 2 : left, H / 2 - 30 + head.height - head.px * 0.55 + 22, bar, 6);
    g.restore();
  }

  function drawCountdown(g, slide, k) {
    const { feed, pal } = k;
    backdrop(g, k);
    const c = countdown(feed?.startsAt, feed?.endsAt, k.now);
    if (!c || c.state === 'live') {
      // On now: a pulsing red dot and the event's name.
      const pulse = k.still ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(k.t * 2.4));
      g.textAlign = 'center';
      font(g, 900, 46, fonts.display);
      spacing(g, 10);
      const label = 'LIVE NOW';
      const w = g.measureText(label).width;
      g.fillStyle = `rgba(255,65,75,${pulse})`;
      g.beginPath(); g.arc(W / 2 - w / 2 - 34, H / 2 - 104, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal.text;
      g.fillText(label, W / 2 + 8, H / 2 - 88);
      spacing(g, 0);
      headline(g, k.title || 'Live', { x: W / 2, y: H / 2 + 40, width: W - 200, lines: 2, max: 96, align: 'center', k });
      return;
    }
    overline(g, 'The show starts in', W / 2, 168, k, 'center');
    const cells = [[c.days, 'Days'], [c.hours, 'Hours'], [c.minutes, 'Minutes'], [c.seconds, 'Seconds']];
    const cw = 220;
    const gap = 34;
    const x0 = W / 2 - (cells.length * cw + (cells.length - 1) * gap) / 2;
    const msInto = k.now % 1000;
    cells.forEach(([value, label], i) => {
      const x = x0 + i * (cw + gap);
      const y = 220;
      g.fillStyle = state.screen.style === 'elegant' ? 'rgba(212,167,44,0.08)' : 'rgba(255,255,255,0.07)';
      g.strokeStyle = rgba(pal.a, 0.45);
      g.lineWidth = 2;
      g.beginPath(); g.roundRect(x, y, cw, 236, 26); g.fill(); g.stroke();
      // The seconds tick with a small kick, like a flip clock landing.
      const kick = !k.still && i === 3 && msInto < 220 ? 1 + 0.07 * (1 - msInto / 220) : 1;
      g.save();
      g.translate(x + cw / 2, y + 156);
      g.scale(kick, kick);
      g.textAlign = 'center';
      font(g, state.screen.style === 'elegant' ? 600 : 800, 132, state.screen.style === 'elegant' ? fonts.serif : fonts.display);
      g.fillStyle = pal.text;
      glow(g, pal, true);
      g.fillText(String(Math.min(999, value)).padStart(2, '0'), 0, 0);
      glow(g, pal, false);
      g.restore();
      g.textAlign = 'center';
      font(g, 700, 22, fonts.sans);
      spacing(g, 4);
      g.fillStyle = pal.muted;
      g.fillText(label.toUpperCase(), x + cw / 2, y + 212);
      spacing(g, 0);
    });
    const when = zoned(feed.startsAt, feed.timezone, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    g.textAlign = 'center';
    font(g, 600, 30, fonts.sans);
    g.fillStyle = pal.muted;
    g.fillText([when, feed.venueName].filter(Boolean).join('  ·  '), W / 2, 560);
  }

  function drawArtist(g, slide, k) {
    const { p, pal } = k;
    const photo = img(slide.image?.url);
    if (photo) {
      g.fillStyle = pal.bg;
      g.fillRect(0, 0, W, H);
      cover(g, photo, 0, 0, W, H, { zoom: 1 + (k.still ? 0 : p * 0.1), focus: slide.focus, drift: k.still ? 0 : p - 0.5 });
      const shade = g.createLinearGradient(0, H * 0.38, 0, H);
      shade.addColorStop(0, rgba(pal.bg, 0));
      shade.addColorStop(1, rgba(pal.bg, 0.94));
      g.fillStyle = shade;
      g.fillRect(0, 0, W, H);
      const side = g.createLinearGradient(0, 0, W * 0.55, 0);
      side.addColorStop(0, rgba(pal.bg, 0.55));
      side.addColorStop(1, rgba(pal.bg, 0));
      g.fillStyle = side;
      g.fillRect(0, 0, W, H);
    } else {
      backdrop(g, k);
      // No photo: the performer's initials, huge and quiet, behind the name.
      const initials = String(slide.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      g.textAlign = 'right';
      font(g, 900, 560, fonts.display);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillText(initials, W - 40, H - 40);
    }
    const reveal = enter(p, 0.02, 0.1);
    g.save();
    g.beginPath();
    g.rect(0, 0, 84 + (W - 84) * reveal, H);
    g.clip();
    if (slide.tagline) overline(g, slide.tagline, 84, H - 214, k);
    headline(g, slide.name || k.title || '', { x: 84, y: H - 98, width: W - 168, lines: 1, max: 150, min: 56, k });
    g.fillStyle = pal.a;
    g.fillRect(84, H - 64, 120 * reveal, 6);
    g.restore();
  }

  function drawLineup(g, slide, k) {
    const { feed, p, pal } = k;
    backdrop(g, k);
    const rows = feed?.lineup || [];
    // From the next act on: a lineup on a screen says what is coming.
    let from = rows.findIndex((r) => {
      const end = Date.parse(r.endsAt || '') || (Date.parse(r.startsAt || '') + 3600e3);
      return Number.isFinite(end) && end > k.now;
    });
    if (from < 0) from = 0;
    from = Math.max(0, Math.min(from, rows.length - 5));
    const shown = rows.slice(from, from + 5);
    overline(g, feed?.startsAt ? zoned(feed.startsAt, feed.timezone, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Running order', 96, 120, k);
    headline(g, 'Lineup', { x: 96, y: 196, width: 800, lines: 1, max: 84, k });
    shown.forEach((r, i) => {
      const a = enter(p, 0.04 + i * 0.035, 0.08);
      const y = 262 + i * 88;
      const start = Date.parse(r.startsAt || '');
      const end = Date.parse(r.endsAt || '') || (start + 3600e3);
      const onNow = Number.isFinite(start) && k.now >= start && k.now < end;
      g.save();
      g.globalAlpha = a;
      g.translate((1 - a) * 60, 0);
      g.fillStyle = onNow ? rgba(pal.a, 0.22) : 'rgba(255,255,255,0.05)';
      g.beginPath(); g.roundRect(84, y, W - 168, 74, 16); g.fill();
      if (onNow) { g.fillStyle = pal.a; g.fillRect(84, y, 8, 74); }
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      font(g, 800, 32, fonts.display);
      g.fillStyle = state.screen.style === 'neon' ? pal.b : pal.a;
      g.fillText(Number.isFinite(start) ? zoned(r.startsAt, feed.timezone, { hour: 'numeric', minute: '2-digit' }) : '—', 116, y + 38);
      font(g, state.screen.style === 'elegant' ? 600 : 800, 36, state.screen.style === 'elegant' ? fonts.serif : fonts.display);
      g.fillStyle = pal.text;
      const titleW = W - 168 - 300 - (r.location ? 260 : 40);
      let name = r.title;
      while (name.length > 1 && g.measureText(name).width > titleW) name = name.slice(0, -1);
      g.fillText(name === r.title ? name : `${name}…`, 300, y + 38);
      g.textAlign = 'right';
      font(g, 600, 24, fonts.sans);
      g.fillStyle = pal.muted;
      if (onNow) {
        g.fillStyle = pal.text;
        g.fillText('ON NOW', W - 116, y + 38);
      } else if (r.location) {
        g.fillText(r.location.slice(0, 22), W - 116, y + 38);
      }
      g.restore();
    });
    g.textBaseline = 'alphabetic';
  }

  function drawPhoto(g, slide, k) {
    const { p, pal } = k;
    const photo = img(slide.image?.url);
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, W, H);
    if (photo) cover(g, photo, 0, 0, W, H, { zoom: 1.02 + (k.still ? 0 : p * 0.06), focus: slide.focus });
    lowerThird(g, slide.caption, k);
  }

  /** A lower third, as on a broadcast: an accent block and a dark bar. */
  function lowerThird(g, text, k) {
    if (!text) return;
    const a = enter(k.p, 0.05, 0.1);
    font(g, 700, 36, fonts.display);
    const tw = Math.min(W - 260, g.measureText(text).width);
    const bw = (tw + 80) * a;
    g.fillStyle = 'rgba(8,8,12,0.78)';
    g.fillRect(96, H - 150, bw, 76);
    g.fillStyle = k.pal.a;
    g.fillRect(84, H - 150, 12, 76);
    g.save();
    g.beginPath(); g.rect(96, H - 150, bw, 76); g.clip();
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    let cap = text;
    while (cap.length > 1 && g.measureText(cap).width > W - 260) cap = cap.slice(0, -1);
    g.fillText(cap === text ? cap : `${cap}…`, 132, H - 111);
    g.textBaseline = 'alphabetic';
    g.restore();
  }

  /** A clip, full screen and cropped to 16:9 around its focus; silent, looping. */
  function drawVideo(g, slide, k) {
    const clip = vid(slide.video?.url);
    if (clip) {
      g.fillStyle = k.pal.bg;
      g.fillRect(0, 0, W, H);
      cover(g, clip, 0, 0, W, H, { focus: slide.focus });
    } else {
      // Still loading: the backdrop and a play mark, never a black frame.
      backdrop(g, k);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath(); g.moveTo(W / 2 - 34, H / 2 - 44); g.lineTo(W / 2 + 50, H / 2); g.lineTo(W / 2 - 34, H / 2 + 44); g.closePath(); g.fill();
    }
    lowerThird(g, slide.caption, k);
  }

  /**
   * The event page's gallery as a photo wall: one large photo and two beside
   * it, each drifting slowly. A different three each time round.
   */
  function drawGallery(g, slide, k) {
    const { feed, p, pal } = k;
    const list = (feed?.gallery || []).filter((x) => x?.url);
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, W, H);
    if (!list.length) { backdrop(g, k); return; }
    const start = Math.floor(k.now / 30000) % list.length;
    const pick = [0, 1, 2].map((i) => list[(start + i) % list.length]).slice(0, Math.min(3, list.length));
    const gap = 12;
    const boxes = pick.length === 1
      ? [[0, 0, W, H]]
      : pick.length === 2
        ? [[0, 0, W / 2 - gap / 2, H], [W / 2 + gap / 2, 0, W / 2 - gap / 2, H]]
        : [[0, 0, W * 0.62, H], [W * 0.62 + gap, 0, W * 0.38 - gap, H / 2 - gap / 2], [W * 0.62 + gap, H / 2 + gap / 2, W * 0.38 - gap, H / 2 - gap / 2]];
    boxes.forEach(([x, y, w, h], i) => {
      const a = enter(p, i * 0.04, 0.1);
      const photo = img(pick[i].url);
      g.save();
      g.globalAlpha = a;
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      if (photo) cover(g, photo, x, y, w, h, { zoom: 1.02 + (k.still ? 0 : p * (0.05 + i * 0.02)), focus: { x: 50, y: 40 } });
      else { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y, w, h); }
      g.restore();
    });
    lowerThird(g, pick[0].caption || k.title, k);
  }

  function drawSponsors(g, slide, k) {
    const { feed, p } = k;
    backdrop(g, k);
    const list = (feed?.sponsors || []).slice(0, 8);
    overline(g, 'With thanks to', W / 2, 132, k, 'center');
    headline(g, 'Our partners', { x: W / 2, y: 208, width: W - 200, lines: 1, max: 76, align: 'center', k });
    const cols = list.length <= 4 ? list.length : 4;
    const rowsN = Math.ceil(list.length / cols);
    const tw = 236;
    const th = rowsN > 1 ? 128 : 160;
    const gap = 26;
    const x0 = W / 2 - (cols * tw + (cols - 1) * gap) / 2;
    const y0 = rowsN > 1 ? 268 : 320;
    list.forEach((s, i) => {
      const a = enter(p, 0.05 + i * 0.03, 0.08);
      const x = x0 + (i % cols) * (tw + gap);
      const y = y0 + Math.floor(i / cols) * (th + gap) + (1 - a) * 24;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.roundRect(x, y, tw, th, 20); g.fill();
      const logo = img(s.logoUrl);
      if (logo) contain(g, logo, x + 22, y + 18, tw - 44, th - 36);
      else {
        g.fillStyle = '#16141c';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const px = fit(g, s.name, { weight: 800, family: fonts.display, max: 30, min: 14, width: tw - 30 });
        font(g, 800, px, fonts.display);
        g.fillText(s.name, x + tw / 2, y + th / 2);
        g.textBaseline = 'alphabetic';
      }
      g.restore();
    });
  }

  function drawMessage(g, slide, k) {
    const { p, pal } = k;
    backdrop(g, k);
    const style = state.screen.style;
    const family = style === 'elegant' ? fonts.serif : fonts.display;
    const weight = style === 'elegant' ? 600 : 900;
    const b = block(g, slide.text, { weight, family, max: 132, min: 52, width: W - 220, lines: 3, italic: style === 'elegant' });
    const lh = b.px * 1.05;
    const total = lh * b.lines.length + (slide.sub ? 70 : 0);
    let y = H / 2 - total / 2 + b.px * 0.8;
    g.textAlign = 'center';
    b.lines.forEach((l, i) => {
      const a = enter(p, 0.02 + i * 0.05, 0.1);
      g.save();
      g.globalAlpha = a;
      g.translate(0, (1 - a) * 34);
      font(g, weight, b.px, family, style === 'elegant');
      g.fillStyle = pal.text;
      glow(g, pal, true);
      g.fillText(l, W / 2, y);
      glow(g, pal, false);
      g.restore();
      y += lh;
    });
    if (slide.sub) {
      g.save();
      g.globalAlpha = enter(p, 0.12, 0.1);
      overline(g, slide.sub, W / 2, y + 18, k, 'center');
      g.restore();
    }
  }

  function drawVisualizer(g, slide, k) {
    const { pal, t, audio, feed } = k;
    backdrop(g, k);
    const bins = audio?.bins;
    const n = 96;
    const cx = W / 2;
    const cy = H / 2 - 10;
    const base = 150 + (audio?.bass || 0) * 34;
    g.lineCap = 'round';
    g.lineWidth = 7;
    for (let i = 0; i < n; i += 1) {
      // Mirrored left and right, so the ring is symmetrical like a speaker.
      const j = i < n / 2 ? i : n - 1 - i;
      let v;
      if (bins && bins.length) v = bins[Math.min(bins.length - 1, Math.floor((j / (n / 2)) * bins.length * 0.7))] / 255;
      else v = k.still ? 0.35 : 0.3 + 0.25 * Math.sin(t * 2.1 + j * 0.35) * Math.sin(t * 0.7 + j * 0.11) + 0.15 * Math.sin(t * 5 + j);
      v = clamp01(v);
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const len = 14 + v * 170;
      g.strokeStyle = i % 2 ? pal.a : pal.b;
      g.globalAlpha = 0.55 + v * 0.45;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * base, cy + Math.sin(ang) * base);
      g.lineTo(cx + Math.cos(ang) * (base + len), cy + Math.sin(ang) * (base + len));
      g.stroke();
    }
    g.globalAlpha = 1;
    // The middle: the event's logo, else its initials on the accent.
    g.save();
    g.beginPath(); g.arc(cx, cy, base - 18, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fill();
    g.clip();
    const logo = img(feed?.logoUrl);
    if (logo) contain(g, logo, cx - base * 0.6, cy - base * 0.6, base * 1.2, base * 1.2);
    else {
      const initials = String(k.title || 'Live').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      g.fillStyle = pal.a;
      g.fill();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      font(g, 900, 110, fonts.display);
      g.fillText(initials, cx, cy + 6);
      g.textBaseline = 'alphabetic';
    }
    g.restore();
    g.textAlign = 'center';
    font(g, 700, 26, fonts.sans);
    spacing(g, 5);
    g.fillStyle = pal.muted;
    g.fillText(String(k.title || '').toUpperCase().slice(0, 48), W / 2, H - 56);
    spacing(g, 0);
  }

  return {
    title: drawTitle, countdown: drawCountdown, artist: drawArtist, lineup: drawLineup,
    photo: drawPhoto, sponsors: drawSponsors, message: drawMessage, visualizer: drawVisualizer,
    video: drawVideo, gallery: drawGallery,
  };
}
