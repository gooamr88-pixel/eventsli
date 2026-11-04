'use client';

import { useApi } from '../../../../hooks/useApi';
import { formatPrice } from '../../../../utils/money';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { SectionHeader } from '../../../../components/ui/Page';
import NavIcon from '../../../../components/shell/NavIcon';
import QrCard from './QrCard';
import LaunchKit from './LaunchKit';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Share & QR: the event page, and a deep link per ticket type — each with a QR
 * code, a copy button and a PNG download.
 *
 * Every URL shown here, and every URL inside every QR code, is built by the
 * SERVER from this event's slug and a ticket type it has checked belongs to the
 * event (see backend/services/shareLinks.js). This page only names which one it
 * wants. A client that could choose what a QR encodes could put any address on
 * a poster under this organizer's name.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SharePanel({ eventId }) {
  const { data, error, loading, reload } = useApi(`/events/${eventId}/share`);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (loading || !data) return <Loading variant="card" label="Loading share links" />;

  const { event, tiers } = data;
  const qrBase = `/events/${eventId}/share/qr.png`;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Share & QR"
        lede="Links and QR codes for posters, social posts and the table at the door. The download is large enough to print."
      />

      {/* An unpublished event answers with the same 404 as one that never
          existed, deliberately — so a code printed now would scan to "not
          found" until approval. Better said before the poster is printed. */}
      {!event.live && (
        <Notice tone="warning" title="These links do not open anything yet.">
          <p>
            The public page appears once the event is approved and on sale. You can prepare the codes
            now — they will not change when it goes live.
          </p>
        </Notice>
      )}

      <QrCard
        title="Event page"
        subtitle="Opens the public page for this event."
        url={event.url}
        qrPath={qrBase}
        filename={`${event.slug}-qr.png`}
        featured
      />

      <LaunchKit eventId={eventId} shareEvent={event} />

      {tiers.length > 0 && (
        <section className="es-dcard" aria-labelledby="share-tiers">
          <div className="es-ovcard__head">
            <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="ticket" size={22} /></span>
            <div className="fx-min0">
              <h2 id="share-tiers" className="es-dcard__title">Ticket type links</h2>
              <p className="es-ovcard__desc">
                Each opens the event page with that ticket type picked out — useful for a VIP
                invitation or an early-bird post.
              </p>
            </div>
          </div>
          <div className="fx-grid fx-grid--3">
            {tiers.map((tier) => (
              <QrCard
                key={tier.id}
                title={tier.name}
                subtitle={formatPrice(tier.priceCents, data.currency)}
                url={tier.url}
                qrPath={`${qrBase}?tier=${tier.id}`}
                filename={`${event.slug}-${fileSafe(tier.name)}-qr.png`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function fileSafe(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tickets';
}
