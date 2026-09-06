'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import SeatMapCanvas from '../../../../components/seating/SeatMapCanvas';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Recording a sale taken outside the platform — cash at the door, a transfer.
 *
 * QUOTED BEFORE RECORDED, always. `POST …/manual-sales/quote` returns what the
 * buyer pays AND the commission this creates, and the second number is the
 * point: an organizer taking cash is creating a debt to us in that moment, and
 * they should see it then rather than a week later on an invoice they did not
 * expect.
 *
 * The seat map here is the BUYER's component in its normal mode. Door staff are
 * picking real seats out of real stock, so anything else would be a second
 * implementation of the one thing that must not have two.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function DoorSales({ eventId }) {
  const [event, setEvent] = useState(null);
  const [map, setMap] = useState(null);
  const [sales, setSales] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reload, setReload] = useState(0);

  const [selectedSeats, setSelectedSeats] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [quote, setQuote] = useState(null);
  const [buyer, setBuyer] = useState({ buyerName: '', buyerEmail: '', method: 'cash', note: '' });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ev = await get(`/events/${eventId}`, { cache: 'no-store' });
        if (cancelled) return;
        setEvent(ev);

        const [publicMap, list] = await Promise.all([
          get(`/public/events/${ev.slug}/seat-map`, { cache: 'no-store', noRedirect: true })
            .catch(() => null),
          get(`/events/${eventId}/manual-sales?limit=25`, { cache: 'no-store' }).catch(() => []),
        ]);
        if (cancelled) return;
        setMap(publicMap);
        setSales(Array.isArray(list) ? list : []);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  const selection = selectedTable
    ? { tableId: selectedTable.id }
    : { seatIds: selectedSeats.map((s) => s.id) };
  const hasSelection = selectedTable || selectedSeats.length > 0;

  async function getQuote() {
    setBusy('quote');
    setError(null);
    try {
      setQuote(await post(`/events/${eventId}/manual-sales/quote`, selection, { noRedirect: true }));
    } catch (err) {
      setError(err);
      setQuote(null);
    } finally {
      setBusy(null);
    }
  }

  async function record(e) {
    e.preventDefault();
    setBusy('record');
    setError(null);
    try {
      const result = await post(`/events/${eventId}/manual-sales`, {
        ...selection, ...buyer,
      }, { noRedirect: true });
      setDone(result);
      setSelectedSeats([]);
      setSelectedTable(null);
      setQuote(null);
      setBuyer({ buyerName: '', buyerEmail: '', method: 'cash', note: '' });
      setReload((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <p className="text-sm text-muted">{describeError(loadError).recovery}</p>;
  if (!event) return <p className="text-sm text-subtle">Loading…</p>;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Sales at the door</h2>
        <p className="max-w-[62ch] text-muted">
          Record a ticket you sold yourself. The seat comes out of the same stock as an
          online sale, so it cannot be sold twice.
        </p>
      </div>

      {done && (
        <div className="rounded-[--es-radius-md] bg-success/10 px-4 py-3">
          <p className="text-sm text-ink">
            Recorded — {done.ticketCount} {done.ticketCount === 1 ? 'ticket' : 'tickets'}.
          </p>
          <p className="mt-1 text-sm text-muted">
            Commission of {formatMoney(done.commissionOwedCents, event.currency)} added to
            what you owe. <Link href={`/organizer/events/${eventId}/commission`} className="text-accent">
              See your invoices
            </Link>.
          </p>
        </div>
      )}

      {map?.map ? (
        <SeatMapCanvas
          className="h-[42vh] min-h-[300px]"
          tables={map.tables}
          seats={map.seats}
          purchaseMode={event.purchaseMode}
          selectedSeatIds={new Set(selectedSeats.map((s) => s.id))}
          selectedTableIds={new Set(selectedTable ? [selectedTable.id] : [])}
          onSelectSeat={(seat) => {
            setQuote(null);
            setSelectedTable(null);
            setSelectedSeats((c) => (c.some((s) => s.id === seat.id)
              ? c.filter((s) => s.id !== seat.id)
              : [...c, seat]));
          }}
          onSelectTable={(table) => {
            setQuote(null);
            setSelectedSeats([]);
            setSelectedTable((c) => (c?.id === table.id ? null : table));
          }}
        />
      ) : (
        <p className="rounded-[--es-radius-md] bg-bg-sunken px-4 py-3 text-sm text-muted">
          This event has no seat map, so there is nothing to sell from here.
        </p>
      )}

      {hasSelection && (
        <div className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-5">
          <p className="text-sm text-ink">
            {selectedTable
              ? `Table ${selectedTable.label}`
              : `${selectedSeats.length} ${selectedSeats.length === 1 ? 'seat' : 'seats'}`}
          </p>

          {quote ? (
            <>
              <dl className="fx-stack fx-stack--sm text-sm">
                <Line term="Buyer pays" value={formatMoney(quote.buyerPaysCents, quote.currency)} strong />
                <Line term="Tickets" value={formatMoney(quote.subtotalCents, quote.currency)} />
                {quote.eventTaxCents > 0 && (
                  <Line term="Tax" value={formatMoney(quote.eventTaxCents, quote.currency)} />
                )}
                {/* The number that makes this page worth having. */}
                <Line
                  term="You will owe us"
                  value={formatMoney(quote.commissionOwedCents, quote.currency)}
                  note="Invoiced separately. The money never passes through us on this route."
                  strong
                />
              </dl>

              <form onSubmit={record} className="fx-stack fx-stack--sm border-t border-border-base pt-4">
                <Field
                  label="Who bought it" name="buyerName" required minLength={2} maxLength={120}
                  value={buyer.buyerName}
                  onChange={(e) => setBuyer((b) => ({ ...b, buyerName: e.target.value }))}
                />
                <Field
                  label="Their email" type="email" name="buyerEmail"
                  hint="Optional — but without it they get no ticket by email."
                  value={buyer.buyerEmail}
                  onChange={(e) => setBuyer((b) => ({ ...b, buyerEmail: e.target.value }))}
                />
                <Field
                  label="How they paid" name="method" required minLength={2} maxLength={60}
                  hint="e.g. cash, e-transfer"
                  value={buyer.method}
                  onChange={(e) => setBuyer((b) => ({ ...b, method: e.target.value }))}
                />
                <Field
                  label="Note" name="note" maxLength={500}
                  value={buyer.note}
                  onChange={(e) => setBuyer((b) => ({ ...b, note: e.target.value }))}
                />

                <FormError error={error} />

                <SubmitButton busy={busy === 'record'} busyLabel="Recording…">
                  Record this sale
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <FormError error={error} />
              <SubmitButton
                type="button" busy={busy === 'quote'} busyLabel="Working it out…"
                onClick={getQuote}
              >
                Work out the price
              </SubmitButton>
            </>
          )}
        </div>
      )}

      <section className="fx-stack fx-stack--sm">
        <h3 className="text-lg">Recorded so far</h3>
        {!sales ? (
          <p className="text-sm text-subtle">Loading…</p>
        ) : sales.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="fx-stack fx-stack--sm">
            {sales.map((sale) => (
              <li key={sale.id} className="fx-row fx-row--between rounded-[--es-radius-md] border border-border-base bg-surface p-3">
                <div className="fx-min0">
                  <p className="fx-truncate text-sm text-ink">{sale.buyer.name || 'Unnamed'}</p>
                  <p className="text-xs text-subtle">
                    {sale.seats} × · {sale.method} · {new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'medium', timeStyle: 'short',
                    }).format(new Date(sale.recordedAt))}
                  </p>
                </div>
                <div className="text-right">
                  <p className="es-nums text-sm text-ink">
                    {formatMoney(sale.buyerPaidCents, sale.currency)}
                  </p>
                  <p className="es-nums text-xs text-subtle">
                    owe {formatMoney(sale.commissionOwedCents, sale.currency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Line({ term, value, note, strong }) {
  return (
    <div className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
      <dt className="fx-min0">
        <span className={strong ? 'text-ink' : 'text-muted'}>{term}</span>
        {note && <span className="block text-xs text-subtle">{note}</span>}
      </dt>
      <dd className={`es-nums whitespace-nowrap ${strong ? 'text-ink' : 'text-muted'}`}>{value}</dd>
    </div>
  );
}
