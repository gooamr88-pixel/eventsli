'use client';

import { useState } from 'react';
import { patch } from '../../../utils/apiClient';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import Field from '../../../components/forms/Field';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';

/**
 * The purchase rules an admin controls on any event (BRD §19): how many tickets
 * one order may hold (§11) and whether a ticket may be transferred (§10).
 *
 * Saved through the SAME event endpoint the organizer uses — the field-authority
 * map in eventRules.js decides who may write what, and a second endpoint would
 * be a second map to keep in step.
 *
 * An admin is changing someone else's event without asking them, so saving
 * asks for a reason; the API records it with the old and new values.
 */
export default function EventRules({ event, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({
    maxTicketsPerOrder: String(event.rules.maxTicketsPerOrder),
    allowTicketTransfer: event.rules.allowTicketTransfer,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The event reloaded after a save elsewhere on the page: take its values.
  const [lastEvent, setLastEvent] = useState(event);
  if (event !== lastEvent) {
    setLastEvent(event);
    setForm({
      maxTicketsPerOrder: String(event.rules.maxTicketsPerOrder),
      allowTicketTransfer: event.rules.allowTicketTransfer,
    });
  }

  const finished = ['cancelled', 'completed'].includes(event.status);
  const changed = Number(form.maxTicketsPerOrder) !== event.rules.maxTicketsPerOrder
    || form.allowTicketTransfer !== event.rules.allowTicketTransfer;

  async function save(e) {
    e.preventDefault();
    const answer = await confirm({
      title: 'Change the purchase rules?',
      body: <p>Buyers see the new rules straight away. The organizer is not asked first, so the reason is kept in the audit log.</p>,
      confirmLabel: 'Save rules',
      reason: { label: 'Why are the rules changing?', minLength: 5, maxLength: 1000 },
    });
    if (!answer) return;

    setBusy(true);
    setError(null);
    try {
      await patch(`/events/${event.id}`, {
        maxTicketsPerOrder: Number(form.maxTicketsPerOrder),
        allowTicketTransfer: form.allowTicketTransfer,
        reason: answer.reason,
      }, { noRedirect: true });
      toast.success('Purchase rules saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Purchase rules">
      {finished ? (
        <p className="text-sm text-muted">A {event.status} event cannot be edited.</p>
      ) : (
        <form onSubmit={save} className="fx-stack fx-stack--sm">
          <Field
            label="Tickets per order"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            required
            value={form.maxTicketsPerOrder}
            onChange={(e) => setForm((f) => ({ ...f, maxTicketsPerOrder: e.target.value }))}
            hint="Between 1 and 100. The default is 10."
          />
          <label className="fx-row text-sm text-ink">
            <input
              type="checkbox"
              className="size-5 accent-[var(--es-accent)]"
              checked={form.allowTicketTransfer}
              onChange={(e) => setForm((f) => ({ ...f, allowTicketTransfer: e.target.checked }))}
            />
            Buyers may transfer a ticket, once
          </label>
          <FormError error={error} />
          <div>
            <SubmitButton busy={busy} busyLabel="Saving…" disabled={!changed}>Save rules</SubmitButton>
          </div>
        </form>
      )}
    </Panel>
  );
}
