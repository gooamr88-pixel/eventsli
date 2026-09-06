import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch } from '../../../utils/apiClient';
import SeatPicker from './SeatPicker';

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

export default async function SeatsPage({ params }) {
  const { slug } = await params;

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

  return (
    <main className="fx-section fx-section--xs">
      <div className="fx-container fx-container--wide fx-stack">
        <div className="fx-stack fx-stack--sm">
          <Link href={`/e/${event.slug}`} className="text-sm text-muted hover:text-ink">
            ← {event.title}
          </Link>
          <h1 className="text-xl">Choose your seats</h1>
        </div>

        <SeatPicker
          slug={event.slug}
          currency={event.currency}
          purchaseMode={event.purchaseMode}
          maxPerOrder={event.maxTicketsPerOrder}
        />
      </div>
    </main>
  );
}
