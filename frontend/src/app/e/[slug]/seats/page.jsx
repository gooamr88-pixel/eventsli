import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { serverFetch } from '../../../utils/apiClient';
import SeatPicker from './SeatPicker';
import SeatMapSkeleton from './SeatMapSkeleton';

/**
 * Seat selection.
 *
 * The header is server-rendered from the cached event payload; the MAP is not.
 * Seat availability changes as other people hold seats, so it is fetched fresh
 * by the client on mount and never cached at any layer. Rendering a cached map
 * would show a buyer seats that went ten seconds ago, let them pick one, and
 * refuse them at the hold — which is the same outcome as being slow, except it
 * wastes their time first.
 */
export const revalidate = 60;

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const event = await serverFetch(`/public/events/${encodeURIComponent(slug)}`, {
      tags: [`event:${slug}`], revalidate: 60,
    });
    return {
      title: `Choose your seats · ${event.title}`,
      // Not indexable: the canonical page for this event is /e/[slug], and a
      // seat picker in search results is a dead end for anyone who lands on it
      // from a query about the event itself.
      robots: { index: false, follow: true },
    };
  } catch {
    return { title: 'Choose your seats', robots: { index: false } };
  }
}

export default async function SeatsPage({ params, searchParams }) {
  const { slug } = await params;
  const { tier: tierParam } = (await searchParams) || {};

  let event;
  try {
    event = await serverFetch(`/public/events/${encodeURIComponent(slug)}`, {
      tags: [`event:${slug}`], revalidate: 60,
    });
  } catch (err) {
    if (err?.status === 404) notFound();
    throw err;
  }

  // BRD §12 — a listing with nothing behind it has no seat map to show, and
  // arriving here means a stale link rather than a mistake worth an error page.
  if (event.displayOnly) notFound();

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * A GENERAL-ADMISSION EVENT IS SENT TO THE TICKET PICKER — the other half of
   * a rule only `/tickets` was keeping.
   *
   * `/tickets` has always redirected a RESERVED event here, for the stated
   * reason that the link is a real one and the seat map is where the buyer was
   * trying to go. The reverse was never written, and general admission is the
   * direction that actually gets hit, because two screens link here with no
   * idea what kind of event it is:
   *
   *   · the payment-failure screen's "Try again" (checkout/Outcomes.jsx)
   *   · the same button on /checkout/success when Stripe reports not-paid
   *
   * So a general-admission buyer whose card was declined pressed the one
   * recovery button on the page and landed on "Choose your seats" above "This
   * event has no seat map yet" — a terminal dead end, at the exact moment they
   * were trying to give us money. `EventPurchasePanel`'s own note assumes this
   * redirect exists ("would send every buyer to a redirect"); it did not.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (event.admissionType === 'general') {
    redirect(`/e/${event.slug}/tickets${tierParam ? `?tier=${encodeURIComponent(String(tierParam))}` : ''}`);
  }

  return (
    <main className="fx-section fx-section--xs">
      <div className="fx-container fx-container--wide fx-stack">
        <div className="fx-stack fx-stack--sm">
          <Link href={`/e/${event.slug}`} className="text-sm text-muted hover:text-ink">
            ← {event.title}
          </Link>
          <h1 className="text-xl">Choose your seats</h1>
        </div>

        {/* `SeatPicker` reads `?tier=` and `?table=` with `useSearchParams`,
            so it needs a boundary like every other such component in the app.
            Without one this route's static rendering is opted out silently —
            today that is masked by the root layout's `force-dynamic`, which is
            a coincidence to rely on rather than a decision.

            The fallback is the map's own skeleton, in the same frame the map
            arrives in, so a boundary that does resolve late looks like the map
            loading rather than like a second, different placeholder. */}
        <Suspense fallback={<SeatMapSkeleton />}>
          <SeatPicker
            slug={event.slug}
            currency={event.currency}
            purchaseMode={event.purchaseMode}
            maxPerOrder={event.maxTicketsPerOrder}
          />
        </Suspense>
      </div>
    </main>
  );
}
