'use client';

import { useCallback, useState } from 'react';
import { useSavedEvent } from '../../hooks/useSavedEvents';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Share, and save for later.
 *
 * SHARE USES THE PLATFORM'S OWN SHEET where there is one. `navigator.share`
 * opens the sheet the reader already knows — their messages, their WhatsApp,
 * their AirDrop — and it is the only way to reach an app we have no integration
 * with. It exists on essentially every phone and on almost no desktop, so the
 * fallback is not an edge case: it is what most desktop readers get, and it
 * copies the link instead.
 *
 * SAVE IS LOCAL, AND SAYS SO. There is no favourites endpoint and no account
 * requirement here — the heart writes the event's slug to this browser and
 * reads it back. That is worth doing because the alternative is a sign-up wall
 * in front of a bookmark, and it is worth being honest about because a heart
 * that looks like an account feature but evaporates on another device is a
 * small betrayal. The tooltip says "on this device".
 *
 * The saved list itself lives in `useSavedEvents` — shared with the hearts on
 * the event cards, so saving here fills those in too. That hook argues the
 * storage choice and the SSR problem it has to dodge.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventShare({ title, slug }) {
  const [copied, setCopied] = useState(false);
  // The same store the event cards read, so saving here fills the heart on the
  // listing the reader came from without either page asking the other.
  const [saved, toggleSave] = useSavedEvent(slug);

  const share = useCallback(async () => {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A dismissed share sheet rejects, and so does a clipboard write the
      // browser refused. Neither is worth interrupting somebody over — they
      // closed it, which is what dismissing it means.
    }
  }, [title]);

  return (
    <div className="fx-row shrink-0 items-center gap-2">
      {copied && (
        <span role="status" className="rounded-full bg-black/45 px-3 py-1 text-xs text-white backdrop-blur-sm">
          Link copied
        </span>
      )}

      <RoundButton onClick={share} label={`Share ${title}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      </RoundButton>

      <RoundButton
        onClick={toggleSave}
        pressed={saved}
        label={saved ? `Remove ${title} from saved` : `Save ${title}`}
        title="Saved on this device"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
      </RoundButton>
    </div>
  );
}

function RoundButton({ onClick, label, title, pressed, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      // These sit on the cover photograph, so the fill is a translucent black
      // rather than a surface colour: a surface fill is invisible on a light
      // image and wrong on a dark one, and the page cannot know which it has.
      className="grid h-10 w-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
    >
      {children}
    </button>
  );
}
