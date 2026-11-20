'use client';

import { useEffect, useId, useRef, useState } from 'react';
import NavIcon from '../../components/shell/NavIcon';
import SignaturePad from './SignaturePad';
import { signatureState, toPayload, MAX_TYPED } from './signatureModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Draw your signature" — the last step of the checkout (owner's reference,
 * 2026-11-15).
 *
 * The buyer ticks the three agreements, presses Pay, and signs here; the
 * signature goes to the API with the order and is kept beside the terms
 * acceptance it seals (backend/services/signatureService.js).
 *
 * TWO WAYS TO SIGN. Drawing is the reference's and the default. Typing is the
 * way in for anyone who cannot draw with a pointer — a keyboard, a switch, a
 * screen reader — as e-signature services offer it. Both are stored as what
 * they are.
 *
 * STAYS MOUNTED while the checkout is on screen and is shown and hidden with
 * the native `showModal()` / `close()`: a refused payment closes it, and a
 * buyer who comes back should find their signature still on the pad. The
 * native dialog also gives the focus trap, Escape, the inert page behind and
 * focus returned to Pay — none of it hand-rolled.
 *
 * The action button says what it does — "Pay CA$220.37", "Get my free
 * tickets" — and lights only once the API will accept the signature.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SignatureDialog({
  open, onClose, onSign, busy = false, error = null, actionLabel, busyLabel, free = false, defaultName = '',
  // What signing means, when it is not a checkout (a sponsorship agreement, 2026-11-20).
  legal = null,
}) {
  const ref = useRef(null);
  const titleId = useId();
  const hintId = useId();
  const typedId = useId();
  const [mode, setMode] = useState('draw');
  const [drawn, setDrawn] = useState(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // jsdom and some older engines have no showModal; the dialog still shows.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  const value = mode === 'draw' ? drawn : { method: 'typed', name: typed };
  const state = signatureState(value);
  const ready = state === 'ready';

  function chooseType() {
    setMode('type');
    // A head start: the name from the form, which the buyer can change.
    if (!typed && defaultName) setTyped(defaultName);
  }

  function clear() {
    if (mode === 'draw') setDrawn(null);
    else setTyped('');
  }

  function undo() {
    setDrawn((d) => (d && d.strokes.length > 1 ? { ...d, strokes: d.strokes.slice(0, -1) } : null));
  }

  function submit(e) {
    e.preventDefault();
    if (ready && !busy) onSign(toPayload(value));
  }

  const hint = mode === 'draw'
    ? state === 'small'
      ? 'Keep going — draw your full signature across the box.'
      : state === 'ready'
        ? 'Signed. Clear it to start again.'
        : 'Use your mouse, finger or a stylus to sign inside the box.'
    : state === 'small'
      ? `Type your full name (up to ${MAX_TYPED} characters).`
      : 'Your typed name is your signature.';

  return (
    <dialog
      ref={ref}
      className="es-dialog es-sign"
      aria-labelledby={titleId}
      // Escape: closed through the page, so its state and the dialog agree —
      // and not while the order is being placed.
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
    >
      <form onSubmit={submit} className="es-sign__form">
        <button type="button" className="es-sign__close" onClick={onClose} disabled={busy} aria-label="Close">
          <NavIcon name="close" size={20} />
        </button>

        <span className="es-sign__mark" aria-hidden="true"><NavIcon name="pencil" size={26} /></span>
        <h2 id={titleId} className="es-sign__title">{mode === 'draw' ? 'Draw your signature' : 'Type your signature'}</h2>

        <div className="es-sign__modes" role="group" aria-label="How to sign">
          <button type="button" aria-pressed={mode === 'draw'} onClick={() => setMode('draw')} disabled={busy}>Draw</button>
          <button type="button" aria-pressed={mode === 'type'} onClick={chooseType} disabled={busy}>Type</button>
        </div>

        {mode === 'draw' ? (
          <SignaturePad value={drawn} onChange={setDrawn} describedBy={hintId} />
        ) : (
          <div className="es-sign__typed">
            <label htmlFor={typedId} className="sr-only">Your full name</label>
            <input
              id={typedId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={MAX_TYPED}
              autoComplete="name"
              placeholder="Your full name"
              aria-describedby={hintId}
              className="es-input"
            />
            <p className="es-sign__preview" aria-hidden="true">{typed.trim() || 'Your signature'}</p>
          </div>
        )}

        <div className="es-sign__status">
          <p id={hintId} className={`es-sign__hint ${state === 'ready' ? 'es-sign__hint--ok' : ''}`} aria-live="polite">
            {state === 'ready' && <NavIcon name="tick" size={16} />}
            {hint}
          </p>
          {mode === 'draw' && drawn?.strokes?.length > 0 && (
            <button type="button" className="es-sign__undo" onClick={undo} disabled={busy}>
              <NavIcon name="undo" size={16} /> Undo
            </button>
          )}
        </div>

        <p className="es-sign__legal">
          {legal || <>By signing, you confirm the agreements you ticked and {free ? 'claim these tickets' : 'authorise this payment'}. Your signature is kept with your order.</>}
        </p>

        {error && (
          <p role="alert" className="es-sign__error">{error.message || 'That signature could not be used. Sign again.'}</p>
        )}

        <div className="es-sign__actions">
          <button type="button" className="es-sign__clear" onClick={clear} disabled={busy || state === 'empty'}>
            Clear signature
          </button>
          <button
            type="submit"
            className={`es-sign__go ${free ? 'es-sign__go--free' : ''}`}
            disabled={!ready || busy}
            aria-busy={busy || undefined}
          >
            {busy ? busyLabel : actionLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
