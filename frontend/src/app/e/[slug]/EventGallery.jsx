'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { trapTab } from '../../utils/focusTrap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's gallery, and the viewer that opens from it.
 *
 * WHAT MAKES A LIGHTBOX ACTUALLY WORK, and what most of them get wrong:
 *
 *   • IT TRAPS FOCUS. An overlay you can Tab out of leaves a keyboard user
 *     operating a page they cannot see, behind a black screen, with no way to
 *     know where they are. Focus enters on open and cycles inside until close.
 *
 *   • IT RETURNS FOCUS. On close, the thumbnail that opened it takes focus
 *     back — otherwise the keyboard lands at the top of the document and the
 *     reader has to travel back down to where they were.
 *
 *   • IT LOCKS THE PAGE BEHIND IT. Without `overflow: hidden` on the body, a
 *     scroll gesture over the overlay scrolls the article underneath, so
 *     closing it drops the reader somewhere they never navigated to.
 *
 *   • IT ANSWERS THE ARROW KEYS AND A SWIPE. Left and right move between
 *     images, Escape closes. On a phone the same two moves are a horizontal
 *     swipe, because nobody has arrow keys there.
 *
 * VIDEO IS A LINK OUT, NOT AN EMBED. An `<iframe>` for every video loads
 * YouTube's player, its cookies and its tracking into the page for every
 * visitor, most of whom never press play — so the tile is a poster that opens
 * the video in a new tab, and the page stays fast and quiet.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventGallery({ items = [] }) {
  const images = items.filter((i) => i.kind === 'image');
  const videos = items.filter((i) => i.kind === 'video');
  const [openAt, setOpenAt] = useState(null);
  const triggers = useRef([]);

  const close = useCallback(() => {
    const index = openAt;
    setOpenAt(null);
    // Back to the thumbnail that opened it, after the overlay has gone.
    requestAnimationFrame(() => triggers.current[index]?.focus());
  }, [openAt]);

  const step = useCallback((delta) => {
    setOpenAt((current) => {
      if (current === null || images.length === 0) return current;
      return (current + delta + images.length) % images.length;
    });
  }, [images.length]);

  if (items.length === 0) return null;

  return (
    <section className="fx-stack" aria-labelledby="event-gallery">
      <h2 id="event-gallery" className="text-lg">Gallery</h2>

      <ul className="fx-grid" style={{ '--fx-col': '200px', '--fx-gap': '10px' }}>
        {images.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              ref={(node) => { triggers.current[index] = node; }}
              onClick={() => setOpenAt(index)}
              className="group relative block aspect-[4/3] w-full overflow-hidden rounded-(--es-radius-md) bg-bg-sunken"
              // Says what opening it does, not just what it is — "photo 2 of 9"
              // alone does not tell anybody it is a button that enlarges.
              aria-label={`Open photo ${index + 1} of ${images.length}${item.caption ? `: ${item.caption}` : ''}`}
            >
              <Image
                src={item.url}
                alt={item.caption || ''}
                fill
                sizes="(max-width: 640px) 50vw, 200px"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {item.caption && (
                <span className="absolute inset-x-0 bottom-0 bg-ink/70 px-2 py-1 text-left text-xs text-white">
                  {item.caption}
                </span>
              )}
            </button>
          </li>
        ))}

        {videos.map((item) => (
          <li key={item.id}>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group relative grid aspect-[4/3] w-full place-items-center rounded-(--es-radius-md) border border-border-base bg-bg-sunken"
            >
              <span className="fx-stack fx-stack--sm items-center gap-1 text-center">
                <span
                  aria-hidden="true"
                  className="grid h-11 w-11 place-items-center rounded-full bg-accent text-on-accent transition-transform group-hover:scale-110"
                >
                  ▶
                </span>
                <span className="text-sm text-ink">{item.caption || 'Watch the video'}</span>
                <span className="text-xs text-subtle">Opens in a new tab</span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      {openAt !== null && images[openAt] && (
        <Lightbox
          item={images[openAt]}
          index={openAt}
          total={images.length}
          onClose={close}
          onStep={step}
        />
      )}
    </section>
  );
}

function Lightbox({ item, index, total, onClose, onStep }) {
  const panel = useRef(null);
  const touchStart = useRef(null);

  useEffect(() => {
    // The page behind must not scroll. Restored to whatever it was rather than
    // to a hard-coded value, so an overlay opened over another one does not
    // unlock the page when only the inner one closed.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panel.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); return; }
      if (e.key !== 'Tab') return;

      // The focus trap. Without it, Tab walks out into a page the reader
      // cannot see, behind a black screen. Shared with the other two modals so
      // the "skip disabled controls" rule cannot drift between copies — the
      // first and last photo disable one arrow each.
      trapTab(e, panel.current);
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, onStep]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink/90 p-4"
      // A click on the backdrop closes; one on the image does not. Checked by
      // identity rather than by `closest`, so a drag that starts on the picture
      // and ends on the backdrop is not read as a click on the backdrop.
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Photo ${index + 1} of ${total}`}
        className="flex min-h-0 flex-1 flex-col gap-3 outline-none"
        onTouchStart={(e) => { touchStart.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const from = touchStart.current;
          touchStart.current = null;
          if (from === null) return;
          const travelled = (e.changedTouches[0]?.clientX ?? from) - from;
          // 48px, so a vertical scroll with a little sideways drift does not
          // change the photo under the reader's thumb.
          if (Math.abs(travelled) > 48) onStep(travelled < 0 ? 1 : -1);
        }}
      >
        <div className="fx-row fx-row--between items-center gap-3">
          <p className="text-sm text-white/80">{index + 1} of {total}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--es-radius-md) border border-white/30 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          <Image
            src={item.url}
            alt={item.caption || `Photo ${index + 1} of ${total}`}
            fill
            sizes="100vw"
            className="object-contain"
            priority
          />
        </div>

        <div className="fx-row fx-row--between items-center gap-3">
          <NavButton onClick={() => onStep(-1)} disabled={total < 2} label="Previous photo">←</NavButton>
          {item.caption
            ? <p className="fx-min0 flex-1 text-center text-sm text-white/90">{item.caption}</p>
            : <span className="flex-1" />}
          <NavButton onClick={() => onStep(1)} disabled={total < 2} label="Next photo">→</NavButton>
        </div>
      </div>
    </div>
  );
}

function NavButton({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // 44px — the smallest square a thumb hits reliably, and these sit at the
      // bottom of a phone screen where the hand already is.
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/30 text-lg text-white transition-colors hover:bg-white/10 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
