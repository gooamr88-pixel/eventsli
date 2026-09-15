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
  calendar: ['M4 5h16v16H4z', 'M4 10h16', 'M9 3v4', 'M15 3v4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 7.5h.01'],
  ticket: ['M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z', 'M14 6v12'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z', 'M9 4v14', 'M15 6v14'],
  layers: ['M12 3 3 8l9 5 9-5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5 12 22l9-4.5'],
  tag: ['M3 12V4h8l10 10-8 8L3 12z', 'M7.5 8h.01'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 18h2v2h-2z', 'M18 14h2', 'M14 18v2'],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  cash: ['M3 7h18v10H3z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6 10v4', 'M18 10v4'],
  percent: ['M19 5 5 19', 'M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7', 'M22 21v-1a6 6 0 0 0-4-5.6'],
  shield: ['M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z', 'M9 12l2 2 4-4'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3', 'M4 12h16'],
  bank: ['M3 10 12 4l9 6', 'M5 10v8', 'M9.5 10v8', 'M14.5 10v8', 'M19 10v8', 'M3 21h18'],
  user: ['M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M4 21v-1a8 8 0 0 1 16 0v1'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12l3 3 5-6'],
  tick: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M12 3 2.5 20h19L12 3z', 'M12 10v4.5', 'M12 17.5h.01'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  pin: ['M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z'],
  briefcase: ['M3 8h18v12H3z', 'M8 8V5h8v3', 'M3 13h18'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
  list: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  plus: ['M12 5v14', 'M5 12h14'],
  exit: ['M15 4h4v16h-4', 'M10 16l-4-4 4-4', 'M6 12h10'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  copy: ['M8 8h12v12H8z', 'M4 16V4h12'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
  trend: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  money: ['M12 3v18', 'M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5 9.2 10.5 12 11s5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3'],
  door: ['M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17', 'M3 21h18', 'M14.5 12h.01'],
};

export default function NavIcon({ name, size = 20 }) {
  const paths = PATHS[name] || PATHS.info;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
