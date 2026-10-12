import { API_URL, PUBLIC_API_URL } from '../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The admission code, INLINED INTO THE PAGE rather than linked from it.
 *
 * This page makes a promise two lines under the button: "A saved copy still
 * scans with no signal at the door." An `<img src="https://…/public/qr/…">`
 * cannot keep it. Print-to-PDF captures a reference, not the bytes, so the
 * saved sheet is a broken image the moment the phone is offline — which is the
 * exact situation the promise is about, and the exact situation nobody tests.
 *
 * It also removes a whole class of environment bug. The absolute URL was built
 * from NEXT_PUBLIC_API_URL, a BUILD-time value: get it wrong on the box and the
 * page renders perfectly while the only thing on it that matters does not load.
 * A data URI is resolved here, on the server, by the same runtime that already
 * fetched the ticket.
 *
 * The API still draws it — the signature is checked there and the drawing is
 * not duplicated — and on the server `API_URL` is the loopback address, so this
 * is a local round trip, not a hairpin out through nginx.
 *
 * ON FAILURE it falls back to the absolute URL instead of throwing. A code that
 * needs a connection is worth far more than no code at all, and a ticket page
 * that 500s because one image did is the worst of the three outcomes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function qrDataUri(qrToken) {
  const remote = `${PUBLIC_API_URL}/public/qr/${encodeURIComponent(qrToken)}`;
  if (!qrToken) return null;

  try {
    const res = await fetch(`${API_URL}/public/qr/${encodeURIComponent(qrToken)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return remote;

    const bytes = Buffer.from(await res.arrayBuffer());
    // A 360px QR PNG is ~1.5KB, so inlining it costs less than the request it
    // replaces. Guarded anyway: an error page served as 200 would otherwise be
    // base64'd into the <img> and render as nothing at all.
    if (bytes.length === 0 || bytes.length > 256 * 1024) return remote;

    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return remote;
  }
}
