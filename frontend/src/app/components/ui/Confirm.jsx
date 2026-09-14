'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Are you sure?" — as a promise.
 *
 *   const confirm = useConfirm();
 *   const answer = await confirm({ title, body, confirmLabel, tone: 'danger',
 *                                  reason: { label, minLength: 10 } });
 *   if (!answer) return;               // cancelled
 *   post(path, { reason: answer.reason });
 *
 * Fancy's `useConfirm` pattern, rebuilt on the native <dialog>. The native
 * element is the reason this is short: it traps focus, closes on Escape, puts
 * everything behind it out of reach and restores focus afterwards, in every
 * current browser. A hand-rolled modal gets at least one of those wrong.
 *
 * `reason` exists because every destructive admin action in this API REQUIRES
 * one — it goes into the audit log — and asking for it is also the confirm step.
 * A confirm button that stays disabled until the reason is long enough means the
 * API's 400 is never the way somebody finds out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    setRequest({ options, resolve });
  }), []);

  const settle = useCallback((value) => {
    setRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog {...request.options} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

// Without a provider nothing can be confirmed, so nothing destructive proceeds.
const REFUSE = () => Promise.resolve(null);

export function useConfirm() {
  return useContext(ConfirmContext) || REFUSE;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  reason = null,
  onSettle,
}) {
  const ref = useRef(null);
  const titleId = useId();
  const reasonId = useId();
  const [text, setText] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    // jsdom and some older engines have no showModal; the dialog still renders.
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => { if (dialog.open && typeof dialog.close === 'function') dialog.close(); };
  }, []);

  const min = reason?.minLength || 0;
  const ready = !reason || text.trim().length >= min;

  function submit(e) {
    e.preventDefault();
    if (ready) onSettle({ reason: text.trim() });
  }

  return (
    <dialog
      ref={ref}
      className="es-dialog"
      aria-labelledby={titleId}
      // Escape: the native dialog would close itself and leave the promise
      // hanging. Settled as a cancel instead.
      onCancel={(e) => { e.preventDefault(); onSettle(null); }}
    >
      <form onSubmit={submit}>
        <div className="es-dialog__body">
          <h2 id={titleId} className="text-lg text-ink">{title}</h2>
          {body && <div className="fx-stack fx-stack--sm text-sm text-muted">{body}</div>}

          {reason && (
            <div className="fx-stack fx-stack--sm gap-1.5">
              <label htmlFor={reasonId} className="text-sm text-ink">{reason.label}</label>
              <textarea
                id={reasonId}
                rows={3}
                className="es-input py-2"
                value={text}
                onChange={(e) => setText(e.target.value)}
                minLength={min || undefined}
                maxLength={reason.maxLength || 1000}
                required={min > 0}
                autoFocus
              />
              <p className="text-xs text-subtle">
                {reason.hint || 'Kept in the audit log.'}
                {min > 0 && text.trim().length < min && ` At least ${min} characters.`}
              </p>
            </div>
          )}
        </div>

        <div className="es-dialog__actions">
          <button type="button" className="es-btn es-btn--secondary" onClick={() => onSettle(null)}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`es-btn ${tone === 'danger' ? 'es-btn--danger' : 'es-btn--primary'}`}
            disabled={!ready}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
