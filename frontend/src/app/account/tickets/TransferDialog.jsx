'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '../../utils/apiClient';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';

/**
 * Give a ticket to someone else. BRD §10 — ONCE, and the organizer can disable
 * it for their event.
 *
 * The confirmation step is not ceremony. This is irreversible and it moves
 * something worth money to an address typed by hand: a transposed character
 * sends a concert ticket to a stranger, and there is no second transfer to fix
 * it with. So the address is shown back, in full, before anything happens.
 */
export default function TransferDialog({ ticket, event, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);

  // Escape closes; Tab is trapped. Without the trap, Tab walks out into the
  // ticket list behind the dialog, where a keyboard user then activates
  // controls they cannot see.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function transfer() {
    setBusy(true);
    setError(null);
    try {
      await post(`/tickets/${ticket.id}/transfer`, { toEmail: email.trim() }, {
        noRedirect: true,
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[--es-z-modal] grid place-items-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        className="fx-stack w-full max-w-sm es-card p-5 shadow-xl"
      >
        <div>
          <h2 id="transfer-title" className="text-lg">Give this ticket away</h2>
          <p className="mt-1 text-sm text-muted">
            {event?.title}
            {ticket.seat && ` · ${ticket.seat.section} seat ${ticket.seat.number}`}
            {ticket.table && ` · table ${ticket.table}`}
          </p>
        </div>

        {confirming ? (
          <div className="fx-stack fx-stack--sm">
            <p className="rounded-[--es-radius-md] bg-warning/10 px-3 py-2.5 text-sm text-muted">
              This ticket will move to <span className="text-ink">{email.trim()}</span> and
              stop working for you. <strong className="text-ink">It cannot be undone</strong>,
              and it cannot be transferred a second time.
            </p>
            <FormError error={error} />
            <div className="fx-row fx-row--between">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-sm text-muted hover:text-ink"
              >
                Change the address
              </button>
              <SubmitButton busy={busy} busyLabel="Transferring…" onClick={transfer} type="button">
                Yes, give it away
              </SubmitButton>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); setConfirming(true); }}
            className="fx-stack fx-stack--sm"
          >
            <Field
              // autoFocus rather than a ref: React 19 does pass `ref` through
              // to a function component, but Field spreads its rest props onto
              // the input, so this says the same thing with nothing to plumb.
              autoFocus
              label="Their email"
              type="email"
              name="toEmail"
              required
              autoComplete="off"
              hint="They will be emailed the ticket. You will both get a notice."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FormError error={error} />
            <div className="fx-row fx-row--between">
              <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">
                Cancel
              </button>
              <SubmitButton busy={false} disabled={email.trim().length < 5}>
                Continue
              </SubmitButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
