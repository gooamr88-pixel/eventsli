'use client';

import { useEffect, useId, useRef } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';

/**
 * One block's editor: a bottom sheet on a phone, a drawer on the right on a
 * desktop (`.es-ai-sheet`).
 *
 * The native <dialog>, for the same reasons `Confirm.jsx` gives — focus is
 * trapped, Escape closes, the page behind is out of reach — and with the same
 * fix: focus is put back on the Edit button by hand, because the dialog is
 * unmounted rather than closed and a removed dialog hands focus to nothing.
 *
 * Edits apply as they are typed (the page behind updates), so "Done" only
 * closes. There is nothing to cancel back to that the organizer would want:
 * the AI's version is one "regenerate" away, and their own edits are theirs.
 */
export default function EditSheet({ title, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="es-ai-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // A click on the backdrop (the dialog element itself, outside the panel) closes.
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="es-ai-sheet__panel">
        <span className="es-ai-sheet__grab" aria-hidden="true" />
        <div className="es-ai-sheet__head">
          <h2 id={titleId} className="es-ai-h3">{title}</h2>
          <button type="button" className="es-ai-iconbtn" onClick={onClose} aria-label="Close">
            <NavIcon name="close" size={20} />
          </button>
        </div>
        <div className="es-ai-sheet__body">{children}</div>
        <div className="es-ai-sheet__foot">
          <button type="button" className="es-btn es-btn--primary es-btn--lg es-btn--block" onClick={onClose}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
