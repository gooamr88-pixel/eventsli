/**
 * The owner's "Ladies Night" seating plan (2026-11-19), written out as the AI
 * reports it: boxes named T1…T60 with their capacity printed ("8p"), no
 * chairs drawn, a gold frame for the room. Measured by hand from the owner's
 * screenshot (a 600 × 480 view of the picture), in percent of the picture.
 */
const W = 600;
const H = 480;
const TOP = 185;
const pct = (x, y, w, h) => ({ x: (x / W) * 100, y: ((y - TOP) / H) * 100, w: (w / W) * 100, h: (h / H) * 100 });
const t = (label, shape, x, y, w, h, capacity) => ({
  label, shape, ...pct(x, y, w, h), sides: [0, 0, 0, 0], around: 0, capacity, curve: null, fill: null,
});
const a = (kind, label, x, y, w, h, extra = {}) => ({
  kind, label, sublabel: null, ...pct(x, y, w, h), shape: 'rect', fill: null, border: 'solid', ...extra,
});
const line = (x1, y1, x2, y2) => ({ x1: (x1 / W) * 100, y1: ((y1 - TOP) / H) * 100, x2: (x2 / W) * 100, y2: ((y2 - TOP) / H) * 100 });

const side = ['T5A', 'T5', 'T4', 'T3', 'T2', 'T1'].map((l, i) => t(l, 'rect', 59, 377 + i * 26.8, 48, 22, 6));
const row = (labels, y) => labels.map((l, i) => t(l, 'square', 161 + i * 48.6, y, 44, 36, 10));

export const LADIES_NIGHT_PLAN = {
  image: { width: 1600, height: 1280 },
  room: { floor: '#fbf6ea', wall: '#c9a24a', label: '#1f4f4c', table: '#1f5f5b', tableBorder: '#c9a24a' },
  seatColors: [],
  tables: [
    t('T7', 'rect', 159, 339, 72, 24, 8),
    t('T8', 'rect', 157, 373, 92, 24, 14),
    t('T9', 'rect', 157, 401, 92, 24, 14),
    t('T10', 'rect', 157, 431, 92, 24, 14),
    t('T39', 'rect', 423, 339, 90, 24, 8),
    t('T37', 'rect', 423, 372, 90, 24, 14),
    t('T36', 'rect', 423, 403, 90, 24, 14),
    t('T35', 'rect', 423, 432, 90, 24, 14),
    ...side,
    ...row(['T11', 'T18', 'T19', 'T24', 'T25', 'T33'], 467),
    ...row(['T12', 'T17', 'T20', 'T23', 'T26', 'T32'], 511),
    t('T34B', 'round', 472, 467, 36, 36, 6),
    t('T31', 'square', 491, 520, 28, 24, 2),
    t('T13', 'round', 221, 551, 32, 30, 6),
    t('T16', 'round', 265, 551, 32, 30, 6),
    t('T14', 'round', 221, 584, 32, 30, 6),
    t('T15', 'round', 265, 584, 32, 30, 6),
    t('T22', 'rect', 330, 553, 44, 22, 6),
    t('T21', 'rect', 330, 580, 44, 22, 3),
    t('T27', 'square', 378, 558, 34, 34, 4),
    t('T29', 'rect', 436, 558, 64, 34, 8),
    t('T30', 'square', 493, 558, 40, 34, 10),
    t('T60', 'rect', 288, 608, 130, 22, 10),
  ],
  areas: [
    a('stage', 'Stage', 288, 328, 126, 26, { fill: '#1f5f5b' }),
    a('dance_floor', 'Dance floor', 290, 392, 150, 60),
    a('custom', 'Control room', 84, 341, 52, 28),
    a('custom', 'High chairs', 506, 358, 52, 24, { sublabel: '16p' }),
    a('restroom', 'Wash room', 506, 385, 52, 20),
    a('bar', 'Bar', 538, 430, 46, 140, { fill: '#1f5f5b' }),
    a('welcome_desk', 'Reception', 84, 537, 90, 16),
    a('welcome_desk', 'Host', 93, 570, 14, 40),
    a('entrance', 'Entrance', 93, 607, 60, 18),
  ],
  // The frame, as the model drew it on the 2:35 reading: the bottom too high.
  walls: [line(27, 320, 562, 320), line(562, 320, 562, 560), line(562, 560, 27, 560), line(27, 560, 27, 320)],
  doors: [],
  texts: [{ text: 'Ladies Night', x: 50, y: 6, size: 4 }],
};
