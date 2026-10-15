'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "More actions" — the less frequent, and the destructive, behind one button.
 *
 * WHY THIS EXISTS. An event's overview showed every action as the same outlined
 * button — Public page, Share, Edit details, Seating map, Archive — and below
 * 40rem each took a full-width row, with Request cancellation under them. Six
 * equal controls before any of the event's numbers, and Archive (which stops
 * sales) weighted exactly like Edit. The frequent actions stay on screen; the
 * rest are here, with the destructive ones last and in the danger colour.
 *
 * A DISCLOSURE, NOT AN ARIA MENU. `role="menu"` promises arrow-key navigation,
 * typeahead and roving focus, and markup that announces semantics it does not
 * implement is worse than none (MyTickets.jsx makes the same argument). This is
 * a button with `aria-expanded` and a short list of real buttons and links:
 * Tab moves through them, Enter presses them, Escape closes and returns focus.
 *
 * ON A PHONE IT IS A SHEET above the tab bar rather than a dropdown, because the
 * button can land at either edge once a row of actions wraps, and a dropdown
 * anchored to the wrong edge opens off the screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MoreActions({ label = 'More', srLabel = 'More actions', children }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Into the list, so a keyboard user is not left on the button with the
    // choices somewhere after it in the tab order.
    rootRef.current?.querySelector('[data-more-item]:not([disabled])')?.focus();

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // `pointerdown`, as the site menu does: it fires before focus moves, so the
    // panel is gone by the time the finger lifts.
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  /**
   * Choosing an item closes the panel and puts focus back on the button FIRST.
   * Most items open a confirmation dialog, and a native dialog restores focus to
   * whatever had it before — if that was the item, it no longer exists when the
   * dialog closes, and focus falls to the top of the document.
   */
  function onPanelClick(e) {
    if (!e.target.closest('[data-more-item]')) return;
    buttonRef.current?.focus();
    setOpen(false);
  }

  return (
    <div className="es-more" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="es-btn es-btn--secondary es-btn--sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span className="sr-only"> — {srLabel}</span>
        <span aria-hidden className="es-more__chev"><NavIcon name="chevronDown" size={16} /></span>
      </button>
      {open && (
        <div id={panelId} className="es-more__panel" onClick={onPanelClick}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * One choice. A link when it only goes somewhere, a button when it does
 * something — the same rule BuildNav applies to Back and Save and continue.
 * `tone="danger"` for the ones that stop sales or end something.
 */
export function MoreItem({ href, onClick, icon, tone, disabled = false, children }) {
  const inner = (
    <>
      {icon && <span aria-hidden className="es-more__icon"><NavIcon name={icon} size={16} /></span>}
      <span className="fx-min0">{children}</span>
    </>
  );
  if (href) {
    return <Link href={href} className="es-more__item" data-more-item="" data-tone={tone}>{inner}</Link>;
  }
  return (
    <button type="button" className="es-more__item" data-more-item="" data-tone={tone} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

/** A rule between the everyday choices and the destructive ones. */
export function MoreDivider() {
  return <span aria-hidden className="es-more__sep" />;
}
