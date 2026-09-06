import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Cache invalidation hook for the Express backend.
 *
 * Public event pages cache their API payload (see the `revalidate` option on
 * serverFetch). That window is worth keeping — the most-shared URLs on the
 * platform should not hit the API and the database on every view — but applied
 * blindly it means an organizer whose event was just approved watches a stale
 * page and concludes the product is broken.
 *
 * The 404 case is the worst of them: Next caches a MISS exactly like a hit, so
 * a brand-new event reads "not found" for the whole window after it goes live,
 * and the person refreshing is the one who just created it.
 *
 * So the backend says the moment a slug's data changes, and the tagged entry is
 * dropped immediately instead of ageing out.
 *
 * NOT PUBLICLY REACHABLE. nginx routes every /api/* path on the public
 * hostname to the backend on :5000, so this handler is only addressable over
 * loopback at 127.0.0.1:3000 — which is exactly how the backend calls it. The
 * shared secret is the second layer, for the day that routing changes or
 * something else on the box can reach the port.
 *
 * `REVALIDATE_SECRET` must hold the SAME value in frontend/.env and
 * backend/.env. It is deliberately absent from ecosystem.config.js, which is
 * committed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Route handlers are statically analysed by default; this one must run per
// request or it is evaluated once at build and never again.
export const dynamic = 'force-dynamic';

function secretMatches(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual THROWS on a length mismatch, and the throw would itself
  // leak the length through the error path. Compare lengths first, and keep the
  // comparison constant-time only for equal-length inputs.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request) {
  const expected = process.env.REVALIDATE_SECRET;

  // Fails closed. With no configured secret this endpoint would accept anything
  // that can reach the port, so it refuses to work at all instead.
  if (!expected) {
    return NextResponse.json(
      { revalidated: false, error: 'REVALIDATE_SECRET is not configured' },
      { status: 503 },
    );
  }

  if (!secretMatches(request.headers.get('x-revalidate-secret') || '', expected)) {
    return NextResponse.json({ revalidated: false, error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ revalidated: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const tags = Array.isArray(body?.tags)
    ? body.tags.filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 256)
    : [];

  if (tags.length === 0) {
    return NextResponse.json({ revalidated: false, error: 'No tags supplied' }, { status: 400 });
  }

  for (const tag of tags) revalidateTag(tag);

  return NextResponse.json({ revalidated: true, tags });
}
