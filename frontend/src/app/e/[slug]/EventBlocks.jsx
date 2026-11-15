'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import NavIcon from '../../components/shell/NavIcon';
import { get } from '../../utils/apiClient';
import { formatPrice } from '../../utils/money';
import { buildModel } from './blocksModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Blocks and prices — the seat map's front door (owner's reference, 2026-11-15).
 *
 * Above: every price on the map as a coloured chip, plus "Sold out" and "Not
 * available", and the per-order ticket limit. Below: the blocks down the left,
 * each with what it costs or why it cannot be bought, and on the right the
 * venue's picture with BOOK TICKET over it. Every block and the button open
 * the seat page, where the buyer picks the exact seats.
 *
 * THE SAME FACTS AS THE SEAT PAGE: the same endpoint, the same colour per
 * ticket type (`tierPalette`), the same `available` flag per seat. A block is a
 * Venue Studio section; a map drawn without sections falls back to its tables,
 * so every reserved event gets a list.
 *
 * A failure here hides the section and nothing else — the ticket card above
 * already offers the same seat page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SOLD = 'var(--es-grey-500)';
const NONE = 'var(--es-grey-300)';

export default function EventBlocks({ event }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await get(`/public/events/${encodeURIComponent(event.slug)}/seat-map`, { noRedirect: true, cache: 'no-store' });
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [event.slug]);

  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  return <BlocksView event={event} model={model} failed={failed || Boolean(data && (!model || model.blocks.length === 0))} />;
}

/** What the section draws, given the model (`null` while it loads). */
export function BlocksView({ event, model, failed = false }) {
  const seatsHref = `/e/${event.slug}/seats`;
  const limit = Number(event.maxTicketsPerOrder) > 0 ? Number(event.maxTicketsPerOrder) : null;

  if (failed) return limit ? <LimitBadge limit={limit} /> : null;

  return (
    <section className="es-evx-blocks" aria-labelledby="event-blocks-title">
      <h2 id="event-blocks-title" className="sr-only">Blocks and prices</h2>

      <div className="es-evx-blocks__top">
        {limit && <LimitBadge limit={limit} />}
        <ul className="es-evx-legend" aria-label="Prices">
          {(model?.legend || []).map((item) => (
            <li key={item.key} className="es-evx-legend__item">
              <span className="es-evx-swatch" style={{ background: item.color }} aria-hidden />
              {formatPrice(item.cents, event.currency)}
            </li>
          ))}
          <li className="es-evx-legend__item"><span className="es-evx-swatch" style={{ background: SOLD }} aria-hidden />Sold out</li>
          <li className="es-evx-legend__item"><span className="es-evx-swatch" style={{ background: NONE }} aria-hidden />Not available</li>
        </ul>
      </div>

      <div className="es-evx-blocks__body">
        <aside className="es-evx-blocklist">
          <div className="es-evx-blocklist__head">
            <p className="es-evx-blocklist__title">Blocks and prices</p>
            <p className="es-evx-blocklist__hint">Tap a block to open it on the map.</p>
          </div>
          {!model ? (
            <ul className="es-evx-blocklist__list" aria-busy="true">
              {[0, 1, 2, 3].map((n) => <li key={n} className="es-skeleton es-evx-block es-evx-block--ghost" />)}
            </ul>
          ) : (
            <ul className="es-evx-blocklist__list">
              {model.blocks.map((block) => (
                <li key={block.key}>
                  <Link href={seatsHref} className={`es-evx-block ${block.prices.length ? '' : 'is-out'}`}>
                    <span className="es-evx-block__name">{block.name}</span>
                    {block.prices.length > 0 ? (
                      block.prices.map((p) => (
                        <span key={p.key} className="es-evx-block__row">
                          <span className="es-evx-swatch" style={{ background: p.color }} aria-hidden />
                          {formatPrice(p.cents, event.currency)}
                        </span>
                      ))
                    ) : (
                      <span className="es-evx-block__row">
                        <span className="es-evx-swatch" style={{ background: block.soldOut ? SOLD : NONE }} aria-hidden />
                        {block.soldOut ? 'Sold out' : 'Not available'}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="es-evx-stage">
          {(model?.picture || event.coverUrl) && (
            // eslint-disable-next-line @next/next/no-img-element -- the venue photo or the poster, straight from storage
            <img src={model?.picture || event.coverUrl} alt="" className="es-evx-stage__img" decoding="async" />
          )}
          <span className="es-evx-stage__veil" aria-hidden />
          <Link href={seatsHref} className="es-evx-stage__btn">
            Book ticket
            <NavIcon name="arrow" size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function LimitBadge({ limit }) {
  return (
    <p className="es-evx-limit">
      <NavIcon name="ticket" size={18} />
      Ticket limit: maximum of {limit} tickets per transaction
    </p>
  );
}
