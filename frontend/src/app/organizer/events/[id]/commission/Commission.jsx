'use client';

import { useEffect, useState } from 'react';
import { get, post } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * What the organizer owes us, and what happens if they do not pay.
 *
 * THE TWO CHANNELS ANSWER DIFFERENT QUESTIONS, and the difference is the whole
 * design. On the card path the money passed through us and Stripe already took
 * our fee, so the position closes at zero — there is nothing to collect and
 * nothing here. On the manual path the money never came near us: the commission
 * is a RECEIVABLE, and a receivable that reads as zero is one nobody collects.
 *
 * So this page exists for door sales only, and it always shows the debt and its
 * consequence together (BRD §18). Discovering the second at the door, with a
 * queue outside, is the failure the layout is arranged to prevent.
 *
 * SUBMITTING PROOF DOES NOT REOPEN THE GATE. Reopening on the claim alone would
 * make the proof decorative — anyone could type a URL and scan. Only settlement
 * does, and settlement is an admin's act.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Commission({ eventId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await get(`/events/${eventId}/commission`, { cache: 'no-store' });
        if (!cancelled) { setData(result); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  if (error) return <p className="text-sm text-muted">{describeError(error).recovery}</p>;
  if (!data) return <p className="text-sm text-subtle">Loading…</p>;

  const locked = data.gate?.locked;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Commission on door sales</h2>
        <p className="max-w-[62ch] text-muted">
          Tickets you sold yourself — cash, transfer, anything outside the platform. The
          money never reached us, so our commission on those sales is invoiced to you.
          Card sales are already settled and do not appear here.
        </p>
      </div>

      {/* The debt and the consequence, in one place. */}
      <div className={`fx-row fx-row--between rounded-[--es-radius-lg] border p-5 ${
        locked ? 'border-danger/40 bg-danger/5' : 'border-border-base bg-surface'
      }`}
      >
        <div className="fx-min0">
          <p className="text-sm text-muted">Outstanding</p>
          <p className="es-nums text-2xl text-ink">
            {formatMoney(data.owedCents, data.currency)}
          </p>
        </div>
        <GateState gate={data.gate} />
      </div>

      {data.invoices.length === 0 ? (
        <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-8 text-center">
          <p className="text-muted">No invoices yet.</p>
          <p className="mt-1 text-sm text-subtle">
            One is raised once you have recorded door sales.
          </p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {data.invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              eventId={eventId}
              invoice={invoice}
              onChanged={() => setReload((n) => n + 1)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GateState({ gate }) {
  if (gate?.override) {
    // BRD §18 — a super admin can override, time-boxed. A permanent override is
    // a lock quietly removed, so it is shown as the temporary thing it is.
    return (
      <span className="whitespace-nowrap rounded-full bg-warning/15 px-3 py-1 text-sm text-warning">
        Scanning temporarily allowed
      </span>
    );
  }
  if (gate?.locked) {
    return (
      <span className="whitespace-nowrap rounded-full bg-danger/15 px-3 py-1 text-sm text-danger">
        Scanning is off
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded-full bg-success/15 px-3 py-1 text-sm text-success">
      Scanning works
    </span>
  );
}

function InvoiceRow({ eventId, invoice, onChanged }) {
  const [proofUrl, setProofUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const settled = invoice.status === 'paid' || invoice.status === 'waived';
  const awaitingReview = invoice.status === 'submitted' || submitted;

  async function submitProof(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/invoices/${invoice.id}/proof`, {
        proofUrl: proofUrl.trim(),
      }, { noRedirect: true });
      setSubmitted(true);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="text-ink">
            Invoice {invoice.number}
            <span className="text-muted"> · {invoice.orderCount} door sales</span>
          </p>
          <p className="text-sm text-muted">
            Due {when(invoice.dueAt)}
            {invoice.isOverdue && <span className="text-danger"> · overdue</span>}
          </p>
        </div>
        <div className="fx-row">
          <span className="es-nums whitespace-nowrap text-ink">
            {formatMoney(invoice.amountCents, invoice.currency)}
          </span>
          <StatusChip status={invoice.status} overdue={invoice.isOverdue} />
        </div>
      </div>

      {settled ? (
        <p className="text-sm text-muted">
          Settled {invoice.confirmedAt ? when(invoice.confirmedAt) : ''}. Nothing further to do.
        </p>
      ) : awaitingReview ? (
        <div className="rounded-[--es-radius-md] bg-info/10 px-3 py-2.5">
          <p className="text-sm text-ink">Proof received — we are checking it</p>
          {/* Said plainly, because the alternative is an organizer standing at a
              door believing the gate reopened. */}
          <p className="mt-1 text-sm text-muted">
            Scanning stays off until we confirm the transfer. It reopens by itself the
            moment we do — there is no separate unlock.
          </p>
        </div>
      ) : (
        <form onSubmit={submitProof} className="fx-stack fx-stack--sm">
          <p className="text-sm text-muted">
            Pay by bank transfer, then paste a link to the receipt.
          </p>
          <Field
            label="Link to your receipt"
            type="url"
            required
            placeholder="https://…"
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
          />
          <FormError error={error} />
          <SubmitButton busy={busy} busyLabel="Sending…" disabled={proofUrl.trim().length < 8}>
            Submit proof
          </SubmitButton>
        </form>
      )}
    </li>
  );
}

function StatusChip({ status, overdue }) {
  const [label, look] = overdue && ['open', 'submitted'].includes(status)
    ? ['Overdue', 'bg-danger/15 text-danger']
    : {
      open: ['Unpaid', 'bg-warning/15 text-warning'],
      submitted: ['In review', 'bg-info/15 text-info'],
      paid: ['Paid', 'bg-success/15 text-success'],
      waived: ['Waived', 'bg-bg-sunken text-muted'],
      overdue: ['Overdue', 'bg-danger/15 text-danger'],
    }[status] || [status, 'bg-bg-sunken text-muted'];

  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.09em] ${look}`}>
      {label}
    </span>
  );
}

function when(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}
