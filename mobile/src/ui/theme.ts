/**
 * The Eventsli palette, from the website's tokens (frontend/src/app/globals.css)
 * so the door app and the site are one brand.
 *
 * WHITE, YELLOW AND CORAL since 2026-11-15 (the approved brand sheet). The
 * accent is the website's text-safe coral #D61F2C — the sheet's #FF414B carries
 * white at only 3.44:1 — and the sheet's exact coral and yellow are kept for
 * graphics. Yellow is never text on a light ground. The status colours are the
 * site's, tuned for text on white.
 */
export const colors = {
  coral50: '#fff1f2',
  coral100: '#ffe0e2',
  coral200: '#ffc2c6',
  coral300: '#ff949a',
  coral500: '#ff414b',
  coral600: '#d61f2c',
  coral700: '#b5121e',
  coral800: '#8f0e18',
  sun100: '#fff3c4',
  sun200: '#ffe58a',
  sun300: '#ffd94d',
  sun400: '#ffcc00',
  night: '#111018',
  night800: '#1b1a24',

  accent: '#d61f2c',
  accentPressed: '#b5121e',
  onAccent: '#ffffff',
  // The sheet's yellow, as a FILL with near-black on it (12.5:1).
  highlight: '#ffcc00',
  onHighlight: '#111018',

  // The sheet's off-white ground, white cards on top.
  bg: '#f8f8f8',
  bgSunken: '#f1f1f3',
  surface: '#ffffff',
  border: '#eaeaea',
  // The sign-in mockup's soft pill fields.
  field: '#f6f6f8',
  fieldBorder: '#e3e3e8',
  // The pale coral behind an accent icon or chip (was the mint wash).
  wash: '#fff1f2',
  borderStrong: '#b8b8c0',
  // Words on a dark ground (the camera, the event cover): the pale yellow.
  onDark: '#ffe58a',
  onDarkMuted: '#c9c8d6',

  text: '#111018',
  muted: '#4a4a55',
  subtle: '#60606b',
  // A hint like "Name, email or ticket number" is information, so it meets the
  // text contrast too (test/contrast.test.ts).
  placeholder: '#5f5f6a',

  success: '#166534',
  successSoft: '#e7f6ec',
  successStrong: '#22a35a',
  warning: '#92400e',
  warningSoft: '#fdf3e2',
  warningStrong: '#d97706',
  danger: '#b91c1c',
  dangerSoft: '#fdecec',
  dangerStrong: '#dc2626',
  hold: '#60606b',
  holdSoft: '#f1f1f3',
  // The answer icons: a strong glyph on a soft halo.
  successHalo: '#e3f5e9',
  warningGlyph: '#c2610c',
  warningHalo: '#fdeccf',
  dangerGlyph: '#d42c2c',
  dangerHalo: '#fde3e3',
  offline: '#f59e0b',

  camera: '#000000',
  overlay: 'rgba(17, 16, 24, 0.72)',
  white: '#ffffff',
} as const;

/** As on the site: DM Sans to read, Urbanist for titles (2026-11-15).
 *  Names match the loaded font assets. */
export const fonts = {
  display: 'Urbanist_900Black',
  // A lighter Urbanist for the sign-in welcome, as the mockup sets it.
  displayBold: 'Urbanist_700Bold',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
  mono: 'Menlo',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const type = {
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  title: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  // The big left-aligned screen titles: My Events, Check-in Logs, Settings.
  screenTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32 },
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38 },
} as const;

/** The four physical answers a door has (see src/gate/outcomes.ts). */
export const tones = {
  admit: { fg: colors.success, soft: colors.successSoft, strong: colors.successStrong },
  warn: { fg: colors.warning, soft: colors.warningSoft, strong: colors.warningStrong },
  refuse: { fg: colors.danger, soft: colors.dangerSoft, strong: colors.dangerStrong },
  hold: { fg: colors.hold, soft: colors.holdSoft, strong: colors.hold },
} as const;

export type Tone = keyof typeof tones;

export const shadow = {
  card: {
    shadowColor: '#111018',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#111018',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
} as const;
