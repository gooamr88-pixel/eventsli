'use client';

import { useRef } from 'react';
import { useModal } from '../../hooks/useModal';

/**
 * The templates' dialog frame: the shared scrim, Escape, the Tab trap and focus
 * return (`useModal`), a title and a close button. `wide` for a preview.
 */
export default function TemplateDialog({ id, title, onClose, wide = false, children }) {
  const ref = useRef(null);
  useModal(ref, onClose);
  return (
    <div className="es-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`es-backdrop__panel es-tpldialog${wide ? ' es-tpldialog--wide' : ''}`}
      >
        <div className="fx-row fx-row--between items-start gap-3">
          <h2 id={id} className="text-lg fx-min0 fx-break">{title}</h2>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
