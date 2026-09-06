'use client';

import { useEffect, useState } from 'react';
import { get } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

/**
 * Every order, both channels.
 *
 * This endpoint exists because `/manual-sales` filters `channel = 'manual'` —
 * so until it was added an organizer could see the cash taken at the door and
 * NOTHING sold online, which is the wrong half.
 *
 * The totals in the header are for the WHOLE filtered set, computed in the
 * database, not for the twenty-five rows on screen. A footer that sums the page
 * and calls it revenue is worse than no footer, because it looks like an answer.
 */
const CHANNELS = [['', 'All'], ['stripe', 'Card'], ['manual', 'Door']];
const STATUSES = [['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['cancelled', 'Cancelled'], ['all', 'Any']];

export default function Orders({ eventId }) {
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('paid');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = new URLSearchParams({ status, limit: '50' });
      if (channel) query.set('channel', channel);
      if (search) query.set('q', search);

      try {
        const result = await get(`/events/${eventId}/orders?${query}`, {
          cache: 'no-store', raw: true,
        });
        if (!cancelled) {
          setRows(result.data || []);
          setMeta(result.meta || null);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, channel, status, search]);

  return (
    <div className="fx-stack">
      <h2 className="text-xl">Orders</h2>

      <Totals meta={meta} />

      <form
        onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}
        className="fx-row"
      >
        <Pills value={channel} onChange={setChannel} options={CHANNELS} label="Channel" />
        <Pills value={status} onChange={setStatus} options={STATUSES} label="Status" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email"
          aria-label="Search orders"
          className="fx-min0 flex-1 es-input"
        />
        <button type="submit" className="rounded-[--es-radius-md] border border-border-strong px-3 py-2 text-sm text-ink">
          Search
        </button>
      </form>

      {error ? (
        <ErrorNotice error={error} />
      ) : !rows ? (
        <Loading variant="list" />
      ) : rows.length === 0 ? (
        <div className="es-empty">
          <p className="text-muted">No orders match.</p>
        </div>
      ) : (
        /* Tables have unbounded min-content width — the sum of their columns —
           so this one scrolls in its own container rather than pushing the page
           sideways on a phone. */
        <div className="fx-scroll-x es-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border-base text-left">
                <Th>Buyer</Th><Th>Channel</Th><Th>Tickets</Th><Th right>Paid</Th><Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className="border-b border-border-base last:border-0">
                  <Td>
                    <span className="block text-ink">{order.buyer.name || '—'}</span>
                    <span className="block text-xs text-subtle">
                      {order.buyer.email || 'no email'}
                      {order.buyer.hasAccount && ' · account'}
                    </span>
                  </Td>
                  <Td>{order.channel === 'manual' ? 'Door' : 'Card'}</Td>
                  <Td>{order.tickets}</Td>
                  <Td right>{formatMoney(order.buyerPaidCents, order.currency)}</Td>
                  <Td>
                    {order.paidAt || order.createdAt
                      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' })
                        .format(new Date(order.paidAt || order.createdAt))
                      : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Grouped by currency, because that is how the API returns them. An event is
 * single-currency today; summing across currencies if that ever changed would
 * produce a number that is wrong rather than one that is missing.
 */
function Totals({ meta }) {
  if (!meta) return null;
  const entries = Object.entries(meta).filter(([, v]) => v && typeof v === 'object');
  if (entries.length === 0) return null;

  return (
    <div className="fx-grid fx-grid--3">
      {entries.map(([currency, t]) => (
        <div key={currency} className="fx-stack fx-stack--sm es-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.09em] text-subtle">
            {currency} · everything matching, not just this page
          </p>
          <p className="es-nums text-xl text-ink">
            {formatMoney(t.grossCents, currency)}
          </p>
          <p className="text-sm text-muted">
            {t.orders} {t.orders === 1 ? 'order' : 'orders'} · {t.tickets} tickets
          </p>
        </div>
      ))}
    </div>
  );
}

function Pills({ value, onChange, options, label }) {
  return (
    <div className="fx-row fx-row--scroll" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v || 'any'}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
            value === v ? 'border-accent bg-accent text-on-accent' : 'border-border-strong text-muted hover:text-ink'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const Th = ({ children, right }) => (
  <th className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.09em] text-subtle ${right ? 'text-right' : ''}`}>
    {children}
  </th>
);
const Td = ({ children, right }) => (
  <td className={`px-3 py-2 align-top text-muted ${right ? 'es-nums text-right text-ink' : ''}`}>
    {children}
  </td>
);
