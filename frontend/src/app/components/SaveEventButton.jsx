'use client';

import { useSavedEvent } from '../hooks/useSavedEvents';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The heart on an event card.
 *
 * A SIBLING OF THE CARD'S LINK, NEVER A CHILD OF IT. The card is one big
 * anchor, and a `<button>` inside an `<a>` is invalid HTML that browsers
 * recover from inconsistently — in practice the click navigates to the event
 * instead of saving it, which is the one thing this button must not do. So the
 * card wraps both in a positioned container and this sits on top.
 *
 * `stopPropagation` is belt on that brace: it is no longer inside the anchor,
 * but it IS inside the anchor's hover and focus region, and a stray bubbled
 * click is exactly the kind of thing a future layout change reintroduces.
 *
 * The saved list is local to the browser — `useSavedEvents` argues why, and the
 * tooltip says so rather than letting a heart imply an account feature.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SaveEventButton({ slug, title, className = '' }) {
  const [saved, toggle] = useSavedEvent(slug);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      title="Saved on this device"
      // Sits over the card's artwork, which may be any photograph or a
      // typographic placeholder — so a translucent black fill rather than a
      // surface colour, which would vanish on a light image.
      className={`grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55 ${className}`}
    >
      <svg
        width="17" height="17" viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    </button>
  );
}
