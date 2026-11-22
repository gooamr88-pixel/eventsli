import { cookies } from 'next/headers';
import { serverFetch } from '../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Loading an event page that may be PRIVATE (2026-11-22). Server components only.
 *
 * Every event page first asks the API the cached, cookie-less way it always
 * has — a public event is unchanged, and its answer is shared by everybody.
 *
 * A private event answers that with `EVENT_PRIVATE`. Only then is it asked
 * again WITH the visitor's cookies (the unlock cookie, or the organizer's
 * session) and with `no-store`, because an unlocked page belongs to one
 * person and must never land in the shared cache.
 *
 * Returns one of:
 *   { data }            the page's data (null for a 404)
 *   { data, private }   the same, for a private event this visitor unlocked
 *   { locked }          title, cover and organizer only — show the password gate
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function loadEventForViewer(slug, { path = '', revalidate = 60, tags } = {}) {
  const url = `/public/events/${encodeURIComponent(slug)}${path}`;
  /**
   * `?locked=ok`: the API answers a private event's cached read with a 200
   * `{ locked: true }` instead of a 403 (backend eventAccess.sendLocked).
   * Next's data cache stores only 200s, so with a 403 a page cached while the
   * event was public stayed cached once it went private — shown to everyone
   * without the password, and frozen: a new extra never appeared (2026-11-22).
   * A 200 replaces it within a minute. The new URL is also a new cache key,
   * so every copy cached the old way is dropped on deploy.
   */
  try {
    const data = await serverFetch(`${url}?locked=ok`, { tags: tags || [`event:${slug}`], revalidate });
    if (!data?.locked) return { data };
  } catch (err) {
    if (err?.status === 404) return { data: null };
    if (err?.code !== 'EVENT_PRIVATE') throw err;
  }

  try {
    const data = await serverFetch(url, { cookieStore: await cookies(), cache: 'no-store' });
    return { data, private: true };
  } catch (err) {
    if (err?.status === 404) return { data: null };
    if (err?.code === 'EVENT_PRIVATE') return { locked: err.meta?.event || { slug, title: null } };
    throw err;
  }
}

/** For `generateMetadata` on a locked or private page: name it, never index it. */
export function privateMetadata(title) {
  return {
    title: title ? `${title} (private event)` : 'Private event',
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  };
}
