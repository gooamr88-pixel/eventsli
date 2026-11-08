/**
 * The Eventsli palette, from the website's tokens (frontend/src/app/globals.css)
 * so the door app and the site are one brand. Teal #0D5B5E is the accent; the
 * status colours are the site's, tuned for text on white.
 */
export const colors = {
  teal50: '#eef6f6',
  teal100: '#d8ebeb',
  teal200: '#b3d8d9',
  teal300: '#80bcbe',
  teal400: '#3f9599',
  teal500: '#1d7a7e',
  teal600: '#136a6d',
  teal700: '#0d5b5e',
  teal800: '#0a4b4e',
  teal900: '#083c3e',
  night: '#061e20',

  accent: '#0d5b5e',
  accentPressed: '#0a4b4e',
  onAccent: '#ffffff',

  bg: '#ffffff',
  bgSunken: '#f2f4f5',
  surface: '#ffffff',
  border: '#e2e7e8',
  borderStrong: '#b3bfc2',

  text: '#0b1617',
  muted: '#45585b',
  subtle: '#566a6d',
  placeholder: '#93a3a6',

  success: '#166534',
  successSoft: '#e7f6ec',
  successStrong: '#22a35a',
  warning: '#92400e',
  warningSoft: '#fdf3e2',
  warningStrong: '#d97706',
  danger: '#b91c1c',
  dangerSoft: '#fdecec',
  dangerStrong: '#dc2626',
  hold: '#566a6d',
  holdSoft: '#eef1f2',

  camera: '#000000',
  overlay: 'rgba(6, 30, 32, 0.72)',
  white: '#ffffff',
} as const;

/** DM Sans, as on the site. Names match the loaded font assets. */
export const fonts = {
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
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32 },
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38 },
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
    shadowColor: '#0b1617',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;
