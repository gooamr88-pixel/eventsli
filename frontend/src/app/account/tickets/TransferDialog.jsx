'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '../../utils/apiClient';
import { useModal } from '../../hooks/useModal';
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
  const warningRef = useRef(null);
  const emailRef = useRef(null);

  /**
   * THE ADDRESS FIELD, AND NOT VIA `autoFocus`.
   *
   * It was `autoFocus` on the `Field`, which React commits in the LAYOUT phase
   * — before `useModal`'s capture of where focus came from. The hook would
   * then have recorded this input as the opener and "restored" focus to it
   * after unmount, which does nothing at all. A passive effect runs after that
   * capture, so both work. `useModal` documents this as its one contract.
   */
  useEffect(() => { emailRef.current?.focus(); }, []);

  /**
   * Escape, the Tab trap, the scroll lock, and putting focus back on the row
   * this was opened from. See `useModal` — every one of those except the first
   * two was missing here.
   *
   * The trap matters more than usual on this dialog: without it Tab walks out
   * into the ticket list behind, where a keyboard user activates controls they
   * cannot see — including the Transfer button on a DIFFERENT ticket.
   *
   * Initial focus is left to `autoFocus` on the address field below; the hook
   * only steps in when a dialog has not placed focus itself.
   */
  useModal(dialogRef, onClose);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * THE SECOND STEP HAS TO TAKE FOCUS, because the first one's controls are
   * gone.
   *
   * Pressing Continue unmounts the form and renders the warning in its place.
   * The button that was focused no longer exists, so the browser drops focus to
   * `<body>` — on the one screen in the product that moves something worth
   * money to a hand-typed address, irreversibly. A screen reader user pressed
   * Continue, heard nothing at all, and had to Tab in from the top of the
   * document to find out that anything had happened, let alone what it said.
   *
   * The warning takes focus instead, so its text is what they hear. `tabIndex`
   * is -1: it is a focus TARGET, not a stop on the way through, and Tab from
   * here still goes to the two buttons under it.
   *
   * Guarded on `confirming` rather than running on mount, so it cannot fight
   * the address field's `autoFocus` on the way in.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (confirming) warningRef.current?.focus();
  }, [confirming]);

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
    // `.es-backdrop`, which is the one scrim and the one z-index for every
    // centred dialog in the product — see globals.css. It replaces a copied
    // utility string that drifted three ways across the three dialogs using it.
    <div
      className="es-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        className="es-backdrop__panel"
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
            <p
              ref={warningRef}
              tabIndex={-1}
              className="rounded-(--es-radius-md) bg-warning/10 px-3 py-2.5 text-sm text-muted"
            >
              This ticket will move to <span className="text-ink">{email.trim()}</span> and
              stop working for you. <strong className="text-ink">It cannot be undone</strong>,
              and it cannot be transferred a second time.
            </p>
            <FormError error={error} />
            <div className="fx-row fx-row--between">
              {/* The way BACK from an irreversible step, so it is a control
                  rather than a line of text — same 44px floor as the button
                  beside it. */}
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="es-btn es-btn--ghost"
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
              // `ref` rather than `autoFocus` — see the effect above. `Field`
              // spreads its rest props onto the input, so this lands on the
              // element without anything to plumb, the same way `autoFocus` did.
              ref={emailRef}
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
              <button type="button" onClick={onClose} className="es-btn es-btn--ghost">
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
