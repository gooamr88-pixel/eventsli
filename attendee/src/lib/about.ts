/** An event's description, split the way its page shows it (2026-11-28). */

/**
 * The mockup's tagline under the title ("Live the ultimate music
 * experience") is the organizer's own first line, when it is one short line
 * followed by more; About then starts after it, so nothing is said twice.
 */
export function splitAbout(description: string | null | undefined): { tagline: string | null; body: string | null } {
  const text = (description ?? '').trim();
  if (!text) return { tagline: null, body: null };
  const m = text.match(/^([^\n]{3,80}?)\s*\n+\s*([\s\S]+)$/);
  if (m && m[2].trim().length > 20) return { tagline: m[1].trim(), body: m[2].trim() };
  return { tagline: null, body: text };
}
