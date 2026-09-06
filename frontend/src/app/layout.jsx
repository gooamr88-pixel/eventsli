import { DM_Sans, DM_Serif_Display, DM_Mono } from 'next/font/google';
import SiteHeader from './components/SiteHeader';
import SiteFooter from './components/SiteFooter';
import './globals.css';

/**
 * The three faces the design system names, self-hosted by next/font.
 *
 * Self-hosted rather than a <link> to fonts.googleapis.com: that link is a
 * render-blocking request to a third party in front of every page, including
 * the checkout. next/font fetches at build time, emits the files from our own
 * origin, and inlines the @font-face — one fewer connection and one fewer
 * party in the purchase path.
 *
 * Each exposes a CSS variable that globals.css picks up. Only the weights
 * actually used are requested; DM Sans ships 100–1000 and pulling all of them
 * is most of a megabyte for nine weights nothing renders.
 */
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-dm-serif',
  display: 'swap',
});

/** Prices, seat labels, order references, the hold countdown. */
const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY PAGE RENDERS PER REQUEST, and it is the CSP nonce that requires it.
 *
 * Declared once here rather than in each page, because it is one decision and
 * scattering it means the next page somebody adds is the one that is quietly
 * broken.
 *
 * Why it is not optional: `proxy.ts` issues a per-request nonce and Next stamps
 * it onto the inline `<script>` tags carrying React's payload. A PRERENDERED
 * page has no render at request time, so its scripts carry the build's nonce or
 * none at all — and the browser refuses them. Measured, not assumed: before
 * this line, `/events` (already dynamic) served 24 correctly nonced tags while
 * `/how-it-works` (prerendered) served 14 inline scripts with zero, every one
 * of them blocked.
 *
 * What this costs and what it does not. It costs the full route cache: HTML is
 * built per request instead of being served from disk. It does NOT cost the
 * data cache — `serverFetch`'s tagged, revalidating fetches are a separate
 * mechanism and are untouched, so a re-render re-runs some JSX and does not
 * re-ask the API. The pages that carry real work (`/e/[slug]`, `/events`, the
 * checkout, everything under /organizer) were already dynamic; the ones that
 * were static are marketing copy with no data behind them.
 *
 * The alternative was `'unsafe-inline'` on script-src in production, which is
 * what the platform this replaces did, and what this project set out not to do.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://eventsli.com'),
  title: {
    default: 'Eventsli — find events, pick your seat',
    // Every page sets its own title and gets the brand appended. An event page
    // that reads only "Eventsli" is the same share card as every other one.
    template: '%s · Eventsli',
  },
  description:
    'Book concerts, festivals, conferences and sports across Canada and the United States. '
    + 'Choose your seat on the map, pay once, and arrive with a ticket on your phone.',
  applicationName: 'Eventsli',
  openGraph: {
    type: 'website',
    siteName: 'Eventsli',
    locale: 'en_US',
    /**
     * The default share card, inherited by every page that does not set its
     * own. An event page overrides it with its cover.
     *
     * `width` and `height` are not decoration: Facebook's crawler renders a
     * card from the first fetch it makes, and without the dimensions it has to
     * download the image before it can lay anything out — which on a first
     * share, on a cold cache, is often a card with a blank space where the
     * picture goes. Twitter is more forgiving and still faster with them.
     *
     * A static PNG rather than a generated one. `next/og` would draw a nicer
     * per-page card, but it puts a font file and a WASM renderer in the build
     * for an image that says the same eight words every time. The place a
     * bespoke card actually earns its keep is the event page, and there the
     * cover art already IS the card.
     */
    images: [{
      url: '/og-default.png',
      width: 1200,
      height: 630,
      alt: 'Eventsli — find something to go to',
    }],
  },
  // Twitter inherits the OpenGraph image; only the card TYPE has to be stated,
  // and `summary_large_image` is what turns a thumbnail into a banner.
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#059669' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
  width: 'device-width',
  initialScale: 1,
  // `viewportFit: cover` is what makes env(safe-area-inset-*) report anything
  // other than zero. Without it every .fx-safe-* class is inert and the gate
  // app's action bar sits under the home indicator.
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerif.variable} ${dmMono.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
