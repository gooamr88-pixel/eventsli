'use client';

import { useApi } from '../../../../hooks/useApi';
import { formatPrice } from '../../../../utils/money';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { SectionHeader } from '../../../../components/ui/Page';
import NavIcon from '../../../../components/shell/NavIcon';
import { formatEventTime } from '../../../../lib/eventTime';
import { useEventContext } from '../EventContext';
import QrCard from './QrCard';
import LaunchKit from './LaunchKit';
import { ShareLinkCard, PrintTips } from './ShareSide';

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
  const full = useEventContext()?.event;

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (loading || !data) return <Loading variant="card" label="Loading share links" />;

  const { event, tiers } = data;
  const qrBase = `/events/${eventId}/share/qr.png`;

  const meta = full && (
    <>
      <span><NavIcon name="calendar" size={16} />{formatEventTime(full.startsAt, full.timezone)}</span>
      {full.venue?.name && <span><NavIcon name="pin" size={16} />{full.venue.name}</span>}
    </>
  );

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Share & QR"
        lede="Share your event, create promotional assets, and make check-in easy."
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

      <div className="es-sharegrid">
        <div className="fx-stack fx-min0">
          <QrCard
            title={event.title}
            subtitle="This QR code opens the public event page."
            url={event.url}
            qrPath={qrBase}
            filename={`${event.slug}-qr.png`}
            meta={meta}
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
              <div className="es-qrtiles">
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

        <aside className="fx-stack fx-min0">
          <ShareLinkCard url={event.url} title={event.title} />
          <PrintTips />
        </aside>
      </div>
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
