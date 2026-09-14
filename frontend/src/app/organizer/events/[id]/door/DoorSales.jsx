'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post } from '../../../../utils/apiClient';
import { formatMoney } from '../../../../utils/money';
import { useToast } from '../../../../components/ui/Toast';
import SeatMapCanvas from '../../../../components/seating/SeatMapCanvas';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import DataTable from '../../../../components/ui/DataTable';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Recording a sale taken outside the platform — cash at the door, a transfer.
 *
 * QUOTED BEFORE RECORDED, always: the quote returns what the buyer pays AND the
 * commission this creates, and the second number is the point — an organizer
 * taking cash is creating a debt to Eventsli in that moment.
 *
 * The seat map is the BUYER's component in its normal mode. Door staff pick real
 * seats out of real stock, so anything else would be a second implementation of
 * the one thing that must not have two.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const BLANK_BUYER = { buyerName: '', buyerEmail: '', method: 'cash', note: '' };

export default function DoorSales({ eventId }) {
  const event = useEventContext()?.event;
  const toast = useToast();
  const [map, setMap] = useState(null);
  const [sales, setSales] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reload, setReload] = useState(0);

  const [selectedSeats, setSelectedSeats] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [quote, setQuote] = useState(null);
  const [buyer, setBuyer] = useState(BLANK_BUYER);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const slug = event?.slug;

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [publicMap, list] = await Promise.all([
          get(`/public/events/${slug}/seat-map`, { cache: 'no-store', noRedirect: true }).catch(() => null),
          get(`/events/${eventId}/manual-sales?limit=25`, { cache: 'no-store' }),
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
  }, [eventId, slug, reload]);

  const selection = selectedTable ? { tableId: selectedTable.id } : { seatIds: selectedSeats.map((s) => s.id) };
  const hasSelection = Boolean(selectedTable) || selectedSeats.length > 0;

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
      const result = await post(`/events/${eventId}/manual-sales`, { ...selection, ...buyer }, { noRedirect: true });
      toast.success(
        `Recorded ${result.ticketCount} ${result.ticketCount === 1 ? 'ticket' : 'tickets'}. `
        + `${formatMoney(result.commissionOwedCents, event.currency)} added to what you owe.`,
        { title: 'Sale recorded' },
      );
      setSelectedSeats([]);
      setSelectedTable(null);
      setQuote(null);
      setBuyer(BLANK_BUYER);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <ErrorNotice error={loadError} />;
  if (!event || (!map && !sales)) return <Loading variant="card" label="Loading the door" />;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Sales at the door"
        lede="Record a ticket you sold yourself. The seat comes out of the same stock as an online sale, so it cannot be sold twice."
        actions={<Link href={`/organizer/events/${eventId}/commission`} className="es-btn es-btn--secondary es-btn--sm">What I owe</Link>}
      />

      {event.status !== 'published' && (
        <Notice tone="warning" title="This event is not on sale.">
          <p>Door sales can only be recorded against an event that is published.</p>
        </Notice>
      )}

      {map?.map ? (
        <div className="es-plate bg-surface p-3">
          <SeatMapCanvas
            className="h-[48vh] min-h-[320px]"
            tables={map.tables}
            seats={map.seats}
            purchaseMode={event.purchaseMode}
            selectedSeatIds={new Set(selectedSeats.map((s) => s.id))}
            selectedTableIds={new Set(selectedTable ? [selectedTable.id] : [])}
            onSelectSeat={(seat) => {
              setQuote(null);
              setSelectedTable(null);
              setSelectedSeats((c) => (c.some((s) => s.id === seat.id) ? c.filter((s) => s.id !== seat.id) : [...c, seat]));
            }}
            onSelectTable={(table) => {
              setQuote(null);
              setSelectedSeats([]);
              setSelectedTable((c) => (c?.id === table.id ? null : table));
            }}
          />
        </div>
      ) : (
        <Notice title="No seat map yet.">
          <p>Door sales pick seats from the map. <Link href={`/organizer/events/${eventId}/map`} className="text-accent">Build the map</Link> first.</p>
        </Notice>
      )}

      {hasSelection && (
        <Panel
          title={selectedTable ? `Table ${selectedTable.label}` : `${selectedSeats.length} ${selectedSeats.length === 1 ? 'seat' : 'seats'} chosen`}
          action={<button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => { setSelectedSeats([]); setSelectedTable(null); setQuote(null); }}>Clear</button>}
        >
          {quote ? (
            <>
              <dl className="fx-stack fx-stack--sm text-sm">
                <Line term="Buyer pays" value={formatMoney(quote.buyerPaysCents, quote.currency)} strong />
                <Line term="Tickets" value={formatMoney(quote.subtotalCents, quote.currency)} />
                {quote.eventTaxCents > 0 && <Line term="Tax" value={formatMoney(quote.eventTaxCents, quote.currency)} />}
                <Line
                  term="You will owe Eventsli"
                  value={formatMoney(quote.commissionOwedCents, quote.currency)}
                  note="Invoiced separately — this money never passes through us."
                  strong
                />
              </dl>

              <form onSubmit={record} className="fx-stack fx-stack--sm border-t border-border-base pt-4">
                <div className="fx-grid fx-grid--2">
                  <Field label="Who bought it" name="buyerName" required minLength={2} maxLength={120}
                    value={buyer.buyerName} onChange={(e) => setBuyer((b) => ({ ...b, buyerName: e.target.value }))} />
                  <Field label="Their email" type="email" name="buyerEmail" hint="Optional — without it they get no ticket by email."
                    value={buyer.buyerEmail} onChange={(e) => setBuyer((b) => ({ ...b, buyerEmail: e.target.value }))} />
                  <Field label="How they paid" name="method" required minLength={2} maxLength={60} hint="e.g. cash, e-transfer"
                    value={buyer.method} onChange={(e) => setBuyer((b) => ({ ...b, method: e.target.value }))} />
                  <Field label="Note" name="note" maxLength={500}
                    value={buyer.note} onChange={(e) => setBuyer((b) => ({ ...b, note: e.target.value }))} />
                </div>
                <FormError error={error} />
                <div>
                  <SubmitButton busy={busy === 'record'} busyLabel="Recording…">Record this sale</SubmitButton>
                </div>
              </form>
            </>
          ) : (
            <>
              <FormError error={error} />
              <div>
                <SubmitButton type="button" busy={busy === 'quote'} busyLabel="Working it out…" onClick={getQuote}>
                  Work out the price
                </SubmitButton>
              </div>
            </>
          )}
        </Panel>
      )}

      <section className="fx-stack fx-stack--sm">
        <h3 className="text-lg text-ink">Recorded so far</h3>
        {!sales?.length ? (
          <p className="text-sm text-muted">Nothing recorded at the door yet.</p>
        ) : (
          <DataTable
            caption="Door sales"
            rows={sales}
            columns={[
              { key: 'buyer', label: 'Buyer', primary: true, render: (s) => <span className="fx-break text-ink">{s.buyer?.name || 'No name given'}</span> },
              { key: 'seats', label: 'Tickets', align: 'end', render: (s) => <span className="es-nums">{s.seats}</span> },
              { key: 'method', label: 'Paid by', render: (s) => s.method },
              { key: 'paid', label: 'Paid', align: 'end', render: (s) => <span className="es-nums">{formatMoney(s.buyerPaidCents, s.currency)}</span> },
              { key: 'owed', label: 'Commission', align: 'end', render: (s) => <span className="es-nums text-muted">{formatMoney(s.commissionOwedCents, s.currency)}</span> },
              {
                key: 'when',
                label: 'When',
                render: (s) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s.recordedAt)),
              },
            ]}
          />
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
