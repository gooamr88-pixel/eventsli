/**
 * The shell's icons, drawn as strokes in `currentColor`.
 *
 * `currentColor` is the point: an icon takes the colour of the text beside it,
 * so the active item's icon turns accent with its label and a disabled one
 * fades with it — there is no second colour to keep in step.
 *
 * Always `aria-hidden`. Every icon here sits next to a text label that says
 * the same thing; an icon that is also announced is read twice.
 */
const PATHS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  calendar: ['M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5z', 'M4 9.5h16', 'M8.5 3v4', 'M15.5 3v4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 7.5h.01'],
  ticket: ['M3 8.5A2.5 2.5 0 0 0 5.5 6h13A2.5 2.5 0 0 0 21 8.5v1.6a2 2 0 0 0 0 3.8v1.6a2.5 2.5 0 0 0-2.5 2.5h-13A2.5 2.5 0 0 0 3 15.5v-1.6a2 2 0 0 0 0-3.8z', 'M14 6.5v11'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z', 'M9 4v14', 'M15 6v14'],
  layers: ['M12 3 3 8l9 5 9-5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5 12 22l9-4.5'],
  tag: ['M3 12V4h8l10 10-8 8L3 12z', 'M7.5 8h.01'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 18h2v2h-2z', 'M18 14h2', 'M14 18v2'],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  cash: ['M3 7h18v10H3z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6 10v4', 'M18 10v4'],
  percent: ['M19 5 5 19', 'M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  users: ['M9.5 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2.5 20.5v-.8a7 7 0 0 1 14 0v.8', 'M16.5 4.2a4 4 0 0 1 0 7.6', 'M21.5 20.5v-.8a6 6 0 0 0-3.6-5.5'],
  shield: ['M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z', 'M9 12l2 2 4-4'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3', 'M4 12h16'],
  bank: ['M3 10 12 4l9 6', 'M5 10v8', 'M9.5 10v8', 'M14.5 10v8', 'M19 10v8', 'M3 21h18'],
  user: ['M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M4 21v-1a8 8 0 0 1 16 0v1'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8.2 12.2l2.6 2.6 5-5.6'],
  tick: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M12 3 2.5 20h19L12 3z', 'M12 10v4.5', 'M12 17.5h.01'],
  arrow: ['M4.5 12h14', 'M13 6.5l5.5 5.5-5.5 5.5'],
  // Added for the storefront's search bar. The only magnifier in the app: the
  // header's search affordance and the hero's field are the same idea and must
  // not be two different glyphs.
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M17 17l4 4'],
  play: ['M8.5 5.6a1 1 0 0 1 1.52-.85l9 6.4a1 1 0 0 1 0 1.7l-9 6.4a1 1 0 0 1-1.52-.85z'],
  heart: ['M12 20.3c-1.1-.8-8-5.3-8-10.3A4.7 4.7 0 0 1 12 7.2 4.7 4.7 0 0 1 20 10c0 5-6.9 9.5-8 10.3z'],
  star: ['M12 3.6l2.66 5.4 5.96.87-4.31 4.2 1.02 5.93L12 17.2l-5.33 2.8 1.02-5.93L3.38 9.87l5.96-.87z'],
  // Delete. Distinct from `alert`, which is a warning triangle — using that for
  // a bin makes every destructive control look like a validation message.
  // The "near me" control. A crosshair rather than a map pin: a pin marks
  // a place somebody already chose, a crosshair is the act of finding out
  // where they are, which is what the button does.
  locate: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 1.5v2.5', 'M12 20v2.5', 'M1.5 12H4', 'M20 12h2.5'],
  // Dismiss. A cross drawn on the same grid as the rest, not a multiplication
  // sign in a text node — that is a font-dependent glyph at a different weight
  // on every platform.
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  trash: ['M4 7h16', 'M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7', 'M6.4 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.6 7', 'M10.2 11v6', 'M13.8 11v6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  pin: ['M12 21.5c4.2-4.2 6.5-7.6 6.5-11a6.5 6.5 0 0 0-13 0c0 3.4 2.3 6.8 6.5 11z', 'M12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  sparkle: ['M12 3.2l1.9 5.5 5.5 1.9-5.5 1.9-1.9 5.5-1.9-5.5L4.6 10.6l5.5-1.9z', 'M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z'],
  briefcase: ['M3 8h18v12H3z', 'M8 8V5h8v3', 'M3 13h18'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
  list: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  menu: ['M4 7.5h16', 'M4 12h16', 'M4 16.5h11'],
  plus: ['M12 5v14', 'M5 12h14'],
  archive: ['M3 4h18v4H3z', 'M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8', 'M10 12h4'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8'],
  mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
  card: ['M3 6h18v12H3z', 'M3 10h18', 'M7 15h4'],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  exit: ['M15 4h4v16h-4', 'M10 16l-4-4 4-4', 'M6 12h10'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  copy: ['M8 8h12v12H8z', 'M4 16V4h12'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
  trend: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  money: ['M12 3v18', 'M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5 9.2 10.5 12 11s5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3'],
  door: ['M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17', 'M3 21h18', 'M14.5 12h.01'],
  chat: ['M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z'],
  arrowUpRight: ['M7 17 17 7', 'M8 7h9v9'],
};

/**
 * @param {object} props
 * @param {string} [props.className]  for a caller that needs to tone one icon
 *   differently from the text beside it — the empty half of a star rating is
 *   the case this was added for. Everything else should let `currentColor` do
 *   its job.
 * @param {boolean} [props.filled]  paint the shape as well as stroke it. Only
 *   meaningful for the closed shapes (star, heart, play); on an open path like
 *   `arrow` it fills the area the stroke encloses, which is not a thing anyone
 *   wants.
 */
export default function NavIcon({ name, size = 20, className = '', filled = false }) {
  const paths = PATHS[name] || PATHS.info;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
