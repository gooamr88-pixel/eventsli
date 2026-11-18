/**
 * The owner's reference floor plan (2026-11-15/19, 1553 × 912 px) written out
 * as the AI's answer should read it: every box in pixels, turned into the
 * percentages `seatingFromImage.validateMap` returns. Used by the import tests
 * to check that `planToMap` keeps the picture's proportions.
 */
const W = 1553;
const H = 912;
const box = (x0, x1, y0, y1) => ({
  x: ((x0 + x1) / 2 / W) * 100, y: ((y0 + y1) / 2 / H) * 100, w: ((x1 - x0) / W) * 100, h: ((y1 - y0) / H) * 100,
});
const T = (label, shape, b, [top, right, bottom, left], extra = {}) => ({
  label, shape, ...b, sides: [top, right, bottom, left], around: 0, curve: null, fill: null, ...extra,
});

export const REFERENCE_PLAN = {
  image: { width: W, height: H },
  room: { floor: '#fffcf2', wall: '#0e3a4a', label: '#10303d', table: '#8c8c8c' },
  seatColors: ['#d6006e', '#00949a'],
  tables: [
    T('S01', 'rect', box(13, 112, 96, 152), [2, 0, 2, 0]),
    T('S02', 'rect', box(138, 238, 96, 152), [2, 0, 2, 0]),
    T('S03', 'rect', box(263, 389, 96, 152), [3, 0, 3, 0]),
    T('S28', 'rounded_end', box(647, 722, 96, 152), [2, 0, 2, 0], { curve: 'left' }),
    T('S29', 'rect', box(743, 828, 96, 152), [2, 0, 2, 0]),
    T('S30', 'rect', box(841, 926, 96, 152), [2, 0, 2, 0]),
    T('S31', 'rect', box(939, 1024, 96, 152), [2, 0, 2, 0]),
    T('S32', 'rect', box(1038, 1121, 96, 152), [2, 0, 2, 0]),
    T('S33', 'rect', box(1137, 1226, 96, 152), [2, 0, 2, 0]),
    T('S34', 'rect', box(1238, 1362, 96, 152), [3, 0, 3, 0]),
    T('S35', 'rounded_end', box(1408, 1481, 96, 152), [2, 0, 2, 0], { curve: 'right' }),
    T('S36', 'rect', box(1028, 1110, 207, 264), [2, 0, 2, 0]),
    T('S37', 'rect', box(1127, 1210, 207, 264), [2, 0, 2, 0]),
    T('S38', 'rect', box(1223, 1307, 207, 264), [2, 0, 2, 0]),
    T('S39', 'rect', box(1317, 1400, 207, 264), [2, 0, 2, 0]),
    T('S40', 'rect', box(1409, 1490, 207, 264), [2, 0, 2, 0]),
    T('S04', 'd_shape', box(24, 86, 213, 298), [0, 1, 0, 2], { curve: 'right' }),
    T('S06', 'd_shape', box(20, 81, 559, 642), [0, 1, 0, 2], { curve: 'right' }),
    T('S07', 'rect', box(191, 423, 537, 595), [6, 0, 6, 0]),
    T('S08', 'rect', box(191, 423, 650, 708), [6, 0, 6, 0]),
    T('S09', 'rect', box(191, 423, 770, 828), [6, 0, 6, 0]),
    T('S10', 'rect', box(618, 708, 294, 351), [2, 0, 2, 0]),
    T('S11', 'rect', box(724, 817, 294, 351), [2, 0, 2, 0]),
    T('S12', 'rect', box(618, 708, 410, 466), [2, 0, 2, 0]),
    T('S13', 'rect', box(724, 816, 410, 466), [2, 0, 2, 0]),
    T('S14', 'rect', box(855, 920, 312, 418), [0, 2, 0, 2]),
    T('S15', 'rect', box(855, 920, 430, 537), [0, 2, 0, 2]),
    T('S16', 'rect', box(855, 920, 547, 657), [0, 2, 0, 2]),
    T('S17', 'rect', box(855, 920, 664, 772), [0, 2, 0, 2]),
    T('S18', 'rect', box(998, 1056, 546, 669), [0, 3, 0, 3]),
    T('S19', 'rect', box(998, 1056, 685, 806), [0, 3, 0, 3]),
    T('S20', 'rect', box(481, 669, 823, 871), [4, 0, 4, 0]),
    T('S05', 'rect', box(704, 784, 818, 875), [0, 2, 0, 2]),
    T('S21', 'rect', box(834, 1013, 823, 871), [4, 0, 4, 0]),
  ],
  areas: [
    { kind: 'dance_floor', label: 'Dance floor', sublabel: null, ...box(127, 587, 227, 489), shape: 'rect', fill: '#f5bbd3', border: 'none' },
    { kind: 'dj_booth', label: 'DJ', sublabel: null, ...box(7, 60, 362, 553), shape: 'rounded', fill: '#0e3a4a', border: 'none' },
    { kind: 'bar', label: 'Bar', sublabel: 'Tea & coffee · Drinks', ...box(17, 171, 675, 857), shape: 'rounded', fill: '#c3e4df', border: 'none' },
    { kind: 'custom', label: 'Kitchen', sublabel: null, ...box(1105, 1485, 314, 886), shape: 'rounded', fill: '#e6e6de', border: 'none' },
    { kind: 'decor', label: '', sublabel: null, ...box(592, 827, 510, 745), shape: 'rings', fill: null, border: 'none' },
    { kind: 'custom', label: '', sublabel: null, ...box(1049, 1070, 323, 540), shape: 'pill', fill: '#c4b49a', border: 'none' },
  ],
  walls: [
    [0, 62, 443, 62], [443, 62, 443, 5], [571, 5, 571, 62], [571, 62, 1503, 62], [1503, 62, 1503, 293],
    [1503, 293, 1090, 293], [1090, 293, 1090, 912], [0, 898, 537, 898], [537, 898, 537, 912],
  ].map(([x1, y1, x2, y2]) => ({ x1: (x1 / W) * 100, y1: (y1 / H) * 100, x2: (x2 / W) * 100, y2: (y2 / H) * 100 })),
  doors: [],
  texts: [
    { text: 'Entrance', x: (507 / W) * 100, y: (35 / H) * 100, size: 1.6 },
    { text: 'Side door', x: (20 / W) * 100, y: (338 / H) * 100, size: 1.3 },
    { text: 'Decorative circular seating', x: (692 / W) * 100, y: (779 / H) * 100, size: 1.6 },
  ],
  summary: '34 tables, 174 seats, 6 areas.',
};
