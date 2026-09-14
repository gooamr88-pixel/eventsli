'use client';

import { useApi } from '../../../../hooks/useApi';
import { formatPrice } from '../../../../utils/money';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import QrCard from './QrCard';

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
  const { data, error, loading } = useApi(`/events/${eventId}/share`);

  if (error) return <ErrorNotice error={error} />;
  if (loading || !data) return <Loading variant="card" label="Loading share links" />;

  const { event, tiers } = data;
  const qrBase = `/events/${eventId}/share/qr.png`;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl text-ink">Share &amp; QR</h2>
        <p className="max-w-[62ch] text-muted">
          Links and QR codes for posters, social posts and the table at the door. The download is
          large enough to print.
        </p>
      </div>

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

      {tiers.length > 0 && (
        <section className="fx-stack fx-stack--sm">
          <div className="fx-stack fx-stack--sm gap-1">
            <h3 className="text-lg text-ink">Ticket types</h3>
            <p className="text-sm text-muted">
              Each link opens the event page with that ticket type picked out — useful for a VIP
              invitation or an early-bird post.
            </p>
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
