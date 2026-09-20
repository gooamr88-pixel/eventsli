import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { serverFetch } from '../../../utils/apiClient';
import TicketPicker from './TicketPicker';

/**
 * Choosing how many tickets, on a general-admission event.
 *
 * The counterpart to `/seats`, and the reason there are two pages rather than
 * one that branches: an event with a seat map is a picture you choose a place
 * on, and an event without one is a short list of numbers. Sharing a route
 * would mean a page that is two unrelated interfaces behind one `if`, and every
 * change to either would have to be checked against the other.
 *
 * A RESERVED EVENT THAT LANDS HERE IS REDIRECTED, not shown an error. The link
 * is a real one — an organizer may have shared it before switching the event —
 * and the seat map is where the buyer was trying to go.
 */
export const revalidate = 60;

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const event = await serverFetch(`/public/events/${encodeURIComponent(slug)}`, {
      tags: [`event:${slug}`], revalidate: 60,
    });
    return {
      title: `Tickets · ${event.title}`,
      // Not indexable: the canonical page for this event is /e/[slug], and a
      // bare ticket picker is a dead end for anyone landing on it from a query
      // about the event itself.
      robots: { index: false, follow: true },
    };
  } catch {
    return { title: 'Tickets', robots: { index: false } };
  }
}

export default async function TicketsPage({ params, searchParams }) {
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

  // BRD §12 — a listing with nothing behind it has no tickets to choose.
  if (event.displayOnly) notFound();
  if (event.admissionType !== 'general') {
    redirect(`/e/${event.slug}/seats${tierParam ? `?tier=${encodeURIComponent(String(tierParam))}` : ''}`);
  }

  return (
    <main className="fx-section fx-section--xs">
      <div className="fx-container fx-stack">
        <div className="fx-stack fx-stack--sm">
          {/* `.fx-hit` — the way OUT of the purchase step, and on a phone it
              was a ~20px line of text at the very top of the screen. The press
              area grows to the 44px floor; the link keeps its quiet weight,
              which is right for a back link sitting above an h1. */}
          <Link href={`/e/${event.slug}`} className="fx-hit text-sm text-muted hover:text-ink">
            ← {event.title}
          </Link>
          <h1 className="text-xl">How many tickets?</h1>
        </div>

        <TicketPicker slug={event.slug} focusTierId={typeof tierParam === 'string' ? tierParam : null} />
      </div>
    </main>
  );
}
