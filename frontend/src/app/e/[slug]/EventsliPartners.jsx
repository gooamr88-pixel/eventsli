import { serverFetch } from '../../utils/apiClient';
import PartnerCarousel from '../../components/landing/PartnerCarousel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EVENTSLI'S PARTNERS, ON EVERY EVENT PAGE (owner, 2026-11-10).
 *
 * The admin-published sponsors the homepage shows (Admin → Content →
 * Sponsors), in the same gliding tiles, in a card of their own near the foot
 * of the page.
 *
 * LABELLED AS EVENTSLI'S, never the event's. An event's own sponsors are the
 * organizer's ("Presented by", and the list in the Organizer tab); putting the
 * platform's logos beside them unlabelled would tell a buyer a brand backs an
 * event it has never heard of.
 *
 * Cached under the `landing` tag, which the admin console drops whenever a
 * sponsor is added, edited or removed — so a change shows here at once, not a
 * minute later. On any failure it renders nothing: partners are never worth an
 * error on the page that sells the ticket.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function loadPartners() {
  try {
    const data = await serverFetch('/public/sponsors', { tags: ['landing'], revalidate: 60 });
    return Array.isArray(data?.sponsors) ? data.sponsors.filter((s) => s.logoUrl) : [];
  } catch {
    return [];
  }
}

export default async function EventsliPartners() {
  const sponsors = await loadPartners();
  if (sponsors.length === 0) return null;
  return (
    <section className="es-ev-partners" aria-labelledby="eventsli-partners">
      <div className="es-ev-partners__head">
        <p className="es-ev-partners__eyebrow">Eventsli partners</p>
        <h2 id="eventsli-partners" className="es-ev-partners__title">Proudly supported by</h2>
        <p className="es-ev-partners__lede">The brands that power Eventsli and the events on it.</p>
      </div>
      <PartnerCarousel label="Eventsli partners" sponsors={sponsors} heading={false} variant="tiles" />
    </section>
  );
}
