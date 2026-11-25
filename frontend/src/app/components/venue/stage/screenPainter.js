import {
  playableSlides, slideAt, SCREEN_ASPECT, DEFAULT_SCREEN,
} from './screenModel';
import {
  W, H, ease, clamp01, rgba, seeded, slideDrawers,
} from './screenSlides';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Paints the stage screen's show onto a 16:9 canvas (screenModel.js says what
 * plays; this says how it looks). The 3D room uploads the canvas as the LED
 * wall's texture; the 3D settings show the same canvas flat, as a preview.
 *
 * Everything is drawn in a fixed 1280 × 720 space and scaled to the canvas,
 * so a phone's smaller canvas is the same picture with fewer pixels.
 *
 * Plain canvas 2D, no DOM and no three.js: the painter never knows whether it
 * is on a screen in a room or in a settings panel. It draws a frame when asked
 * (`paint`) and is otherwise idle, so the caller decides the frame rate — a
 * phone at rest repaints once a second, for the countdown.
 *
 * `still` is prefers-reduced-motion: no drifting light, no slow zoom on
 * photos, no rising text; slides still change, with a cut.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PALETTES = Object.freeze({
  bold: { bg: '#0b0a10', a: '#ff414b', b: '#ffcc00', c: '#4a0d5c', text: '#ffffff', muted: 'rgba(255,255,255,0.72)' },
  elegant: { bg: '#0d0906', a: '#d4a72c', b: '#f3e3c3', c: '#5a1a1f', text: '#fbf6ec', muted: 'rgba(251,246,236,0.7)' },
  neon: { bg: '#05040a', a: '#ff2d75', b: '#22e1ff', c: '#7c3aed', text: '#ffffff', muted: 'rgba(255,255,255,0.75)' },
});

function paletteFor(style, accent) {
  const base = PALETTES[style] || PALETTES.bold;
  return accent ? { ...base, a: accent } : base;
}

function cssFont(name, fallback) {
  try {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v ? `${v}, ${fallback}` : fallback;
  } catch { return fallback; }
}

export function createScreenPainter({ width = 1280, onAsset = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(width / SCREEN_ASPECT);
  const ctx = canvas.getContext('2d');
  // The incoming slide of a fade is painted here first, then laid over the
  // outgoing one whole: alpha on each shape would let a slide's own layers
  // show through each other.
  const buffer = document.createElement('canvas');
  buffer.width = canvas.width;
  buffer.height = canvas.height;
  const bctx = buffer.getContext('2d');
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 5;
  const pctx = probe.getContext('2d', { willReadFrequently: true });

  const fonts = {
    display: cssFont('--font-urbanist', 'system-ui, -apple-system, Segoe UI, sans-serif'),
    sans: cssFont('--font-dm-sans', 'system-ui, -apple-system, Segoe UI, sans-serif'),
    script: cssFont('--font-script', 'cursive'),
    serif: 'Georgia, "Times New Roman", serif',
  };
  // The web fonts may still be on their way; draw again once they land.
  try {
    if (document.fonts?.load) {
      Promise.all([
        document.fonts.load(`900 64px ${fonts.display}`),
        document.fonts.load(`400 64px ${fonts.script}`),
      ]).then(() => onAsset?.(), () => {});
    }
  } catch { /* a browser without the font API draws in the fallback */ }

  const images = new Map();
  /** The image at `url` once it has loaded, else null (and it is fetched). */
  const img = (url) => {
    if (!url) return null;
    let e = images.get(url);
    if (!e) {
      e = { ok: false, tries: 0 };
      images.set(url, e);
      const load = (src) => {
        const im = new Image();
        // Anonymous CORS, so the canvas stays readable and WebGL may upload
        // it. A host that refuses CORS fails the load; it never taints.
        im.crossOrigin = 'anonymous';
        im.decoding = 'async';
        im.onload = () => { e.ok = true; e.im = im; onAsset?.(); };
        im.onerror = () => {
          // Once more past the browser's cache, which may hold a copy fetched
          // without CORS by an <img> elsewhere on the page.
          e.tries += 1;
          if (e.tries === 1) load(`${url}${url.includes('?') ? '&' : '?'}screen=1`);
        };
        im.src = src;
      };
      load(url);
    }
    return e.ok ? e.im : null;
  };

  let pixelPattern = null;
  const pixels = () => {
    if (pixelPattern) return pixelPattern;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(3, 0, 1, 4);
    g.fillRect(0, 3, 4, 1);
    pixelPattern = ctx.createPattern(c, 'repeat');
    return pixelPattern;
  };

  const state = {
    screen: DEFAULT_SCREEN, feed: null, title: '', still: false,
    start: typeof performance !== 'undefined' ? performance.now() : 0, shift: 0,
  };

  // ── drawing helpers ────────────────────────────────────────────────────────
  const font = (g, weight, px, family, italic = false) => { g.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${family}`; };
  const spacing = (g, px) => { if ('letterSpacing' in g) g.letterSpacing = `${px}px`; };

  function fit(g, text, { weight, family, max, min, width, italic = false }) {
    let px = max;
    font(g, weight, px, family, italic);
    while (px > min && g.measureText(text).width > width) {
      px -= 4;
      font(g, weight, px, family, italic);
    }
    return px;
  }

  function wrap(g, text, width, lines) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const out = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width <= width || !line) line = next;
      else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    if (out.length > lines) {
      const kept = out.slice(0, lines);
      let last = kept[lines - 1];
      while (last.length > 1 && g.measureText(`${last}…`).width > width) last = last.slice(0, -1);
      kept[lines - 1] = `${last}…`;
      return kept;
    }
    return out;
  }

  /** Text that fits `width` in at most `lines` lines, as large as it can be. */
  function block(g, text, { weight, family, max, min, width, lines, italic = false }) {
    let px = max;
    let out;
    for (;;) {
      font(g, weight, px, family, italic);
      out = wrap(g, text, width, lines);
      const fits = out.length <= lines && out.every((l) => g.measureText(l).width <= width) && !out[out.length - 1].endsWith('…');
      if (fits || px <= min) break;
      px -= 4;
    }
    return { px, lines: out };
  }

  /** The image scaled to cover the box, its subject (`focus`, %) kept in. */
  function cover(g, im, x, y, w, h, { zoom = 1, focus = { x: 50, y: 50 }, drift = 0 } = {}) {
    const s = Math.max(w / im.width, h / im.height) * zoom;
    const dw = im.width * s;
    const dh = im.height * s;
    const fx = clamp01(focus.x / 100);
    const fy = clamp01(focus.y / 100);
    // Spare width or height either side of the box, spent so the focus point
    // sits where it does in the photo; `drift` moves across a little of it.
    const ox = x - (dw - w) * clamp01(fx + drift * 0.08);
    const oy = y - (dh - h) * fy;
    g.drawImage(im, ox, oy, dw, dh);
  }

  function contain(g, im, x, y, w, h) {
    const s = Math.min(w / im.width, h / im.height);
    g.drawImage(im, x + (w - im.width * s) / 2, y + (h - im.height * s) / 2, im.width * s, im.height * s);
  }

  function glow(g, pal, on) {
    if (on && state.screen.style === 'neon') {
      g.shadowColor = pal.a;
      g.shadowBlur = 28;
    } else {
      g.shadowBlur = 0;
    }
  }

  // ── backdrops ──────────────────────────────────────────────────────────────
  function backdrop(g, k) {
    const { pal, t, audio } = k;
    const style = state.screen.style;
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, W, H);
    const pump = 1 + (audio?.bass || 0) * 0.3;

    if (style === 'elegant') {
      const warm = g.createRadialGradient(W / 2, H * 0.55, 40, W / 2, H * 0.55, W * 0.7);
      warm.addColorStop(0, rgba(pal.c, 0.9));
      warm.addColorStop(1, rgba(pal.bg, 1));
      g.fillStyle = warm;
      g.fillRect(0, 0, W, H);
      // Bokeh: soft gold lights rising slowly, as in a ballroom out of focus.
      for (let i = 0; i < 22; i += 1) {
        const r = 14 + seeded(i) * 50;
        const x = seeded(i + 40) * W;
        const y = (((seeded(i + 80) * H) - t * (6 + seeded(i + 9) * 10)) % (H + 120) + H + 120) % (H + 120) - 60;
        const a = (0.05 + seeded(i + 3) * 0.12) * pump;
        const b = g.createRadialGradient(x, y, 0, x, y, r);
        b.addColorStop(0, rgba(pal.a, a));
        b.addColorStop(1, rgba(pal.a, 0));
        g.fillStyle = b;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = rgba(pal.a, 0.55);
      g.lineWidth = 1.5;
      g.strokeRect(30, 30, W - 60, H - 60);
      g.strokeStyle = rgba(pal.a, 0.25);
      g.strokeRect(40, 40, W - 80, H - 80);
      return;
    }

    if (style === 'neon') {
      const horizon = H * 0.64;
      const sun = g.createRadialGradient(W / 2, horizon, 10, W / 2, horizon, 520 * pump);
      sun.addColorStop(0, rgba(pal.a, 0.55));
      sun.addColorStop(0.4, rgba(pal.c, 0.25));
      sun.addColorStop(1, rgba(pal.bg, 0));
      g.fillStyle = sun;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i += 1) {
        g.fillStyle = `rgba(255,255,255,${0.15 + seeded(i) * 0.5})`;
        g.fillRect(seeded(i + 7) * W, seeded(i + 19) * horizon * 0.9, 2, 2);
      }
      g.fillStyle = pal.bg;
      g.fillRect(0, horizon, W, H - horizon);
      // The grid floor, running toward the viewer.
      g.lineWidth = 2;
      const phase = (t * 0.6) % 1;
      for (let i = 0; i < 14; i += 1) {
        const d = (i + phase) / 14;
        const y = horizon + (H - horizon) * d * d;
        g.strokeStyle = rgba(pal.a, 0.12 + d * 0.6);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      for (let i = -12; i <= 12; i += 1) {
        g.strokeStyle = rgba(pal.b, 0.35);
        g.beginPath();
        g.moveTo(W / 2 + i * 14, horizon);
        g.lineTo(W / 2 + i * 150, H);
        g.stroke();
      }
      g.fillStyle = rgba(pal.b, 0.85);
      g.fillRect(0, horizon - 1, W, 2);
      return;
    }

    // Bold: three soft lights drifting over a dark room, in the brand's colours.
    const blobs = [
      [pal.a, 0.62, 0.3 + 0.18 * Math.sin(t * 0.21), 0.35 + 0.2 * Math.cos(t * 0.17), 620],
      [pal.b, 0.38, 0.72 + 0.16 * Math.cos(t * 0.19), 0.62 + 0.18 * Math.sin(t * 0.23), 520],
      [pal.c, 0.75, 0.5 + 0.3 * Math.sin(t * 0.13 + 2), 0.15 + 0.2 * Math.sin(t * 0.11), 700],
    ];
    for (const [col, a, x, y, r] of blobs) {
      const gr = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * pump);
      gr.addColorStop(0, rgba(col, a));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // Two slow beams across it, like stage light through haze.
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i += 1) {
      g.save();
      g.translate(W * (0.3 + i * 0.4), -40);
      g.rotate(0.35 * Math.sin(t * 0.25 + i * 2) + (i ? -0.2 : 0.2));
      const beam = g.createLinearGradient(-60, 0, 60, 0);
      beam.addColorStop(0, 'rgba(255,255,255,0)');
      beam.addColorStop(0.5, `rgba(255,255,255,${0.05 + (audio?.level || 0) * 0.08})`);
      beam.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = beam;
      g.fillRect(-60, 0, 120, H * 1.6);
      g.restore();
    }
    g.restore();
  }

  function overline(g, text, x, y, k, align = 'left') {
    const { pal } = k;
    const style = state.screen.style;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    if (style === 'elegant') {
      font(g, 400, 46, fonts.script);
      spacing(g, 0);
      g.fillStyle = pal.a;
    } else {
      font(g, 700, 24, fonts.sans);
      spacing(g, 6);
      g.fillStyle = style === 'neon' ? pal.b : pal.a;
    }
    // Script type stays as typed: capitals in a script face read as shouting.
    g.fillText(style === 'elegant' ? String(text) : String(text).toUpperCase(), x, y);
    spacing(g, 0);
  }

  function headline(g, text, { x, y, width, lines = 2, max = 124, min = 48, align = 'left', k, alpha = 1 }) {
    const style = state.screen.style;
    const family = style === 'elegant' ? fonts.serif : fonts.display;
    const weight = style === 'elegant' ? 600 : 900;
    const b = block(g, text, { weight, family, max, min, width, lines });
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.globalAlpha = alpha;
    g.fillStyle = k.pal.text;
    glow(g, k.pal, true);
    const lh = b.px * 1.02;
    b.lines.forEach((l, i) => g.fillText(l, x, y + i * lh));
    glow(g, k.pal, false);
    g.globalAlpha = 1;
    return { height: lh * b.lines.length, px: b.px };
  }

  const DRAW = slideDrawers({
    state, fonts, img, font, spacing, fit, block, cover, contain, glow, backdrop, overline, headline,
  });

  function finish(g, k) {
    if (!state.screen.pixels) return;
    // AN LED WALL, not a monitor: a fine pixel grid, a soft scan of light and
    // darker edges. What sells the screen as stage hardware from a seat.
    g.save();
    g.globalAlpha = 0.28;
    g.fillStyle = pixels();
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    const scanY = k.still ? -999 : ((k.t * 90) % (H + 200)) - 100;
    const scan = g.createLinearGradient(0, scanY - 80, 0, scanY + 80);
    scan.addColorStop(0, 'rgba(255,255,255,0)');
    scan.addColorStop(0.5, 'rgba(255,255,255,0.035)');
    scan.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = scan;
    g.fillRect(0, scanY - 80, W, 160);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  function drawSlide(g, slide, k) {
    g.save();
    g.setTransform(g.canvas.width / W, 0, 0, g.canvas.height / H, 0, 0);
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    (DRAW[slide.kind] || DRAW.title)(g, slide, k);
    g.restore();
  }

  const elapsed = (now) => now - state.start + state.shift;

  return {
    canvas,

    /** What to show. Cheap: nothing is drawn until the next `paint`. */
    setContent({ screen, feed, title }) {
      state.screen = screen || DEFAULT_SCREEN;
      state.feed = feed || null;
      state.title = title || feed?.title || '';
    },

    setStill(still) { state.still = Boolean(still); },

    /** Straight to the next slide (a tap on the screen). */
    skip(now = performance.now()) {
      const dur = state.screen.seconds * 1000;
      const into = elapsed(now) % dur;
      state.shift += dur - into;
    },

    /**
     * One frame. `now` is a performance.now() reading; `audio` is
     * `{ level, bass, bins }` from the soundtrack, or null.
     */
    paint(now = performance.now(), audio = null) {
      const wall = Date.now();
      const list = playableSlides(state.screen.slides, state.feed, wall);
      const at = slideAt(list.length, state.screen.seconds, elapsed(now));
      const t = state.still ? 0 : now / 1000;
      const pal = paletteFor(state.screen.style, state.screen.accent);
      const base = { feed: state.feed, title: state.title, pal, t, now: wall, audio, still: state.still };
      const current = list[at.index];
      const mix = ease(at.mix);
      const blend = at.previous !== null && !state.still && state.screen.transition !== 'cut';

      if (!blend) {
        drawSlide(ctx, current, { ...base, p: at.progress });
      } else if (state.screen.transition === 'slide') {
        ctx.save();
        ctx.translate(-canvas.width * mix, 0);
        drawSlide(ctx, list[at.previous], { ...base, p: 1 });
        ctx.restore();
        ctx.save();
        ctx.translate(canvas.width * (1 - mix), 0);
        drawSlide(ctx, current, { ...base, p: at.progress });
        ctx.restore();
      } else {
        drawSlide(ctx, list[at.previous], { ...base, p: 1 });
        drawSlide(bctx, current, { ...base, p: at.progress });
        ctx.save();
        ctx.globalAlpha = mix;
        ctx.drawImage(buffer, 0, 0);
        ctx.restore();
      }

      ctx.save();
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      finish(ctx, base);
      ctx.restore();
      return { slide: current, index: at.index, count: list.length };
    },

    /** The frame's average colour, 0–1 per channel: what the screen throws on the room. */
    sample() {
      try {
        pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
        const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
        let r = 0; let g = 0; let b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        return [r / n / 255, g / n / 255, b / n / 255];
      } catch {
        return [0.6, 0.6, 0.6];
      }
    },

    dispose() {
      images.clear();
      canvas.width = 0;
      buffer.width = 0;
    },
  };
}
