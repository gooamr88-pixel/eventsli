'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { formatMoney } from '../../../utils/money';
import { parseMoneyToCents } from '../../../lib/moneyInput';
import { safeExternalUrl } from '../../../utils/safeUrl';
import { formatEventTime, toIso, toLocalInput } from '../../../lib/eventTime';
import { describeGate, gateModeLabel } from '../../../lib/gateState';
import { useApi } from '../../../hooks/useApi';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { PageHeader, Panel } from '../../../components/ui/Page';
import { Kpi, KpiRow } from '../../../components/ui/Kpi';
import DataTable from '../../../components/ui/DataTable';
import InvoiceStatus from '../../../components/ui/InvoiceStatus';
import { Loading, ErrorNotice, Notice } from '../../../components/Feedback';
import { HISTORY_LABELS } from './invoiceHistory';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COMMISSION INVOICE, AND EVERYTHING AN ADMIN CAN DO TO IT.
 *
 * Every button maps to one API action that is one database function: atomic,
 * written to the invoice's history, the audit log and — when money moves — the
 * ledger as a new row. Nothing is edited in place, so every balance on this
 * page can be explained line by line from the history below it.
 *
 * Which buttons appear comes from the API (`actions`), computed from the same
 * rules the database enforces, so nothing is offered that will be refused.
 *
 * The gate is shown beside the money because the person on this page is
 * usually on the phone to the organizer, and the question is "can we scan?".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function InvoiceDetail({ invoiceId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(`/admin/invoices/${invoiceId}`);
  const [busy, setBusy] = useState(null);

  if (error) return <ErrorNotice error={error} onRetry={reload} action={{ href: '/admin/invoices', label: 'All invoices' }} />;
  if (loading && !data) return <Loading variant="stats" rows={3} label="Loading the invoice" />;

  const { invoice, event, organizer, payments, history, gate, actions } = data;
  const tz = event?.timezone;
  const money = (cents) => formatMoney(cents, invoice.currency);

  /** Runs one action and says what happened, including to the door. */
  async function act(key, path, body, done) {
    setBusy(key);
    try {
      const result = await post(`/admin/invoices/${invoiceId}/${path}`, body, { noRedirect: true });
      const door = result?.gate ? describeGate(result.gate, { timezone: tz, audience: 'admin' }).title : null;
      toast.success([done, door ? `${door}.` : null, result?.organizerNotified ? 'The organizer has been emailed.' : null].filter(Boolean).join(' '),
        { title: invoice.number });
      reload();
      return true;
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function withReason(key, path, { title, body, confirmLabel, label, hint, tone, done }) {
    const answer = await confirm({
      title, body, confirmLabel, tone,
      reason: { label, minLength: 5, maxLength: 500, hint },
    });
    if (!answer) return;
    await act(key, path, { reason: answer.reason }, done);
  }

  async function settle() {
    const answer = await confirm({
      title: `Settle ${invoice.number}?`,
      body: <p>Records {money(invoice.balanceCents)} as received — the whole balance, as one payment — and closes the invoice.</p>,
      confirmLabel: 'Money received — settle it',
      reason: { label: 'Note for the record', minLength: 0, maxLength: 500, hint: 'Optional — e.g. the transfer reference.' },
    });
    if (!answer) return;
    await act('settle', 'settle', { note: answer.reason || undefined }, 'Settled.');
  }

  async function reverse(payment) {
    await withReason(`rev-${payment.id}`, `payments/${payment.id}/reverse`, {
      title: `Reverse the ${money(payment.amountCents)} payment?`,
      body: <p>For a payment entered by mistake, or one that bounced. It stays in the history as reversed, and the amount is owed again.</p>,
      confirmLabel: 'Reverse the payment',
      tone: 'danger',
      label: 'Why is it being reversed?',
      hint: 'The organizer is told.',
      done: 'Payment reversed.',
    });
  }

  const info = describeGate(gate, { timezone: tz, audience: 'admin' });

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Commission invoice"
        icon="receipt"
        title={invoice.number}
        lede={[event?.title, organizer?.name].filter(Boolean).join(' · ')}
        actions={<Link href="/admin/invoices" className="es-btn es-btn--ghost es-btn--sm">All invoices</Link>}
      />

      <KpiRow label="The money" tiles>
        <Kpi icon="receipt" label="Invoiced" value={money(invoice.amountCents)} note={`${invoice.orderCount} door ${invoice.orderCount === 1 ? 'sale' : 'sales'}`} />
        <Kpi icon="check" label="Paid" value={money(invoice.paidCents)} note={`${payments.filter((p) => !p.reversedAt).length} payment(s)`} iconTone="success" />
        {invoice.writtenOffCents > 0 && <Kpi icon="percent" label="Waived" value={money(invoice.writtenOffCents)} />}
        <Kpi
          icon="coins" label="To pay" value={money(invoice.balanceCents)} featured={invoice.balanceCents > 0}
          note={invoice.balanceCents > 0 ? `Due ${formatEventTime(invoice.dueAt, tz)}` : 'Nothing left to pay'}
          tone={invoice.isOverdue && invoice.balanceCents > 0 ? 'danger' : undefined}
        />
      </KpiRow>

      <div className="fx-grid fx-grid--2">
        <Panel icon="receipt" title="Status" action={<InvoiceStatus invoice={invoice} />}>
          <dl className="fx-stack fx-stack--sm text-sm">
            <Fact term="Issued" value={formatEventTime(invoice.issuedAt, tz)} />
            <Fact term="Due" value={formatEventTime(invoice.dueAt, tz)} />
            {invoice.originalDueAt && <Fact term="First due" value={formatEventTime(invoice.originalDueAt, tz)} />}
            {invoice.reminderSentAt && <Fact term="Reminder sent" value={formatEventTime(invoice.reminderSentAt, tz)} />}
            {invoice.proofSubmittedAt && <Fact term="Receipt sent" value={formatEventTime(invoice.proofSubmittedAt, tz)} />}
            {invoice.receiptRejectionReason && <Fact term="Receipt not accepted" value={invoice.receiptRejectionReason} />}
            {invoice.waiveReason && <Fact term="Waived because" value={invoice.waiveReason} />}
            {invoice.voidReason && <Fact term="Voided because" value={invoice.voidReason} />}
            {organizer?.email && <Fact term="Organizer" value={`${organizer.name} · ${organizer.email}`} />}
          </dl>
          {safeExternalUrl(invoice.proofUrl) && (
            <a href={safeExternalUrl(invoice.proofUrl)} target="_blank" rel="noreferrer noopener" className="es-btn es-btn--secondary es-btn--sm self-start">
              Open the receipt <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </Panel>

        <Panel icon="scan" title="Check-in gate" action={<span className="es-pill">{gateModeLabel(gate)}</span>}>
          <Notice tone={info.tone === 'success' ? 'info' : info.tone} title={info.title}>
            {info.detail && <p>{info.detail}</p>}
          </Notice>
          {event && (
            <Link href={`/admin/events/${event.id}`} className="text-sm text-accent">
              Control the gate on the event page
            </Link>
          )}
        </Panel>
      </div>

      <Panel icon="flag" title="Actions">
        <div className="fx-row flex-wrap">
          {actions.settle && (
            <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={busy !== null} onClick={settle}>
              Settle in full
            </button>
          )}
          {actions.rejectReceipt && (
            <button
              type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy !== null}
              onClick={() => withReason('reject', 'reject-receipt', {
                title: 'Turn down this receipt?',
                body: <p>The invoice goes back to unpaid, and the organizer is asked for another receipt.</p>,
                confirmLabel: 'Turn it down', label: 'What is wrong with it?', hint: 'The organizer reads this.',
                done: 'Receipt turned down.',
              })}
            >
              Turn down the receipt
            </button>
          )}
          {actions.waive && (
            <button
              type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy !== null}
              onClick={() => withReason('waive', 'waive', {
                title: `Waive ${money(invoice.balanceCents)}?`,
                body: <p>Forgives what is left. Recorded in the ledger as a write-off; it can be reopened later.</p>,
                confirmLabel: 'Waive it', label: 'Why is it being waived?', hint: 'The organizer is told.',
                done: 'Waived.',
              })}
            >
              Waive the balance
            </button>
          )}
          {actions.reopen && (
            <button
              type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy !== null}
              onClick={() => withReason('reopen', 'reopen', {
                title: 'Reopen this invoice?',
                body: <p>The waived {money(invoice.writtenOffCents)} is owed again, by the invoice&rsquo;s due date. Move the due date afterwards if they need time.</p>,
                confirmLabel: 'Reopen', label: 'Why is it being reopened?', hint: 'The organizer is told.',
                done: 'Reopened.',
              })}
            >
              Reopen
            </button>
          )}
          {actions.remind && (
            <button
              type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy !== null}
              onClick={async () => {
                if (await confirm({ title: 'Email a reminder now?', body: <p>The organizer gets the amount, the due date and how to pay.</p>, confirmLabel: 'Send the reminder' })) {
                  await act('remind', 'remind', {}, 'Reminder sent.');
                }
              }}
            >
              Send a reminder
            </button>
          )}
          {actions.void && (
            <button
              type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy !== null}
              onClick={() => withReason('void', 'void', {
                title: 'Void this invoice?',
                body: <p>For an invoice raised in error. Nothing is forgiven: the commission goes back to <em>Ready to invoice</em>, to be raised again correctly.</p>,
                confirmLabel: 'Void it', tone: 'danger', label: 'Why is it being voided?', hint: 'The organizer is told.',
                done: 'Voided.',
              })}
            >
              Void
            </button>
          )}
          {!Object.entries(actions).some(([k, v]) => v && k !== 'note' && k !== 'reversePayment') && (
            <p className="text-sm text-muted">This invoice is closed. A payment can still be reversed below if one was recorded in error.</p>
          )}
        </div>
      </Panel>

      <div className="fx-grid fx-grid--2">
        {actions.recordPayment && (
          <RecordPayment invoice={invoice} busy={busy !== null} onSubmit={(body) => act('pay', 'payments', body, 'Payment recorded.')} />
        )}
        {actions.changeDueDate && (
          <ChangeDueDate invoice={invoice} timezone={tz} busy={busy !== null} onSubmit={(body) => act('due', 'due-date', body, 'Due date changed.')} />
        )}
      </div>

      <Panel icon="coins" title="Payments">
        {payments.length === 0 ? (
          <p className="text-sm text-muted">No payments recorded.</p>
        ) : (
          <DataTable
            caption="Payments"
            rows={payments}
            columns={[
              {
                key: 'amount', label: 'Amount', primary: true,
                render: (p) => (
                  <span className={`es-nums ${p.reversedAt ? 'text-muted line-through' : 'text-ink'}`}>{money(p.amountCents)}</span>
                ),
              },
              { key: 'received', label: 'Received', render: (p) => formatEventTime(p.receivedAt, tz, { time: false }) },
              { key: 'method', label: 'How', render: (p) => [p.method, p.reference].filter(Boolean).join(' · ') },
              {
                key: 'by', label: 'Recorded', wide: true,
                render: (p) => (
                  <span className="fx-stack fx-stack--sm gap-0.5 text-sm">
                    <span>{[p.recordedBy, formatEventTime(p.recordedAt, tz)].filter(Boolean).join(' · ')}</span>
                    {p.note && <span className="text-muted">{p.note}</span>}
                    {p.reversedAt && <span className="text-danger">Reversed {formatEventTime(p.reversedAt, tz)} — {p.reversalReason}</span>}
                  </span>
                ),
              },
              {
                key: 'actions', label: 'Actions', hideLabel: true, align: 'end',
                render: (p) => (!p.reversedAt && actions.reversePayment ? (
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy !== null} onClick={() => reverse(p)}>
                    Reverse
                  </button>
                ) : null),
              },
            ]}
          />
        )}
      </Panel>

      <Panel icon="list" title="History">
        <ol className="fx-stack fx-stack--sm">
          {[...history].reverse().map((h) => (
            <li key={h.id} className="fx-stack gap-0.5 border-t border-border-base pt-2 text-sm first:border-0 first:pt-0">
              <span className="text-ink">
                {HISTORY_LABELS[h.kind] || h.kind}
                {h.amountCents !== null && h.kind !== 'note' ? ` · ${money(h.amountCents)}` : ''}
                {h.kind === 'due_changed' && h.detail?.to ? ` → ${formatEventTime(h.detail.to, tz)}` : ''}
              </span>
              {h.note && <span className="whitespace-pre-line text-muted">{h.note}</span>}
              <span className="text-xs text-subtle">
                {formatEventTime(h.at, tz)} · {h.actor || ({ system: 'Automatic', organizer: 'Organizer', admin: 'Admin' }[h.actorRole])}
              </span>
            </li>
          ))}
        </ol>
        <AddNote busy={busy !== null} onSubmit={(note) => act('note', 'notes', { note }, 'Note added.')} />
      </Panel>
    </div>
  );
}

function Fact({ term, value }) {
  return (
    <div className="fx-row fx-row--between gap-3">
      <dt className="text-muted">{term}</dt>
      <dd className="fx-break text-right text-ink">{value}</dd>
    </div>
  );
}

/** A payment as it arrived — partial is fine, more than is owed is refused. */
function RecordPayment({ invoice, busy, onSubmit }) {
  const [amount, setAmount] = useState((invoice.balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState('bank transfer');
  const [reference, setReference] = useState('');
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [receivedOn, setReceivedOn] = useState(today);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const cents = parseMoneyToCents(amount);
  const tooMuch = cents !== null && cents > invoice.balanceCents;

  async function submit(e) {
    e.preventDefault();
    if (cents === null || cents <= 0 || tooMuch) return;
    const ok = await onSubmit({
      amountCents: cents, method, reference: reference || undefined, note: note || undefined, notify,
      // Midday on the chosen day, so no zone can move it to the day before.
      receivedAt: receivedOn ? new Date(`${receivedOn}T12:00:00`).toISOString() : undefined,
    });
    if (ok) { setReference(''); setNote(''); }
  }

  return (
    <Panel icon="coins" title="Record a payment" description="What arrived, when, and the reference that matches the bank statement.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            Amount ({invoice.currency})
            <input className="es-input es-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            Received on
            <input type="date" className="es-input" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} />
          </label>
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            How
            <input className="es-input" list="payment-methods" value={method} maxLength={60} onChange={(e) => setMethod(e.target.value)} />
            <datalist id="payment-methods">
              <option value="bank transfer" />
              <option value="e-transfer" />
              <option value="wire" />
              <option value="cheque" />
              <option value="card" />
            </datalist>
          </label>
          <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
            Reference (optional)
            <input className="es-input" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
        <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
          Internal note (optional)
          <input className="es-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="fx-row items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-5 accent-[var(--es-accent)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the organizer a receipt
        </label>
        {cents === null && amount.trim() && <p className="text-xs text-danger">Enter an amount like 25 or 25.50.</p>}
        {tooMuch && <p className="text-xs text-danger">That is more than the {formatMoney(invoice.balanceCents, invoice.currency)} left to pay.</p>}
        <div>
          <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || cents === null || cents <= 0 || tooMuch}>
            Record {cents ? formatMoney(cents, invoice.currency) : 'payment'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/** A new due date, on the event's clock — the gate locks at that moment at the venue. */
function ChangeDueDate({ invoice, timezone, busy, onSubmit }) {
  const [due, setDue] = useState(() => toLocalInput(invoice.dueAt, timezone));
  const [reason, setReason] = useState('');
  // Fixed when the form opens: render must not read the clock.
  const [earliest] = useState(() => Date.now() + 3600e3);
  const iso = due ? toIso(due, timezone) : null;
  const tooSoon = iso && new Date(iso).getTime() < earliest;

  async function submit(e) {
    e.preventDefault();
    if (!iso || tooSoon || reason.trim().length < 5) return;
    const ok = await onSubmit({ dueAt: iso, reason: reason.trim() });
    if (ok) setReason('');
  }

  return (
    <Panel icon="calendar" title="Change the due date" description="More time, or a correction. The reminder and overdue notice follow the new date.">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
          New due date (event&rsquo;s local time)
          <input type="datetime-local" className="es-input" value={due} onChange={(e) => setDue(e.target.value)} required />
        </label>
        {tooSoon && <p className="text-xs text-danger">Choose a time at least an hour from now.</p>}
        <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
          Why
          <textarea className="es-input py-2" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The organizer is told." />
        </label>
        <div>
          <button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy || !iso || tooSoon || reason.trim().length < 5}>
            Change the due date
          </button>
        </div>
      </form>
    </Panel>
  );
}

function AddNote({ busy, onSubmit }) {
  const [note, setNote] = useState('');
  return (
    <form
      className="fx-stack fx-stack--sm border-t border-border-base pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (note.trim().length < 2) return;
        if (await onSubmit(note.trim())) setNote('');
      }}
    >
      <label className="fx-stack fx-stack--sm gap-1.5 text-sm text-ink">
        Internal note
        <textarea className="es-input py-2" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only admins see this." />
      </label>
      <div>
        <button type="submit" className="es-btn es-btn--ghost es-btn--sm" disabled={busy || note.trim().length < 2}>Add note</button>
      </div>
    </form>
  );
}
