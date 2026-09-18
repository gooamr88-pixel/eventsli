'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import Lightbox from '../../components/Lightbox';

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
        <Lightbox items={images} index={openAt} onClose={close} onStep={step} />
      )}
    </section>
  );
}

/* The viewer lives in components/Lightbox.jsx now. It was local to this file,
 * which is why the event poster and a sponsor logo — the two other pictures
 * on this page — could not be opened at all. Same component, same focus trap,
 * same swipe, now used by all three. */
