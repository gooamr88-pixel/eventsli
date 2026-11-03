'use client';

import { useEffect, useId, useRef, useState } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import { POSTER_ACCEPT, preparePoster } from './posterImage';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Where the poster goes in: choose it, drop it, or paste it.
 *
 * Three ways in because organizers have the poster in three places — a file
 * from their designer, an image in another tab, a screenshot on the clipboard.
 * On a phone the same file input offers the camera, so a printed flyer on a
 * noticeboard is one photo away from a draft.
 *
 * NOTHING IS SENT HERE. Choosing a poster only prepares it in the browser
 * (`preparePoster`: downscaled, re-encoded, location data dropped). The upload
 * happens on Generate, once, with the rest of the request.
 *
 * Paste is listened for on the whole page while this is on screen, but only an
 * IMAGE on the clipboard is taken, and never while typing in a field — pasting
 * text into the note must stay pasting text.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PosterDrop({ poster, onPoster, error }) {
  const inputId = useId();
  const statusId = useId();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function take(file) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      onPoster(await preparePoster(file));
    } catch (err) {
      setProblem(err.message || 'That image could not be used.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';   // the same file again still fires
    }
  }

  // The latest `take` for the paste listener, without re-subscribing per render.
  const takeRef = useRef(take);
  useEffect(() => { takeRef.current = take; });

  useEffect(() => {
    function onPaste(e) {
      const target = e.target;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      takeRef.current(item.getAsFile());
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const message = problem || error || null;

  if (poster) {
    return (
      <div className="es-ai-poster">
        <div className="es-ai-poster__frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster.dataUrl} alt="Your poster" className="es-ai-poster__img" />
        </div>
        <div className="es-ai-poster__meta">
          <p className="es-ai-poster__name fx-break"><NavIcon name="image" size={16} /> {poster.name}</p>
          <p className="es-ai-poster__sub es-nums">{poster.width}×{poster.height} · {Math.round(poster.bytes / 1024)} KB · ready to read</p>
          <div className="es-ai-poster__tools">
            <label htmlFor={inputId} className="es-btn es-btn--secondary es-btn--sm" aria-disabled={busy || undefined}>
              {busy ? 'Preparing…' : 'Replace'}
            </label>
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onPoster(null)} disabled={busy}>
              Remove
            </button>
          </div>
          {message && <p className="es-ai-err" role="alert">{message}</p>}
        </div>
        <input
          ref={input} id={inputId} type="file" accept={POSTER_ACCEPT} className="sr-only"
          onChange={(e) => take(e.target.files?.[0])} disabled={busy}
        />
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className={`es-ai-drop${over ? ' is-over' : ''}${message ? ' is-error' : ''}`}
        aria-describedby={statusId}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files?.[0]); }}
      >
        <span className="es-ai-drop__icon" aria-hidden="true">
          {busy ? <span className="es-ai-spin" /> : <NavIcon name="image" size={26} />}
        </span>
        <span className="es-ai-drop__title">{busy ? 'Preparing your poster…' : 'Add your event poster or flyer'}</span>
        <span className="es-ai-drop__text">
          Drop it here, paste it, or <span className="es-ai-drop__cta">choose an image</span>. On a phone you can take a photo of a printed flyer.
        </span>
        <span className="es-ai-drop__fine">JPEG, PNG, WebP or a phone photo · up to 25 MB</span>
      </label>
      <input
        ref={input} id={inputId} type="file" accept={POSTER_ACCEPT} className="sr-only"
        onChange={(e) => take(e.target.files?.[0])} disabled={busy}
      />
      <p id={statusId} className={message ? 'es-ai-err mt-2 text-sm' : 'sr-only'} role={message ? 'alert' : undefined}>
        {message || 'No poster chosen yet.'}
      </p>
    </div>
  );
}
