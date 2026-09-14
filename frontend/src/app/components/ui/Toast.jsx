'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "It worked" — said once, briefly, where the eye already is.
 *
 * The dashboard had no way to say that. A save either re-rendered silently or
 * left a sentence in the page that stayed there until the next navigation, so
 * an organizer who changed a price twice could not tell whether the second
 * change had landed.
 *
 * Failures that need action still belong IN the page, next to the thing that
 * failed (FormError). A toast is for confirmations and for failures of actions
 * that have no form to attach to.
 *
 * Each toast carries its own role: `status` waits its turn; `alert` interrupts,
 * which is right for a failure and noise for a success.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ToastContext = createContext(null);
const MAX_VISIBLE = 4;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, { tone = 'success', title = null, duration = 5000 } = {}) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), { id, message, tone, title }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    show,
    dismiss,
    success: (message, options) => show(message, { ...options, tone: 'success' }),
    // Longer on screen: a failure is more likely to need reading twice.
    error: (message, options) => show(message, { duration: 9000, ...options, tone: 'danger' }),
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="es-toast-region" aria-label="Notifications">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`es-toast ${t.tone === 'danger' ? 'es-toast--danger' : ''}`}
            role={t.tone === 'danger' ? 'alert' : 'status'}
          >
            <div className="fx-min0 flex-1">
              {t.title && <p className="font-medium text-ink">{t.title}</p>}
              <p className="text-muted">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="fx-touch--icon -my-2 -mr-2 text-muted hover:text-ink"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const NO_OP = Object.freeze({
  show: () => 0, dismiss: () => {}, success: () => 0, error: () => 0,
});

/** Outside a provider (a test, a public page) this is a harmless no-op, not a crash. */
export function useToast() {
  return useContext(ToastContext) || NO_OP;
}
