import { PixelRatio } from 'react-native';

import { API_URL, PRODUCTION_API_URL } from '../api/client';

/**
 * EVENT PICTURES, SHRUNK TO THE SIZE THEY ARE SHOWN AT.
 *
 * Covers are stored full size in Supabase Storage — 300 to 550 KB each — and
 * Home alone shows twenty of them, so the app was pulling several megabytes
 * before it looked finished. The website already serves them through its own
 * image optimiser (Next.js `/_next/image`, allowed for exactly this storage
 * path in frontend/next.config), which answers WebP at the width asked for:
 * a 640-wide cover is ~36 KB instead of ~360 KB, and is cached on the server.
 *
 * It also comes from eventsli.com rather than supabase.co, which some
 * networks fail to resolve (seen on the owner's router, 2026-11-20).
 *
 * Only Supabase public-storage URLs are rewritten (anything else is returned
 * as it is, since the optimiser refuses other hosts), and only when the app
 * talks to production — a development build pointed at a laptop has no
 * Next.js optimiser behind its API address.
 */
const SITE = PRODUCTION_API_URL.replace(/\/api\/v1$/, '');
/** Widths the optimiser accepts (Next.js defaults: imageSizes + deviceSizes). */
const WIDTHS = [96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920] as const;
const STORAGE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//i;

/** The smallest accepted width at least `points` × the screen's density. */
export function widthFor(points: number, density: number): number {
  const px = Math.ceil(points * density);
  return WIDTHS.find((w) => w >= px) ?? WIDTHS[WIDTHS.length - 1];
}

export function optimisedUrl(url: string, points: number, density: number, viaSite: boolean): string {
  if (!viaSite || !STORAGE.test(url)) return url;
  return `${SITE}/_next/image?url=${encodeURIComponent(url)}&w=${widthFor(points, density)}&q=75`;
}

/** `uri` at the size it is drawn, `points` wide on this phone. */
export function imageUrl(uri: string | null | undefined, points: number): string | null {
  if (!uri) return null;
  return optimisedUrl(uri, points, PixelRatio.get(), API_URL === PRODUCTION_API_URL);
}
