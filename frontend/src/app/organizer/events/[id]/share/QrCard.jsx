'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { get } from '../../../../utils/apiClient';
import { useToast } from '../../../../components/ui/Toast';
import NavIcon from '../../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One shareable link: its QR code, the link itself, copy and download.
 *
 * The image is fetched with the organizer's session and shown from a blob URL,
 * rather than as an <img src> pointing at the API. The endpoint is behind auth,
 * and an <img> across origins in development does not carry the cookie reliably;
 * a blob works the same everywhere and the CSP already allows `blob:` images.
 *
 * The download asks for the LARGE rendering (1200px) — the on-screen one is
 * sized for a screen, and a poster printed from it would be soft.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function QrCard({ title, subtitle, url, qrPath, filename, featured = false }) {
  const toast = useToast();
  const inputId = useId();
  const inputRef = useRef(null);
  const [image, setImage] = useState({ src: null, failed: false });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        const blob = await get(qrPath, { cache: 'no-store' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ src: objectUrl, failed: false });
      } catch {
        if (!cancelled) setImage({ src: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [qrPath]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      // No clipboard permission (an http origin, an old browser): select the
      // text so one keystroke finishes the job.
      inputRef.current?.select();
      toast.show('Press Ctrl+C (or ⌘C) to copy the selected link.', { tone: 'success' });
    }
  }

  async function download() {
    setDownloading(true);
    try {
      const joiner = qrPath.includes('?') ? '&' : '?';
      const blob = await get(`${qrPath}${joiner}size=lg&download=1`, { cache: 'no-store' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      toast.error('The QR code could not be downloaded. Try again in a moment.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <article className={`es-card p-5 ${featured ? 'grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center' : 'fx-stack fx-stack--sm'}`}>
      <div className="fx-stack fx-stack--sm">
        {image.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.src} alt={`QR code for ${title}`} className="es-qr" width="176" height="176" />
        ) : (
          <div className="es-qr grid place-items-center text-center text-xs text-subtle" role="img" aria-label={image.failed ? 'QR code unavailable' : 'Loading QR code'}>
            {image.failed ? 'Could not load' : <span className="es-skeleton size-full" />}
          </div>
        )}
      </div>

      <div className="fx-stack fx-stack--sm fx-min0">
        <div>
          <h3 className="fx-break text-md text-ink">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>

        <label htmlFor={inputId} className="sr-only">{`Link for ${title}`}</label>
        <input
          ref={inputRef}
          id={inputId}
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="es-input font-mono text-sm"
        />

        <div className="fx-row">
          <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={copy}>
            <NavIcon name="copy" size={16} />
            Copy link
          </button>
          <button
            type="button"
            className="es-btn es-btn--secondary es-btn--sm"
            onClick={download}
            disabled={downloading}
            aria-busy={downloading || undefined}
          >
            <NavIcon name="download" size={16} />
            {downloading ? 'Preparing…' : 'Download PNG'}
          </button>
          <a href={url} target="_blank" rel="noreferrer" className="es-btn es-btn--ghost es-btn--sm">
            Open
          </a>
        </div>
      </div>
    </article>
  );
}
