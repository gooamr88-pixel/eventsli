/**
 * Query strings, without `URL` / `URLSearchParams`.
 *
 * React Native's URL is a regex approximation (react-native/Libraries/Blob/
 * URL.js): it behaves differently from the WHATWG one that Jest and Node
 * provide, so code that passes its tests can still misread a callback on a
 * phone. Sign-in depends on reading `code` and `state` exactly, so this is
 * small, explicit and the same everywhere.
 */

export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** The query parameters of a URL (any scheme), decoded. The fragment is ignored. */
export function parseQuery(url: string): Record<string, string> {
  const q = String(url || '').split('#')[0];
  const at = q.indexOf('?');
  const out: Record<string, string> = {};
  if (at < 0) return out;
  for (const pair of q.slice(at + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawVal = eq < 0 ? '' : pair.slice(eq + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      if (!(key in out)) out[key] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      // A malformed escape: skip the pair rather than throw out the rest.
    }
  }
  return out;
}
