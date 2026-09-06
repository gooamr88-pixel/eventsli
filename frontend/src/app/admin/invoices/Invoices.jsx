'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { formatMoney } from '../../utils/money';
import FormError from '../../components/forms/FormError';

/**
 * Commission invoices, across every event.
 *
 * Settling one is the act that reopens that event's gate — there is no separate
 * unlock, because a settlement you can forget to act on is a settlement that
 * leaves a door shut. The API reports `gateReopened` and this screen says so,
 * since the person clicking it is usually on the phone to the organizer.
 *
 * Proof is EVIDENCE, not authority: an invoice in `submitted` has a claim
 * attached and is still unpaid. The link opens in a new tab because checking it
 * is the whole job.
 */
export default function Invoices() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = new URLSearchParams({ limit: '50' });
      if (status) query.set('status', status);
      try {
        const data = await get(`/admin/invoices?${query}`, { cache: 'no-store' });
        if (!cancelled) { setRows(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [status, reload]);

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Commission invoices</h2>
        <p className="max-w-[62ch] text-muted">
          Raised against door sales only. Card sales settle themselves — the money passed
          through us and the fee was already taken.
        </p>
      </div>

      <div className="fx-row fx-row--scroll" role="group" aria-label="Status">
        {[['', 'All'], ['open', 'Unpaid'], ['submitted', 'Proof in'], ['paid', 'Settled']].map(([v, l]) => (
          <button
            key={v || 'all'}
            type="button"
            onClick={() => setStatus(v)}
            aria-pressed={status === v}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
              status === v ? 'border-accent bg-accent text-on-accent' : 'border-border-strong text-muted hover:text-ink'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-muted">{describeError(error).recovery}</p>
      ) : !rows ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-8 text-center">
          <p className="text-muted">Nothing here.</p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {rows.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} onChanged={() => setReload((n) => n + 1)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InvoiceRow({ invoice, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const settled = ['paid', 'waived'].includes(invoice.status);

  async function settle() {
    setBusy(true);
    setError(null);
    try {
      const data = await post(`/admin/invoices/${invoice.id}/settle`, {
        note: note.trim() || undefined,
      }, { noRedirect: true });
      setResult(data);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="fx-break text-ink">{invoice.event?.title || 'Event'}</p>
          <p className="text-sm text-muted">
            {invoice.organizer?.name} · {invoice.number} · {invoice.orderCount} door sales
          </p>
          <p className="text-xs text-subtle">
            Due {when(invoice.dueAt)}
            {invoice.isOverdue && <span className="text-danger"> · overdue, gate is shut</span>}
          </p>
        </div>
        <p className="es-nums whitespace-nowrap text-ink">
          {formatMoney(invoice.amountCents, invoice.currency)}
        </p>
      </div>

      {invoice.proofUrl && (
        <a
          href={invoice.proofUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm text-accent"
        >
          Open the receipt they submitted →
        </a>
      )}

      {result && (
        <p className="rounded-[--es-radius-md] bg-success/10 px-3 py-2 text-sm text-muted">
          Settled.{' '}
          {result.gateReopened
            ? 'Scanning is back on for that event — nothing else to do.'
            : 'Something else is still outstanding, so scanning stays off.'}
        </p>
      )}

      <FormError error={error} />

      {!settled && !result && (
        confirming ? (
          <div className="fx-stack fx-stack--sm rounded-[--es-radius-md] bg-bg-sunken p-3">
            <p className="text-sm text-ink">Confirm you have received the money?</p>
            <p className="text-sm text-muted">
              This marks it paid and reopens that event&apos;s gate. Check the receipt
              first — submitting proof did not reopen anything on its own.
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the audit log"
              aria-label="Settlement note"
              className="rounded-[--es-radius-md] border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle"
            />
            <div className="fx-row fx-row--between">
              <button type="button" onClick={() => setConfirming(false)} className="text-sm text-muted hover:text-ink">
                Not yet
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={settle}
                className="rounded-[--es-radius-md] bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-40"
              >
                {busy ? 'Settling…' : 'Money received — settle it'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="self-start rounded-[--es-radius-md] border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-bg-sunken"
          >
            Settle
          </button>
        )
      )}
    </li>
  );
}

function when(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}
