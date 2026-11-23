import { cookies } from 'next/headers';
import { serverFetch } from '../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EVENT MAP, FOR THE EVENT PAGE (2026-11-23). Server components only.
 *
 * A reserved-seating event's map is its seat page. A general-admission
 * event's map sells nothing — the stage, the bars, the entrances, the vendor
 * booths — so it is shown on the event page itself, read from the same public
 * endpoint the seat page uses.
 *
 * `null` when there is nothing to show (no map, or one with nothing drawn) or
 * the read failed: the event page must never fail because of a picture of
 * the room. A private event this visitor unlocked is read with their cookies
 * and never cached, as lib/eventAccess.js reads its page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function loadEventMap(slug, { isPrivate = false } = {}) {
  const path = `/public/events/${encodeURIComponent(slug)}/seat-map`;
  try {
    const data = isPrivate
      ? await serverFetch(path, { cookieStore: await cookies(), cache: 'no-store' })
      : await serverFetch(path, { tags: [`event:${slug}`], revalidate: 60 });
    if (!data?.map) return null;
    const zones = Array.isArray(data.map.layout?.zones) ? data.map.layout.zones : [];
    const booths = data.vendorBooths?.plan?.elements?.filter((e) => e.kind === 'booth') || [];
    if (zones.length === 0 && booths.length === 0) return null;
    return { layout: data.map.layout, vendorBooths: data.vendorBooths || null, currency: data.event?.currency || null };
  } catch {
    return null;
  }
}
