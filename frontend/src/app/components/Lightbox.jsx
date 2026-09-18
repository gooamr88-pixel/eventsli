'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { trapTab } from '../utils/focusTrap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ANY PICTURE ON THE SITE, FULL SCREEN.
 *
 * Lifted out of the event gallery, where it only ever served the gallery grid.
 * Every other image on the platform — the cover on the event page, a sponsor's
 * logo — was a picture you could look at and not examine: a poster carries the
 * line-up, the dress code and the door time in type that is unreadable at
 * thumbnail size, and there was no way to make it bigger.
 *
 * Now `<Zoomable>` wraps any image and opens it here.
 *
 * WHAT MAKES THIS WORTH A SHARED FILE rather than three copies: a viewer is
 * mostly the things that are easy to get wrong, and all of them are here once.
 * Escape closes. Focus is trapped while it is open and returns to the thumbnail
 * that opened it. The page behind cannot scroll. Arrow keys and a swipe move
 * between photos when there is more than one. A portal takes it out of every
 * ancestor's `overflow: hidden`, which is what stops a viewer being clipped by
 * the card it was opened from.
 *
 * `object-contain`, never `cover`. This is the screen where the whole picture
 * matters — cropping it here would defeat the only reason it exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Lightbox({ items, index, onClose, onStep }) {
  const panel = useRef(null);
  const touchStart = useRef(null);

  const total = items.length;
  const item = items[index];

  useEffect(() => {
    // The page behind must not scroll. Restored to whatever it was rather than
    // to a hard-coded value, so an overlay opened over another one does not
    // unlock the page when only the inner one closed.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (total > 1 && e.key === 'ArrowRight') { e.preventDefault(); onStep(1); return; }
      if (total > 1 && e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); return; }
      trapTab(e, panel.current);
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, onStep, total]);

  /**
   * A `document` guard rather than a mounted flag.
   *
   * `createPortal` needs a real DOM node, which the server has none of. The
   * mounted-in-an-effect version of this is what React 19's linter refuses —
   * it is a render painted and immediately thrown away — and it is not needed
   * here anyway: this only ever mounts from a click, so the server never
   * reaches it. The guard is the codebase's existing answer, from
   * `SeatingPackModal`.
   */
  if (typeof document === 'undefined' || !item) return null;

  return createPortal(
    <div
      className="es-lightbox"
      // A press on the backdrop closes; one on the picture does not. Checked by
      // identity rather than by `closest`, so a drag that starts on the photo
      // and ends on the backdrop is not read as a press on the backdrop.
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={total > 1 ? `Photo ${index + 1} of ${total}` : (item.caption || 'Photo')}
        className="es-lightbox__panel"
        onTouchStart={(e) => { touchStart.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const from = touchStart.current;
          touchStart.current = null;
          if (from === null || total < 2) return;
          const travelled = (e.changedTouches[0]?.clientX ?? from) - from;
          // 48px, so a vertical scroll with a little sideways drift does not
          // change the photo under the reader's thumb.
          if (Math.abs(travelled) > 48) onStep(travelled < 0 ? 1 : -1);
        }}
      >
        <div className="es-lightbox__bar">
          <p className="es-lightbox__count">
            {total > 1 ? `${index + 1} of ${total}` : (item.caption || '')}
          </p>
          <button type="button" onClick={onClose} className="es-lightbox__btn" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="es-lightbox__stage">
          <Image
            key={item.url}
            src={item.url}
            alt={item.caption || ''}
            fill
            sizes="100vw"
            className="es-lightbox__img"
          />
        </div>

        {total > 1 && (
          <div className="es-lightbox__nav">
            <button type="button" onClick={() => onStep(-1)} className="es-lightbox__btn" aria-label="Previous photo">
              <Chevron dir="left" />
            </button>
            {/* The caption sits between the arrows so it never covers the
                picture — over the image it hid the part of a poster somebody
                opened the viewer to read. */}
            {total > 1 && item.caption && <p className="es-lightbox__caption">{item.caption}</p>}
            <button type="button" onClick={() => onStep(1)} className="es-lightbox__btn" aria-label="Next photo">
              <Chevron dir="right" />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Chevron({ dir }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/**
 * Wraps one picture and makes it open full screen.
 *
 * The trigger is a real `<button>`, so it is reachable by keyboard and
 * announced as something that does a thing — a `<div onClick>` with a picture
 * in it is a picture to everyone who is not using a mouse.
 *
 * Focus returns to this button when the viewer closes, which is the half of
 * "opens and closes comfortably" that is easy to miss: without it a keyboard
 * user lands back at the top of the document every time they look at a photo.
 */
export function Zoomable({ items, children, className = '', label }) {
  const [openAt, setOpenAt] = useState(null);
  const trigger = useRef(null);
  const list = (items || []).filter((i) => i?.url);

  const close = useCallback(() => {
    setOpenAt(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  const step = useCallback((delta) => {
    setOpenAt((c) => (c === null ? c : (c + delta + list.length) % list.length));
  }, [list.length]);

  if (list.length === 0) return children;

  return (
    <>
      <button
        type="button"
        ref={trigger}
        onClick={() => setOpenAt(0)}
        className={`es-zoom ${className}`}
        aria-label={label || 'Open the picture full screen'}
      >
        {children}
        <span aria-hidden className="es-zoom__hint">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </span>
      </button>

      {openAt !== null && (
        <Lightbox items={list} index={openAt} onClose={close} onStep={step} />
      )}
    </>
  );
}
